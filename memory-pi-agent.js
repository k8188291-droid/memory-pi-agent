#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { runAgent } from "./agent-runtime.js";
import {
  createCliAuthInteraction,
  parseCliArgs,
  printCliHelp,
} from "./cli-interface.js";

export { createMemoryEnvironment, runAgent } from "./agent-runtime.js";
export { MemoryResourceLoader } from "./memory-resource-loader.js";
export { createMemoryTools } from "./memory-tools.js";
export {
  createSnapshotSessionManager,
  loadSnapshot,
  saveSnapshot,
  serializeSessionSnapshot,
  serializeSnapshot,
} from "./snapshot-store.js";

export async function run(argv = process.argv.slice(2)) {
  const options = parseCliArgs(argv);
  if (options.help) {
    printCliHelp();
    return 0;
  }
  return runAgent(options, { createAuthInteraction: createCliAuthInteraction });
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  run().then(
    (code) => { process.exitCode = code; },
    (error) => {
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
