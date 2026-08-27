import { basename, dirname, posix } from "node:path";
import {
  createExtensionRuntime,
  createSyntheticSourceInfo,
  parseFrontmatter,
} from "@earendil-works/pi-coding-agent";
import { DEFAULT_CWD, isWithin, normalizeVirtualPath } from "./virtual-path.js";

export class MemoryResourceLoader {
  constructor({ vfs, cwd = DEFAULT_CWD, agentDir = "/agent" }) {
    this.vfs = vfs;
    this.cwd = normalizeVirtualPath(cwd, "/");
    this.agentDir = normalizeVirtualPath(agentDir, "/");
    this.extensionRuntime = createExtensionRuntime();
    this.skills = [];
    this.skillDiagnostics = [];
    this.prompts = [];
    this.agentsFiles = [];
    this.additionalSkillPaths = [];
    this.additionalPromptPaths = [];
  }

  getExtensions() {
    return { extensions: [], errors: [], runtime: this.extensionRuntime };
  }

  getSkills() { return { skills: this.skills, diagnostics: this.skillDiagnostics }; }
  getPrompts() { return { prompts: this.prompts, diagnostics: [] }; }
  getThemes() { return { themes: [], diagnostics: [] }; }
  getAgentsFiles() { return { agentsFiles: this.agentsFiles }; }
  getSystemPrompt() { return undefined; }
  getSystemPromptSource() { return undefined; }
  getAppendSystemPrompt() { return []; }
  getAppendSystemPromptSources() { return []; }

  extendResources(paths) {
    this.additionalSkillPaths.push(...(paths.skillPaths ?? []).map((entry) => entry.path));
    this.additionalPromptPaths.push(...(paths.promptPaths ?? []).map((entry) => entry.path));
  }

  async reload() {
    await this.loadAgentsFiles();
    await this.loadSkills();
    await this.loadPrompts();
  }

  async loadAgentsFiles() {
    const files = [];
    const directories = [];
    for (let current = this.cwd; ; current = posix.dirname(current)) {
      directories.push(current);
      if (current === "/") break;
    }
    directories.reverse();
    if (!directories.includes(this.agentDir)) directories.unshift(this.agentDir);

    for (const directory of directories) {
      let selected;
      for (const name of ["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"]) {
        const candidate = posix.join(directory, name);
        if (await this.vfs.exists(candidate)) {
          try {
            if ((await this.vfs.stat(candidate)).isFile) {
              selected = candidate;
              break;
            }
          } catch {}
        }
      }
      if (selected) files.push({ path: selected, content: await this.vfs.readFile(selected, "utf8") });
    }
    this.agentsFiles = files;
  }

  async loadSkills() {
    const roots = [
      posix.join(this.agentDir, "skills"),
      posix.join(this.cwd, ".pi", "skills"),
      posix.join(this.cwd, ".agents", "skills"),
      ...this.additionalSkillPaths,
    ].map((path) => normalizeVirtualPath(path, this.cwd));
    const seenNames = new Set();
    const skills = [];
    const diagnostics = [];
    for (const filePath of this.vfs.getAllPaths().sort()) {
      if (!roots.some((root) => isWithin(filePath, root))) continue;
      let stat;
      try { stat = await this.vfs.stat(filePath); } catch { continue; }
      if (!stat.isFile || (basename(filePath) !== "SKILL.md" && !filePath.endsWith(".md"))) continue;
      let parsed;
      try { parsed = parseFrontmatter(await this.vfs.readFile(filePath, "utf8")); }
      catch (error) {
        diagnostics.push({ type: "warning", message: error.message, path: filePath });
        continue;
      }
      const description = typeof parsed.frontmatter.description === "string"
        ? parsed.frontmatter.description.trim()
        : "";
      if (!description) continue;
      const skillName = typeof parsed.frontmatter.name === "string"
        ? parsed.frontmatter.name
        : basename(dirname(filePath));
      if (seenNames.has(skillName)) {
        diagnostics.push({ type: "warning", message: `Duplicate skill name: ${skillName}`, path: filePath });
        continue;
      }
      seenNames.add(skillName);
      const baseDir = dirname(filePath);
      skills.push({
        name: skillName,
        description,
        filePath,
        baseDir,
        sourceInfo: createSyntheticSourceInfo(filePath, {
          source: "memory",
          scope: isWithin(filePath, this.agentDir) ? "user" : "project",
          baseDir,
        }),
        disableModelInvocation: parsed.frontmatter["disable-model-invocation"] === true,
      });
    }
    this.skills = skills;
    this.skillDiagnostics = diagnostics;
  }

  async loadPrompts() {
    const roots = [
      posix.join(this.agentDir, "prompts"),
      posix.join(this.cwd, ".pi", "prompts"),
      ...this.additionalPromptPaths,
    ].map((path) => normalizeVirtualPath(path, this.cwd));
    const prompts = [];
    for (const filePath of this.vfs.getAllPaths().sort()) {
      if (!filePath.endsWith(".md") || !roots.some((root) => isWithin(filePath, root))) continue;
      let parsed;
      try { parsed = parseFrontmatter(await this.vfs.readFile(filePath, "utf8")); } catch { continue; }
      const name = typeof parsed.frontmatter.name === "string"
        ? parsed.frontmatter.name
        : basename(filePath, ".md");
      const baseDir = dirname(filePath);
      prompts.push({
        name,
        description: typeof parsed.frontmatter.description === "string" ? parsed.frontmatter.description : "",
        argumentHint: typeof parsed.frontmatter["argument-hint"] === "string"
          ? parsed.frontmatter["argument-hint"]
          : undefined,
        content: parsed.body,
        filePath,
        sourceInfo: createSyntheticSourceInfo(filePath, { source: "memory", scope: "project", baseDir }),
      });
    }
    this.prompts = prompts;
  }
}
