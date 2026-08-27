import {
  SessionManager,
  migrateSessionEntries,
} from "@earendil-works/pi-coding-agent";

export function normalizeSessionSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("snapshot.session must be an object");
  }
  if (!value.header || typeof value.header !== "object" || value.header.type !== "session") {
    throw new Error("snapshot.session.header must be a session header");
  }
  if (typeof value.header.id !== "string" || value.header.id.length === 0) {
    throw new Error("snapshot.session.header.id must be a non-empty string");
  }
  if (!Array.isArray(value.entries)) throw new Error("snapshot.session.entries must be an array");
  for (const entry of value.entries) {
    if (!entry || typeof entry !== "object" || entry.type === "session") {
      throw new Error("snapshot.session.entries contains an invalid session entry");
    }
  }
  if (value.leafId !== undefined && value.leafId !== null && typeof value.leafId !== "string") {
    throw new Error("snapshot.session.leafId must be a string or null");
  }
  return structuredClone({
    header: value.header,
    entries: value.entries,
    ...(value.leafId !== undefined ? { leafId: value.leafId } : {}),
  });
}

export function serializeSessionSnapshot(sessionManager) {
  if (!sessionManager) return undefined;
  const header = sessionManager.getHeader();
  if (!header) throw new Error("Session has no header");
  return normalizeSessionSnapshot({
    header,
    entries: sessionManager.getEntries(),
    leafId: sessionManager.getLeafId(),
  });
}

export function createSnapshotSessionManager(cwd, sessionSnapshot) {
  if (!sessionSnapshot) return SessionManager.inMemory(cwd);
  const stored = normalizeSessionSnapshot(sessionSnapshot);
  const fileEntries = structuredClone([stored.header, ...stored.entries]);
  migrateSessionEntries(fileEntries);
  const header = fileEntries.find((entry) => entry.type === "session");
  if (!header) throw new Error("snapshot.session has no session header");

  const sessionManager = SessionManager.inMemory(cwd, { id: header.id });
  header.cwd = sessionManager.getCwd();
  // The pinned SDK has no public in-memory import API. Restore its session-file
  // representation directly so entry ids, branches and compactions stay exact.
  if (typeof sessionManager._buildIndex !== "function") {
    throw new Error("Installed Pi SDK cannot restore an in-memory session snapshot");
  }
  sessionManager.fileEntries = fileEntries;
  sessionManager.sessionId = header.id;
  sessionManager._buildIndex();
  if (stored.leafId === null) sessionManager.resetLeaf();
  else if (stored.leafId !== undefined) sessionManager.branch(stored.leafId);
  return sessionManager;
}
