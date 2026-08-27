import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { textResult, truncateOutput } from "./tool-utils.js";

export function createBashTool({ shell, cwd }) {
  return defineTool({
    name: "bash",
    label: "bash (in memory)",
    description: "Execute a sandboxed just-bash command against the same in-memory filesystem. No host subprocesses or network commands are available.",
    promptSnippet: "Execute sandboxed just-bash commands in memory",
    promptGuidelines: [
      "bash is implemented by just-bash; it cannot execute host programs or access the host filesystem.",
      "Network, Python, and JavaScript execution are disabled.",
    ],
    parameters: Type.Object({
      command: Type.String({ description: "Bash command" }),
      timeout: Type.Optional(Type.Number({ description: "Timeout in seconds; default 60, maximum 120" })),
    }),
    executionMode: "sequential",
    async execute(_id, { command, timeout = 60 }, signal) {
      signal?.throwIfAborted();
      const timeoutMs = Math.min(120, Math.max(1, timeout)) * 1_000;
      const timeoutController = new AbortController();
      const timer = setTimeout(() => timeoutController.abort(new Error("bash timeout")), timeoutMs);
      const effectiveSignal = signal
        ? AbortSignal.any([signal, timeoutController.signal])
        : timeoutController.signal;
      try {
        const result = await shell.exec(command, { cwd, signal: effectiveSignal });
        const combined = [result.stdout, result.stderr]
          .filter(Boolean)
          .join(result.stdout && result.stderr ? "\n" : "");
        let output = truncateOutput(combined || "(no output)", { tail: true });
        if (result.exitCode !== 0) output += `\n\nCommand exited with code ${result.exitCode}`;
        return textResult(output, { exitCode: result.exitCode });
      } finally {
        clearTimeout(timer);
      }
    },
  });
}
