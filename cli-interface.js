import { stderr, stdin } from "node:process";
import { createInterface } from "node:readline/promises";
import { DEFAULT_MODEL } from "./agent-config.js";

export function parseCliArgs(argv) {
  const options = {
    model: DEFAULT_MODEL,
    oauth: "device",
    cwd: undefined,
    prompt: undefined,
    fs: undefined,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const take = () => {
      const value = argv[++index];
      if (value === undefined) throw new Error(`Missing value after ${arg}`);
      return value;
    };
    if (arg === "-p" || arg === "--prompt") options.prompt = take();
    else if (arg === "--fs") options.fs = take();
    else if (arg === "--model") options.model = take();
    else if (arg === "--cwd") options.cwd = take();
    else if (arg === "--oauth") options.oauth = take();
    else if (arg === "-h" || arg === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.help && !options.prompt) throw new Error("A prompt is required. Use -p \"...\"");
  if (!["device", "browser"].includes(options.oauth)) throw new Error("--oauth must be device or browser");
  return options;
}

export function formatCliHelp() {
  return `Usage: node memory-pi-agent.js -p "prompt" [options]\n\nOptions:\n  -p, --prompt TEXT   Prompt to run\n  --fs FILE           Load and save filesystem, session and OAuth state\n  --model MODEL       OpenAI Codex model (default: ${DEFAULT_MODEL})\n  --cwd PATH          Virtual working directory (default: /workspace)\n  --oauth METHOD      device (default) or browser\n  -h, --help          Show this help\n\nAuthentication:\n  The default is ChatGPT Plus/Pro device-code OAuth. With --fs, the OAuth\n  credential is loaded from and saved to the snapshot. Without --fs it remains\n  in memory. PI_OPENAI_OAUTH_JSON overrides a credential loaded from --fs.`;
}

export function printCliHelp(writeLine = console.log) {
  writeLine(formatCliHelp());
}

export async function createCliAuthInteraction({
  method,
  input = stdin,
  output = stderr,
} = {}) {
  let readline;
  const promptLine = async (message) => {
    readline ??= createInterface({ input, output });
    return readline.question(`${message}\n> `);
  };
  return {
    interaction: {
      async prompt(prompt) {
        if (prompt.type === "select") {
          const preferred = method === "browser" ? "browser" : "device_code";
          if (prompt.options.some((option) => option.id === preferred)) return preferred;
          return prompt.options[0]?.id ?? "";
        }
        return promptLine(prompt.message);
      },
      notify(event) {
        if (event.type === "device_code") {
          output.write(`\nOpenAI subscription login\nOpen: ${event.verificationUri}\nCode: ${event.userCode}\n\n`);
        } else if (event.type === "auth_url") {
          output.write(`\nOpenAI subscription login\nOpen: ${event.url}\n${event.instructions ?? ""}\n\n`);
        } else if (event.type === "progress" || event.type === "info") {
          output.write(`${event.message}\n`);
        }
      },
    },
    close: () => readline?.close(),
  };
}
