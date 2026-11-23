import { type Failure, failureFor } from "@/shared/lib/api";
import { t } from "@/shared/lib/i18n";

export type ToastMsg = { text: string; undo?: () => unknown; action?: { label: string; run: () => unknown }; failure?: Failure };
/** Show a toast (rendered by the inbox shell); `undo` adds a "Hoàn tác" button and the z shortcut; a text errorText
 *  just wrote for an unexpected failure carries it (`failure`): the shell adds "Báo lỗi". */
export const toast = (t: ToastMsg) => dispatchEvent(new CustomEvent<ToastMsg>("toast", { detail: { ...t, failure: t.failure ?? failureFor(t.text) ?? undefined } }));
/** Copy and say so; a refused clipboard (no focus, permissions) says that instead of a false "Đã copy". */
export async function copyText(text: string, done = t("Đã copy")) {
  try { await navigator.clipboard.writeText(text); toast({ text: done }); } catch { toast({ text: t("Không copy được, thử lại") }); }
}
