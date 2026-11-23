import type { Failure } from "@/shared/lib/api";
import type { components } from "@/shared/lib/api.generated";

type Req = components["schemas"]["ContactRequest"];
export type ContactDraft = Pick<Req, "kind" | "area" | "title" | "text">;

const KEY = "contact-prefill"; // sessionStorage: this tab only, read once by Cài đặt › Liên hệ

/** A toast's "Báo lỗi": a bug report about `text` / `f` on the current screen, for Liên hệ to open with. The body is the
 *  message's own words (Vietnamese, like the machine info the server adds). */
export function prefillReport(text: string, f: Failure) {
  const path = location.pathname;
  const area: Req["area"] = path.startsWith("/youtrack") ? "youtrack" : path.startsWith("/docs") ? "docs" : path.startsWith("/settings") ? "settings" : "telegram";
  // within the description's limit (TEXT_MAX 3000 in contact.tsx, the server's too), the last line kept to fill in
  const body = [
    `Thông báo lỗi: ${text.trim().slice(0, 500)}`,
    `Mã lỗi: ${f.code}${f.status ? ` (HTTP ${f.status})` : ""}`,
    ...(f.detail ? [`Chi tiết: ${f.detail.slice(0, 2000)}`] : []),
    `Màn: ${path}${location.hash}`,
    "",
    "Đã làm gì ngay trước đó: ",
  ].join("\n");
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ kind: "bug", area, title: text.trim().slice(0, 120), text: body } satisfies ContactDraft));
  } catch { /* blocked storage: Liên hệ just opens empty */ }
}

/** The report a toast left (Liên hệ reads it as it opens, then clears it: StrictMode runs the read twice). */
export function readPrefill(): ContactDraft | null {
  try {
    const v = sessionStorage.getItem(KEY);
    return v ? (JSON.parse(v) as ContactDraft) : null;
  } catch {
    return null;
  }
}

export function clearPrefill() {
  try { sessionStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}
