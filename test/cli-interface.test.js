import assert from "node:assert/strict";
import test from "node:test";
import {
  createCliAuthInteraction,
  formatCliHelp,
  parseCliArgs,
} from "../cli-interface.js";

test("CLI parser applies defaults and accepts all runtime options", () => {
  assert.deepEqual(parseCliArgs(["-p", "hello"]), {
    model: "gpt-5.4",
    oauth: "device",
    cwd: undefined,
    prompt: "hello",
    fs: undefined,
  });
  assert.deepEqual(
    parseCliArgs([
      "--prompt", "continue",
      "--fs", "state.json",
      "--model", "gpt-test",
      "--cwd", "/project",
      "--oauth", "browser",
    ]),
    {
      model: "gpt-test",
      oauth: "browser",
      cwd: "/project",
      prompt: "continue",
      fs: "state.json",
    },
  );
});

test("CLI parser rejects invalid or incomplete input", () => {
  assert.throws(() => parseCliArgs([]), /prompt is required/i);
  assert.throws(() => parseCliArgs(["--unknown"]), /Unknown argument/);
  assert.throws(() => parseCliArgs(["--oauth", "other", "-p", "x"]), /device or browser/);
  assert.throws(() => parseCliArgs(["--fs"]), /Missing value/);
});

test("CLI help and OAuth method selection are isolated from the runtime", async () => {
  assert.match(formatCliHelp(), /--fs FILE\s+Load and save filesystem, session and OAuth state/);
  const auth = await createCliAuthInteraction({ method: "browser" });
  try {
    const selected = await auth.interaction.prompt({
      type: "select",
      options: [
        { id: "device_code", label: "Device" },
        { id: "browser", label: "Browser" },
      ],
    });
    assert.equal(selected, "browser");
  } finally {
    auth.close();
  }
});
