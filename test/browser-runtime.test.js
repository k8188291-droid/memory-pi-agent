import assert from "node:assert/strict";
import test from "node:test";
import { BrowserAgentRuntime } from "../web/runtime.js";

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
