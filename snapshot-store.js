import { readFile, writeFile } from "node:fs/promises";
import { posix } from "node:path";
import { normalizeOAuthCredential, serializeOAuthCredential } from "./oauth-credential.js";
import { normalizeSessionSnapshot, serializeSessionSnapshot } from "./session-snapshot.js";
import { DEFAULT_CWD, isWithin, normalizeVirtualPath } from "./virtual-path.js";

export {
  createSnapshotSessionManager,
  serializeSessionSnapshot,
} from "./session-snapshot.js";

const SNAPSHOT_VERSION = 1;
const REBUILT_RUNTIME_ROOTS = ["/bin", "/usr", "/proc", "/dev"];

function emptyLoadResult() {
  return { cwd: DEFAULT_CWD, loaded: false, oauth: undefined, session: undefined };
}

async function restoreFilesystem(vfs, snapshot) {
  for (const directory of snapshot.directories ?? []) {
    const path = typeof directory === "string" ? directory : directory.path;
    const absolutePath = normalizeVirtualPath(path, "/");
    await vfs.mkdir(absolutePath, { recursive: true });
    if (typeof directory === "object" && directory.mode !== undefined) {
      await vfs.chmod(absolutePath, directory.mode);
    }
  }
  for (const [path, entry] of Object.entries(snapshot.files ?? {})) {
    const absolutePath = normalizeVirtualPath(path, "/");
    await vfs.mkdir(posix.dirname(absolutePath), { recursive: true });
    if (typeof entry === "string") {
      await vfs.writeFile(absolutePath, entry, "utf8");
      continue;
    }
    const isBase64 = entry.encoding === "base64";
    const data = isBase64 ? Buffer.from(entry.data, "base64") : entry.data;
    await vfs.writeFile(absolutePath, data, isBase64 ? undefined : "utf8");
    if (entry.mode !== undefined) await vfs.chmod(absolutePath, entry.mode);
  }
  for (const [path, entry] of Object.entries(snapshot.symlinks ?? {})) {
    const absolutePath = normalizeVirtualPath(path, "/");
    await vfs.mkdir(posix.dirname(absolutePath), { recursive: true });
    await vfs.symlink(typeof entry === "string" ? entry : entry.target, absolutePath);
  }
}

export async function loadSnapshot(vfs, snapshotPath) {
  if (!snapshotPath) return emptyLoadResult();
  let raw;
  try {
    raw = await readFile(snapshotPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return emptyLoadResult();
    throw error;
  }
  const snapshot = JSON.parse(raw);
  if (snapshot.version !== SNAPSHOT_VERSION) {
    throw new Error(`Unsupported snapshot version: ${snapshot.version}`);
  }
  const oauth = snapshot.oauth === undefined
    ? undefined
    : normalizeOAuthCredential(snapshot.oauth, "snapshot.oauth");
  const session = snapshot.session === undefined
    ? undefined
    : normalizeSessionSnapshot(snapshot.session);
  await restoreFilesystem(vfs, snapshot);
  return {
    cwd: normalizeVirtualPath(snapshot.cwd ?? DEFAULT_CWD, "/"),
    loaded: true,
    oauth,
    session,
  };
}

function isUtf8RoundTrip(buffer) {
  const text = buffer.toString("utf8");
  return Buffer.from(text, "utf8").equals(buffer) && !text.includes("\u0000");
}

async function serializeFilesystem(vfs, snapshot) {
  for (const path of vfs.getAllPaths().sort()) {
    if (path === "/" || REBUILT_RUNTIME_ROOTS.some((root) => isWithin(path, root))) continue;
    const stat = await vfs.lstat(path);
    if (stat.isDirectory) {
      snapshot.directories.push({ path, mode: stat.mode });
    } else if (stat.isSymbolicLink) {
      snapshot.symlinks[path] = { target: await vfs.readlink(path), mode: stat.mode };
    } else if (stat.isFile) {
      const buffer = Buffer.from(await vfs.readFileBuffer(path));
      snapshot.files[path] = isUtf8RoundTrip(buffer)
        ? { encoding: "utf8", data: buffer.toString("utf8"), mode: stat.mode }
        : { encoding: "base64", data: buffer.toString("base64"), mode: stat.mode };
    }
  }
}

export async function serializeSnapshot(vfs, {
  cwd = DEFAULT_CWD,
  oauthCredential,
  sessionManager,
} = {}) {
  const snapshot = {
    version: SNAPSHOT_VERSION,
    cwd,
    directories: [],
    files: {},
    symlinks: {},
  };
  const oauth = serializeOAuthCredential(oauthCredential);
  if (oauth) snapshot.oauth = oauth;
  const session = serializeSessionSnapshot(sessionManager);
  if (session) snapshot.session = session;
  await serializeFilesystem(vfs, snapshot);
  return snapshot;
}

export async function saveSnapshot(vfs, snapshotPath, options = {}) {
  if (!snapshotPath) return;
  const snapshot = await serializeSnapshot(vfs, options);
  await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}
