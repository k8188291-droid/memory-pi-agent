import { Agent } from "@earendil-works/pi-agent-core";
import {
  InMemoryCredentialStore,
  Type,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { Bash, InMemoryFs } from "just-bash";

const WORKSPACE = "/workspace";
const MAX_FILESYSTEM_BYTES = 32 * 1024 * 1024;

function normalizePath(path, cwd = WORKSPACE) {
  const raw = path.startsWith("/") ? path : `${cwd}/${path}`;
  const parts = [];
  for (const part of raw.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

function dirname(path) {
  const normalized = normalizePath(path, "/");
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? "/" : normalized.slice(0, index);
}

function joinPath(parent, child) {
  return normalizePath(`${parent}/${child}`, "/");
}

function textResult(text, details = {}) {
  return { content: [{ type: "text", text }], details };
}

function createBrowserTools({ vfs, shell }) {
  const read = {
    name: "read",
    label: "read",
    description: "Read a UTF-8 file from the isolated in-memory workspace.",
    parameters: Type.Object({ path: Type.String({ description: "Virtual file path" }) }),
    executionMode: "parallel",
    async execute(_id, { path }, signal) {
      signal?.throwIfAborted();
      const absolutePath = normalizePath(path);
      const value = await vfs.readFile(absolutePath, "utf8");
      return textResult(value, { path: absolutePath });
    },
  };

  const write = {
    name: "write",
    label: "write",
    description: "Create or overwrite a UTF-8 file in the isolated in-memory workspace.",
    parameters: Type.Object({
      path: Type.String({ description: "Virtual file path" }),
      content: Type.String({ description: "Complete file content" }),
    }),
    executionMode: "sequential",
    async execute(_id, { path, content }, signal) {
      signal?.throwIfAborted();
      const absolutePath = normalizePath(path);
      await vfs.mkdir(dirname(absolutePath), { recursive: true });
      await vfs.writeFile(absolutePath, content, "utf8");
      const bytes = new TextEncoder().encode(content).byteLength;
      return textResult(`Wrote ${bytes} bytes to ${absolutePath}`, { path: absolutePath, bytes });
    },
  };

  const edit = {
    name: "edit",
    label: "edit",
    description: "Replace one exact text occurrence in an in-memory file.",
    parameters: Type.Object({
      path: Type.String({ description: "Virtual file path" }),
      oldText: Type.String({ description: "Exact unique text to replace" }),
      newText: Type.String({ description: "Replacement text" }),
    }),
    executionMode: "sequential",
    async execute(_id, { path, oldText, newText }, signal) {
      signal?.throwIfAborted();
      const absolutePath = normalizePath(path);
      const original = await vfs.readFile(absolutePath, "utf8");
      const first = original.indexOf(oldText);
      if (first < 0) throw new Error("oldText was not found");
      if (original.indexOf(oldText, first + oldText.length) >= 0) throw new Error("oldText is not unique");
      const updated = `${original.slice(0, first)}${newText}${original.slice(first + oldText.length)}`;
      await vfs.writeFile(absolutePath, updated, "utf8");
      return textResult(`Edited ${absolutePath}`, { path: absolutePath });
    },
  };

  const ls = {
    name: "ls",
    label: "ls",
    description: "List a directory in the isolated in-memory workspace.",
    parameters: Type.Object({ path: Type.Optional(Type.String({ description: "Virtual directory" })) }),
    executionMode: "parallel",
    async execute(_id, { path = WORKSPACE }, signal) {
      signal?.throwIfAborted();
      const absolutePath = normalizePath(path);
      const names = (await vfs.readdir(absolutePath)).sort();
      const entries = [];
      for (const name of names) {
        const stat = await vfs.stat(joinPath(absolutePath, name));
        entries.push(`${name}${stat.isDirectory ? "/" : ""}`);
      }
      return textResult(entries.join("\n") || "(empty directory)", { path: absolutePath });
    },
  };

  const bash = {
    name: "bash",
    label: "bash (in memory)",
    description: "Run a sandboxed just-bash command against the same in-memory filesystem. No host subprocesses or network access.",
    parameters: Type.Object({ command: Type.String({ description: "Bash command" }) }),
    executionMode: "sequential",
    async execute(_id, { command }, signal) {
      signal?.throwIfAborted();
      const result = await shell.exec(command, { cwd: WORKSPACE, signal });
      const output = [result.stdout, result.stderr].filter(Boolean).join("\n") || "(no output)";
      return textResult(output, { command, exitCode: result.exitCode });
    },
  };

  return [read, write, edit, ls, bash];
}

function localResponses(prompt) {
  const content = [
    "# Browser runtime proof",
    "",
    "- Pi agent loop executes in this page",
    "- just-bash and tools share one InMemoryFs",
    "- host filesystem and subprocesses are unavailable",
    "",
    `Prompt: ${prompt}`,
  ].join("\n");

  return [
    fauxAssistantMessage(
      fauxToolCall("write", { path: "/workspace/browser-demo.txt", content }, { id: "demo-write" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("bash", { command: "ls -la /workspace && printf '\\n--- browser-demo.txt ---\\n' && cat /workspace/browser-demo.txt" }, { id: "demo-bash" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage([
      fauxText("完成。Pi agent 透過 write 與 bash 工具操作了同一個 InMemoryFs；右側檔案樹與上方 tool output 都來自實際 browser runtime。"),
    ]),
  ];
}

async function listDirectory(vfs, path, depth, output) {
  const names = (await vfs.readdir(path)).sort();
  for (const name of names) {
    const childPath = joinPath(path, name);
    const stat = await vfs.stat(childPath);
    output.push({
      path: childPath,
      name,
      depth,
      type: stat.isDirectory ? "directory" : "file",
      size: stat.isDirectory ? undefined : stat.size,
    });
    if (stat.isDirectory) await listDirectory(vfs, childPath, depth + 1, output);
  }
}

export class BrowserAgentRuntime {
  constructor() {
    this.vfs = new InMemoryFs({}, { maxTotalBytes: MAX_FILESYSTEM_BYTES });
    this.shell = new Bash({
      fs: this.vfs,
      cwd: WORKSPACE,
      env: { HOME: "/home/agent", PATH: "/bin:/usr/bin", PWD: WORKSPACE, LANG: "C.UTF-8" },
      executionLimitProfile: "hardened",
      executionLimits: { maxExecutionTimeMs: 30_000, maxOutputSize: 512 * 1024, maxFileSystemBytes: MAX_FILESYSTEM_BYTES },
      python: false,
      javascript: false,
    });
    this.tools = createBrowserTools(this);
    this.activeAgent = undefined;
    this.ready = this.vfs.mkdir(WORKSPACE, { recursive: true });
  }

  abort() {
    this.activeAgent?.abort();
  }

  async listFiles() {
    await this.ready;
    const output = [];
    await listDirectory(this.vfs, WORKSPACE, 0, output);
    return output;
  }

  async run({ mode, prompt, apiKey, modelId, onEvent }) {
    await this.ready;
    if (this.activeAgent?.state.isStreaming) throw new Error("Agent is already running");

    let model;
    let streamFn;
    if (mode === "local") {
      const faux = fauxProvider({ provider: "browser-demo", models: [{ id: "deterministic", name: "Deterministic browser model" }], tokensPerSecond: 90 });
      faux.setResponses(localResponses(prompt));
      model = faux.getModel();
      streamFn = faux.provider.streamSimple.bind(faux.provider);
    } else {
      if (!apiKey?.trim()) throw new Error("OpenAI API key is required for live mode");
      const credentials = new InMemoryCredentialStore();
      await credentials.modify("openai", async () => ({ type: "api_key", key: apiKey.trim() }));
      const models = createModels({
        credentials,
        authContext: { env: async () => undefined, fileExists: async () => false },
      });
      models.setProvider(openaiProvider());
      model = models.getModel("openai", modelId);
      if (!model) throw new Error(`Unknown OpenAI model: ${modelId}`);
      streamFn = (requestModel, context, options) => models.streamSimple(requestModel, context, { ...options, transport: "sse" });
    }

    const agent = new Agent({
      initialState: {
        systemPrompt: [
          "You are Memory Pi Agent running inside a web page.",
          "Use the available tools to fulfill the user's request.",
          "All visible paths are virtual and backed by one in-memory filesystem.",
          "Prefer /workspace for files. Never claim access to the browser host filesystem or subprocesses.",
        ].join("\n"),
        model,
        thinkingLevel: mode === "local" ? "off" : "low",
        tools: this.tools,
        messages: [],
      },
      streamFn,
      toolExecution: "sequential",
    });
    this.activeAgent = agent;
    const unsubscribe = agent.subscribe(onEvent);
    try {
      await agent.prompt(prompt);
      await agent.waitForIdle();
      if (agent.state.errorMessage) throw new Error(agent.state.errorMessage);
      return agent.state.messages;
    } finally {
      unsubscribe();
      if (this.activeAgent === agent) this.activeAgent = undefined;
    }
  }
}
