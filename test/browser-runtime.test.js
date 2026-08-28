import assert from "node:assert/strict";
import test from "node:test";
import { BrowserAgentRuntime, createCompatibleModel, normalizeCompatibleEndpoint } from "../web/runtime.js";

test("compatible endpoint accepts a base URL or full API route", () => {
  assert.equal(normalizeCompatibleEndpoint("https://api.example.com/v1/", "responses"), "https://api.example.com/v1");
  assert.equal(normalizeCompatibleEndpoint("https://api.example.com/v1/responses", "responses"), "https://api.example.com/v1");
  assert.equal(
    normalizeCompatibleEndpoint("https://api.example.com/v1/chat/completions", "chat-completions"),
    "https://api.example.com/v1",
  );
});

test("compatible model uses arbitrary endpoint, model ID and API format", () => {
  const model = createCompatibleModel({
    endpoint: "https://inference.example/v1/chat/completions",
    modelId: "org/custom-model",
    apiFormat: "chat-completions",
  });
  assert.equal(model.baseUrl, "https://inference.example/v1");
  assert.equal(model.id, "org/custom-model");
  assert.equal(model.api, "openai-completions");
});

test("browser demo runs the Pi agent loop against one in-memory filesystem", async () => {
  const runtime = new BrowserAgentRuntime();
  const events = [];

  await runtime.run({
    mode: "local",
    prompt: "prove the browser runtime",
    modelId: "deterministic",
    onEvent: (event) => events.push(event),
  });

  const file = await runtime.vfs.readFile("/workspace/browser-demo.txt", "utf8");
  assert.match(file, /Pi agent loop executes in this page/);
  assert.match(file, /prove the browser runtime/);
  assert.deepEqual(
    events.filter((event) => event.type === "tool_execution_end").map((event) => event.toolName),
    ["write", "bash"],
  );
  assert.deepEqual((await runtime.listFiles()).map((entry) => entry.path), ["/workspace/browser-demo.txt"]);
});
