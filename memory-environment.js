import { Bash, InMemoryFs } from "just-bash";
import { MemoryResourceLoader } from "./memory-resource-loader.js";
import { createMemoryTools } from "./memory-tools.js";
import { loadSnapshot } from "./snapshot-store.js";
import { normalizeVirtualPath } from "./virtual-path.js";

const MAX_FILESYSTEM_BYTES = 256 * 1024 * 1024;

export async function createMemoryEnvironment({ cwd, snapshotPath } = {}) {
  const vfs = new InMemoryFs({}, { maxTotalBytes: MAX_FILESYSTEM_BYTES });
  const loaded = await loadSnapshot(vfs, snapshotPath);
  const effectiveCwd = normalizeVirtualPath(cwd ?? loaded.cwd, "/");
  await vfs.mkdir(effectiveCwd, { recursive: true });
  await vfs.mkdir("/agent", { recursive: true });
  const shell = new Bash({
    fs: vfs,
    cwd: effectiveCwd,
    env: { HOME: "/home/agent", PATH: "/bin:/usr/bin", PWD: effectiveCwd, LANG: "C.UTF-8" },
    executionLimitProfile: "hardened",
    executionLimits: {
      maxExecutionTimeMs: 120_000,
      maxOutputSize: 4 * 1024 * 1024,
      maxFileSystemBytes: MAX_FILESYSTEM_BYTES,
    },
    python: false,
    javascript: false,
  });
  const resourceLoader = new MemoryResourceLoader({ vfs, cwd: effectiveCwd });
  await resourceLoader.reload();
  return {
    vfs,
    shell,
    resourceLoader,
    tools: createMemoryTools({ vfs, shell, cwd: effectiveCwd }),
    cwd: effectiveCwd,
    snapshotLoaded: loaded.loaded,
    oauthCredential: loaded.oauth,
    sessionSnapshot: loaded.session,
  };
}
