import { posix } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { minimatch } from "minimatch";
import { normalizeVirtualPath } from "../virtual-path.js";
import { isProbablyBinary, listFilesUnder, textResult, truncateOutput } from "./tool-utils.js";

export function createSearchTools({ vfs, cwd }) {
  const resolve = (path) => normalizeVirtualPath(path, cwd);
  const find = defineTool({
    name: "find",
    label: "find",
    description: "Find virtual files by glob pattern without invoking host fd/find.",
    promptSnippet: "Find in-memory files by glob pattern",
    parameters: Type.Object({
      pattern: Type.String({ description: "Glob such as **/*.js or *.md" }),
      path: Type.Optional(Type.String({ description: "Virtual search directory" })),
      limit: Type.Optional(Type.Number({ description: "Maximum results; default 1000" })),
    }),
    executionMode: "parallel",
    async execute(_id, { pattern, path = ".", limit = 1_000 }, signal) {
      signal?.throwIfAborted();
      const root = resolve(path);
      if (!(await vfs.exists(root))) throw new Error(`Path not found: ${root}`);
      const matches = [];
      const prefix = root === "/" ? "/" : `${root}/`;
      for (const candidate of vfs.getAllPaths().sort()) {
        if (candidate === root || !candidate.startsWith(prefix)) continue;
        if (candidate.includes("/node_modules/") || candidate.includes("/.git/")) continue;
        const relative = posix.relative(root, candidate);
        const stat = await vfs.lstat(candidate);
        const matched = minimatch(relative, pattern, { dot: true }) ||
          (!pattern.includes("/") && minimatch(posix.basename(relative), pattern, { dot: true }));
        if (matched) matches.push(`${relative}${stat.isDirectory ? "/" : ""}`);
        if (matches.length >= limit) break;
      }
      return textResult(matches.join("\n") || "No files found matching pattern");
    },
  });

  const grep = defineTool({
    name: "grep",
    label: "grep",
    description: "Search virtual text files with JavaScript regular expressions; never invokes host ripgrep.",
    promptSnippet: "Search in-memory file contents",
    parameters: Type.Object({
      pattern: Type.String({ description: "Regular expression or literal search string" }),
      path: Type.Optional(Type.String({ description: "Virtual file or directory" })),
      glob: Type.Optional(Type.String({ description: "Optional file glob" })),
      ignoreCase: Type.Optional(Type.Boolean()),
      literal: Type.Optional(Type.Boolean()),
      context: Type.Optional(Type.Number({ description: "Context lines around matches" })),
      limit: Type.Optional(Type.Number({ description: "Maximum matches; default 100" })),
    }),
    executionMode: "parallel",
    async execute(_id, args, signal) {
      signal?.throwIfAborted();
      const root = resolve(args.path ?? ".");
      const stat = await vfs.stat(root);
      const files = stat.isFile ? [root] : await listFilesUnder(vfs, root);
      const expression = args.literal ? args.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : args.pattern;
      let regex;
      try { regex = new RegExp(expression, args.ignoreCase ? "i" : ""); }
      catch (error) { throw new Error(`Invalid regular expression: ${error.message}`); }
      const output = [];
      let matchCount = 0;
      const context = Math.max(0, args.context ?? 0);
      const limit = Math.max(1, args.limit ?? 100);
      for (const file of files) {
        signal?.throwIfAborted();
        const relative = stat.isFile ? posix.basename(file) : posix.relative(root, file);
        if (args.glob && !minimatch(relative, args.glob, { dot: true, matchBase: true })) continue;
        const buffer = Buffer.from(await vfs.readFileBuffer(file));
        if (isProbablyBinary(buffer)) continue;
        const lines = buffer.toString("utf8").split("\n");
        const emitted = new Set();
        for (let index = 0; index < lines.length; index++) {
          if (!regex.test(lines[index])) continue;
          matchCount++;
          for (
            let lineIndex = Math.max(0, index - context);
            lineIndex <= Math.min(lines.length - 1, index + context);
            lineIndex++
          ) {
            const key = `${file}:${lineIndex}`;
            if (emitted.has(key)) continue;
            emitted.add(key);
            output.push(`${relative}:${lineIndex + 1}:${lines[lineIndex]}`);
          }
          if (matchCount >= limit) break;
        }
        if (matchCount >= limit) break;
      }
      let result = output.join("\n") || "No matches found";
      if (matchCount >= limit) result += `\n\n[Match limit ${limit} reached]`;
      return textResult(truncateOutput(result));
    },
  });

  return [find, grep];
}
