import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InMemoryFs } from "just-bash";
import {
  InMemoryCredentialStore,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
} from "@earendil-works/pi-coding-agent";
import {
  createMemoryEnvironment,
  createSnapshotSessionManager,
  loadSnapshot,
  run,
  saveSnapshot,
  serializeSnapshot,
} from "../memory-pi-agent.js";

function toolsByName(environment) {
  return Object.fromEntries(environment.tools.map((tool) => [tool.name, tool]));
}

async function execute(tool, params) {
  return tool.execute("test-call", params, undefined, undefined, {});
}

test("all file tools and just-bash share one virtual filesystem", async () => {
  const environment = await createMemoryEnvironment();
  const tools = toolsByName(environment);

  await execute(tools.write, { path: "src/a.txt", content: "alpha\nbeta\n" });
  const read = await execute(tools.read, { path: "src/a.txt" });
  assert.equal(read.content[0].text, "alpha\nbeta\n");

  await execute(tools.edit, {
    path: "src/a.txt",
    edits: [{ oldText: "beta", newText: "gamma" }],
  });
  assert.equal(await environment.vfs.readFile("/workspace/src/a.txt"), "alpha\ngamma\n");

  const bash = await execute(tools.bash, {
    command: "printf 'delta\\n' >> src/a.txt && grep -n gamma src/a.txt",
  });
  assert.match(bash.content[0].text, /2:gamma/);

  const grep = await execute(tools.grep, { pattern: "delta", path: "src" });
  assert.match(grep.content[0].text, /a\.txt:3:delta/);

  const find = await execute(tools.find, { pattern: "**/*.txt", path: "." });
  assert.match(find.content[0].text, /src\/a\.txt/);

  const ls = await execute(tools.ls, { path: "src" });
  assert.equal(ls.content[0].text, "a.txt");
});

test("host paths are absent from the agent-visible filesystem", async () => {
  const environment = await createMemoryEnvironment();
  const tools = toolsByName(environment);
  const hostScript = new URL("../memory-pi-agent.js", import.meta.url).pathname;

  assert.equal(await environment.vfs.exists(hostScript), false);
  await assert.rejects(() => execute(tools.read, { path: hostScript }), /not found|ENOENT/i);

  const bash = await execute(tools.bash, { command: `cat ${hostScript}` });
  assert.notEqual(bash.details.exitCode, 0);
  assert.match(bash.content[0].text, /No such file|not found/i);
});

test("AGENTS.md, skills, prompts and empty extensions load from memory", async () => {
  const environment = await createMemoryEnvironment();
  await environment.vfs.writeFile("/workspace/AGENTS.md", "MEMORY_AGENTS_MARKER\n");
  await environment.vfs.writeFile(
    "/workspace/.pi/skills/check-memory/SKILL.md",
    "---\nname: check-memory\ndescription: Verify the memory workspace\n---\nMEMORY_SKILL_MARKER\n",
  );
  await environment.vfs.writeFile(
    "/workspace/.pi/prompts/review.md",
    "---\ndescription: Review memory files\n---\nReview $ARGUMENTS\n",
  );
  await environment.resourceLoader.reload();

  assert.equal(environment.resourceLoader.getExtensions().extensions.length, 0);
  assert.equal(environment.resourceLoader.getAgentsFiles().agentsFiles[0].content, "MEMORY_AGENTS_MARKER\n");
  assert.deepEqual(environment.resourceLoader.getSkills().skills.map((skill) => skill.name), ["check-memory"]);
  assert.deepEqual(environment.resourceLoader.getPrompts().prompts.map((prompt) => prompt.name), ["review"]);
});

test("snapshot round-trip preserves text, binary and symlinks but excludes runtime files", async () => {
  const environment = await createMemoryEnvironment();
  await environment.vfs.writeFile("/workspace/text.txt", "hello");
  await environment.vfs.writeFile("/workspace/data.bin", new Uint8Array([0, 1, 2, 255]));
  await environment.vfs.symlink("text.txt", "/workspace/link.txt");

  const snapshot = await serializeSnapshot(environment.vfs, { cwd: environment.cwd });
  assert.equal(snapshot.files["/bin/bash"], undefined);
  assert.equal(snapshot.files["/workspace/text.txt"].encoding, "utf8");
  assert.equal(snapshot.files["/workspace/data.bin"].encoding, "base64");

  const restored = new InMemoryFs();
  const originalRead = globalThis.__unused;
  // loadSnapshot's host-file route is covered by CLI integration; reconstruct
  // its documented JSON shape here without touching the host filesystem.
  for (const directory of snapshot.directories) await restored.mkdir(directory.path, { recursive: true });
  for (const [path, entry] of Object.entries(snapshot.files)) {
    const data = entry.encoding === "base64" ? Buffer.from(entry.data, "base64") : entry.data;
    await restored.writeFile(path, data);
  }
  for (const [path, entry] of Object.entries(snapshot.symlinks)) await restored.symlink(entry.target, path);
  void originalRead;

  assert.equal(await restored.readFile("/workspace/text.txt"), "hello");
  assert.deepEqual([...await restored.readFileBuffer("/workspace/data.bin")], [0, 1, 2, 255]);
  assert.equal(await restored.readlink("/workspace/link.txt"), "text.txt");
});

test("snapshot saves and restores OAuth credentials outside the virtual filesystem", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "memory-pi-agent-"));
  const snapshotPath = join(temporaryDirectory, "snapshot.json");
  const oauth = {
    type: "oauth",
    access: "saved-access",
    refresh: "saved-refresh",
    expires: 1_893_456_000_000,
    accountId: "saved-account",
  };

  try {
    const environment = await createMemoryEnvironment();
    await environment.vfs.writeFile("/workspace/visible.txt", "visible");
    await saveSnapshot(environment.vfs, snapshotPath, {
      cwd: environment.cwd,
      oauthCredential: oauth,
    });

    const saved = JSON.parse(await readFile(snapshotPath, "utf8"));
    assert.deepEqual(saved.oauth, {
      access: "saved-access",
      refresh: "saved-refresh",
      expires: 1_893_456_000_000,
      accountId: "saved-account",
    });
    assert.doesNotMatch(JSON.stringify(saved.files), /saved-access|saved-refresh/);

    const restored = await createMemoryEnvironment({ snapshotPath });
    assert.deepEqual(restored.oauthCredential, oauth);
    assert.equal(await restored.vfs.readFile("/workspace/visible.txt"), "visible");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("snapshot saves and restores the complete Pi session tree", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "memory-pi-agent-session-"));
  const snapshotPath = join(temporaryDirectory, "snapshot.json");

  try {
    const environment = await createMemoryEnvironment();
    const original = SessionManager.inMemory(environment.cwd, { id: "saved-session" });
    original.appendModelChange("openai-codex", "gpt-5.4");
    original.appendThinkingLevelChange("medium");
    const userEntryId = original.appendMessage({
      role: "user",
      content: [{ type: "text", text: "remember this" }],
      timestamp: Date.now(),
    });
    original.appendMessage(fauxAssistantMessage("I will remember this"));
    original.branch(userEntryId);
    original.appendMessage(fauxAssistantMessage("alternate branch"));
    const originalEntries = original.getEntries();
    const jsonEntries = JSON.parse(JSON.stringify(originalEntries));
    const originalLeafId = original.getLeafId();

    await saveSnapshot(environment.vfs, snapshotPath, {
      cwd: environment.cwd,
      sessionManager: original,
    });
    const saved = JSON.parse(await readFile(snapshotPath, "utf8"));
    assert.equal(saved.session.header.id, "saved-session");
    assert.deepEqual(saved.session.entries, jsonEntries);
    assert.equal(saved.session.leafId, originalLeafId);
    assert.doesNotMatch(JSON.stringify(saved.files), /remember this/);

    const restoredEnvironment = await createMemoryEnvironment({ snapshotPath });
    const restored = createSnapshotSessionManager(
      restoredEnvironment.cwd,
      restoredEnvironment.sessionSnapshot,
    );
    assert.equal(restored.getSessionId(), "saved-session");
    assert.deepEqual(restored.getEntries(), jsonEntries);
    assert.equal(restored.getLeafId(), originalLeafId);
    assert.equal(restored.getChildren(userEntryId).length, 2);
    assert.deepEqual(
      restored.buildSessionContext().messages.map((message) => message.content),
      [
        [{ type: "text", text: "remember this" }],
        [{ type: "text", text: "alternate branch" }],
      ],
    );

    restored.appendMessage({
      role: "user",
      content: [{ type: "text", text: "continued" }],
      timestamp: Date.now(),
    });
    assert.equal(restored.getLeafEntry().parentId, originalLeafId);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("--fs persists an injected OAuth credential even when the agent run fails", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "memory-pi-agent-run-"));
  const snapshotPath = join(temporaryDirectory, "snapshot.json");
  const previousCredential = process.env.PI_OPENAI_OAUTH_JSON;
  process.env.PI_OPENAI_OAUTH_JSON = JSON.stringify({
    access: "injected-access",
    refresh: "injected-refresh",
    expires: Date.now() + 60 * 60 * 1000,
    accountId: "injected-account",
  });

  try {
    await assert.rejects(
      run(["--fs", snapshotPath, "--model", "not-a-real-model", "-p", "unused"]),
      /Unknown OpenAI Codex model/,
    );
    const saved = JSON.parse(await readFile(snapshotPath, "utf8"));
    assert.equal(saved.oauth.access, "injected-access");
    assert.equal(saved.oauth.refresh, "injected-refresh");
  } finally {
    if (previousCredential === undefined) delete process.env.PI_OPENAI_OAUTH_JSON;
    else process.env.PI_OPENAI_OAUTH_JSON = previousCredential;
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("Pi session uses only custom memory tools and receives memory resources", async () => {
  const environment = await createMemoryEnvironment();
  await environment.vfs.writeFile("/workspace/AGENTS.md", "MEMORY_AGENTS_MARKER\n");
  await environment.vfs.writeFile(
    "/workspace/.pi/skills/check-memory/SKILL.md",
    "---\nname: check-memory\ndescription: Verify memory tools\n---\nMEMORY_SKILL_MARKER\n",
  );
  await environment.resourceLoader.reload();

  const credentials = new InMemoryCredentialStore();
  await credentials.modify("openai-codex", async () => ({
    type: "oauth",
    access: "fake-access",
    refresh: "fake-refresh",
    expires: Date.now() + 60 * 60 * 1000,
    accountId: "fake-account",
  }));
  const modelRuntime = await ModelRuntime.create({
    credentials,
    modelsPath: null,
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
  const model = modelRuntime.getModel("openai-codex", "gpt-5.4");
  assert.ok(model);
  const resolvedAuth = await modelRuntime.getAuth(model);
  assert.equal(resolvedAuth.auth.apiKey, "fake-access");

  const sessionManager = SessionManager.inMemory(environment.cwd);
  const settingsManager = SettingsManager.inMemory({ defaultTools: environment.tools.map((tool) => tool.name) });
  const { session } = await createAgentSession({
    cwd: environment.cwd,
    model,
    modelRuntime,
    sessionManager,
    settingsManager,
    resourceLoader: environment.resourceLoader,
    tools: environment.tools.map((tool) => tool.name),
    customTools: environment.tools,
  });
  try {
    await session.bindExtensions({ mode: "print" });
    assert.deepEqual(session.getActiveToolNames().sort(), ["bash", "edit", "find", "grep", "ls", "read", "write"]);
    assert.match(session.systemPrompt, /MEMORY_AGENTS_MARKER/);
    assert.match(session.systemPrompt, /check-memory/);
    assert.equal(session.getToolDefinition("bash").label, "bash (in memory)");
  } finally {
    session.dispose();
  }
});

test("a complete Pi agent turn executes a memory tool without network", async () => {
  const environment = await createMemoryEnvironment();
  const faux = fauxProvider({ provider: "memory-test" });
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall("write", { path: "agent-created.txt", content: "created by tool loop\n" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("memory tool loop completed"),
  ]);

  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
  modelRuntime.registerNativeProvider(faux.provider);
  const sessionManager = SessionManager.inMemory(environment.cwd);
  const settingsManager = SettingsManager.inMemory({ defaultTools: environment.tools.map((tool) => tool.name) });
  const { session } = await createAgentSession({
    cwd: environment.cwd,
    model: faux.getModel(),
    modelRuntime,
    sessionManager,
    settingsManager,
    resourceLoader: environment.resourceLoader,
    tools: environment.tools.map((tool) => tool.name),
    customTools: environment.tools,
    thinkingLevel: "off",
  });
  try {
    await session.bindExtensions({ mode: "print" });
    await session.prompt("Create the test file");
    assert.equal(await environment.vfs.readFile("/workspace/agent-created.txt"), "created by tool loop\n");
    const last = session.state.messages.at(-1);
    assert.equal(last.role, "assistant");
    assert.equal(last.content[0].text, "memory tool loop completed");
    assert.equal(faux.state.callCount, 2);
  } finally {
    session.dispose();
  }
});
