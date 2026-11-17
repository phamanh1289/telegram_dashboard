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

/** Midnight today, local time. A draft lives for the day it was last written: from the next day on it is gone (and
 *  so is an unsaved render the server kept, see flow.tsx). */
export const dayStart = () => new Date().setHours(0, 0, 0, 0);
export const pastDay = (ms: number) => !(ms >= dayStart());

/** Every draft of an earlier day, of every ticket and account, deleted; once a day per page. */
let sweptDay = 0;
async function sweep() {
  const day = dayStart();
  if (sweptDay === day) return;
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite"), cursor = tx.objectStore("drafts").openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return;
        if (pastDay((c.value as FlowDraft | null)?.updated ?? 0)) c.delete();
        c.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("Draft sweep aborted"));
    });
    sweptDay = day;
  } finally { db.close(); }
}

// Keep debounced commits, close flushes and deletes in invocation order, even while opening the database.
let pending: Promise<unknown> = Promise.resolve();
export function flowDraft(scope: string, issue: string, value?: FlowDraft | null): Promise<FlowDraft | null> {
  const result = pending.then(async () => { await sweep(); return transact(scope, issue, value); });
  pending = result.then(() => undefined, () => undefined);
  return result;
}
