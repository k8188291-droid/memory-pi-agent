import { stdout } from "node:process";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
  SettingsManager,
  createAgentSession,
} from "@earendil-works/pi-coding-agent";
import { MEMORY_TOOL_NAMES, PROVIDER } from "./agent-config.js";
import { createMemoryEnvironment } from "./memory-environment.js";
import { createModelRuntime } from "./model-runtime.js";
import { createSnapshotSessionManager } from "./session-snapshot.js";
import { saveSnapshot } from "./snapshot-store.js";

export { createMemoryEnvironment } from "./memory-environment.js";

function selectModel(modelRuntime, modelId) {
  const model = modelRuntime.getModel(PROVIDER, modelId);
  if (model) return model;
  const available = modelRuntime.getModels(PROVIDER).map((item) => item.id).join(", ");
  throw new Error(`Unknown OpenAI Codex model: ${modelId}. Available: ${available}`);
}

async function createRuntimeSession({ environment, options, modelRuntime, sessionManager }) {
  const settingsManager = SettingsManager.inMemory({
    defaultProvider: PROVIDER,
    defaultModel: options.model,
    defaultTools: MEMORY_TOOL_NAMES,
    compaction: { enabled: true },
  });
  const { session } = await createAgentSession({
    cwd: environment.cwd,
    model: selectModel(modelRuntime, options.model),
    modelRuntime,
    settingsManager,
    sessionManager,
    resourceLoader: environment.resourceLoader,
    tools: MEMORY_TOOL_NAMES,
    customTools: environment.tools,
    thinkingLevel: "medium",
  });
  return session;
}

function writeAssistantResponse(session, output) {
  const lastMessage = session.state.messages.at(-1);
  if (lastMessage?.role !== "assistant") throw new Error("Agent produced no assistant response");
  if (lastMessage.stopReason === "error" || lastMessage.stopReason === "aborted") {
    throw new Error(lastMessage.errorMessage || `Request ${lastMessage.stopReason}`);
  }
  for (const part of lastMessage.content) {
    if (part.type === "text") output.write(`${part.text}\n`);
  }
}

export async function runAgent(options, {
  createAuthInteraction,
  output = stdout,
} = {}) {
  const environment = await createMemoryEnvironment({
    cwd: options.cwd,
    snapshotPath: options.fs,
  });
  const credentials = new InMemoryCredentialStore();
  const sessionManager = createSnapshotSessionManager(environment.cwd, environment.sessionSnapshot);
  let session;
  try {
    const modelRuntime = await createModelRuntime({
      oauthMethod: options.oauth,
      oauthCredential: environment.oauthCredential,
      credentials,
      createAuthInteraction,
    });
    session = await createRuntimeSession({ environment, options, modelRuntime, sessionManager });
    await session.bindExtensions({ mode: "print" });
    await session.prompt(options.prompt);
    writeAssistantResponse(session, output);
    return 0;
  } finally {
    session?.dispose();
    const oauthCredential = await credentials.read(PROVIDER) ?? environment.oauthCredential;
    await saveSnapshot(environment.vfs, options.fs, {
      cwd: environment.cwd,
      oauthCredential,
      sessionManager,
    });
  }
}
