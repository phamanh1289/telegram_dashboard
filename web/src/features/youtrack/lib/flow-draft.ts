import type { FlowManifest, UiFlow } from "./yt";

export type FlowDraft = { flow: UiFlow; manifest?: FlowManifest | null; base: string | null; job?: string; pendingJob?: string; outcomeUnknown?: boolean; updated: number };
const database = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open("uiflow-drafts", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("drafts");
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
/** Scope comes from the server's account/config identity, never from a browser preference. */
async function transact(scope: string, issue: string, value?: FlowDraft | null): Promise<FlowDraft | null> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("drafts", value === undefined ? "readonly" : "readwrite");
      const store = tx.objectStore("drafts"), key = `${scope}:${issue}`;
      const request = value === undefined ? store.get(key) : value === null ? store.delete(key) : store.put(value, key);
      tx.oncomplete = () => resolve(value === undefined ? request.result ?? null : value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("Draft transaction aborted"));
    });
  } finally { db.close(); }
}

// Keep debounced commits, close flushes and deletes in invocation order, even while opening the database.
let pending: Promise<unknown> = Promise.resolve();
export function flowDraft(scope: string, issue: string, value?: FlowDraft | null): Promise<FlowDraft | null> {
  const result = pending.then(() => transact(scope, issue, value));
  pending = result.then(() => undefined, () => undefined);
  return result;
}
