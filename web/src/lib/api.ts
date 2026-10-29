import type { components } from "./api.generated";

type S = components["schemas"];
export type Message = S["MessageDTO"];
export type Chat = S["ChatDTO"];
export type ChatsResponse = S["ChatsResponse"];
export type MessagesPage = S["MessagesPage"];
export type ChangeItem = S["ChangeItem"];
export type ChangesPage = S["ChangesPage"];
export type Status = S["StatusDTO"];
export type Outbox = S["OutboxDTO"];
export type AiResult = S["AiResult"];
export type AiPermissionResponse = S["AiPermissionResponse"];

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public retryAfter: number | null = null,
    public detail: string | null = null,
  ) {
    super(code);
  }
}

/** Same-origin JSON call to the local backend. Never caches private responses. */
export async function api<T>(
  path: string,
  init: { method?: string; json?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal: init.signal,
    headers: init.json === undefined ? undefined : { "Content-Type": "application/json" },
    body: init.json === undefined ? undefined : JSON.stringify(init.json),
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const e = body?.error;
    throw new ApiError(
      res.status,
      e?.code ?? (res.status === 422 ? "validation" : "http_error"),
      e?.retry_after ?? null,
      e?.detail ?? null,
    );
  }
  return body as T;
}

export const isAuthError = (e: unknown) => e instanceof ApiError && e.status === 401;
