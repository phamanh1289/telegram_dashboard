"use client";

import { TriangleAlert } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { Dropdown } from "@/shared/components/ui/dropdown";
import { Fold } from "@/shared/components/ui/fold";
import { useT } from "@/shared/lib/i18n";
import { fold } from "@/shared/lib/utils";

/** States the workflow still names that YouTrack no longer has (deleted / renamed there): a line above the canvas, each name a
 *  way to the fix panel of its box. */
export function GoneBanner({ gone, onPick }: { gone: string[]; onPick: (s: string) => void }) {
  const t = useT();
  return (
    <Fold open={gone.length > 0}>
      <div role="alert" className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-rule bg-warn-wash px-3 py-2 text-xs text-ink-2">
        <TriangleAlert className="size-3.5 shrink-0 text-warn" aria-hidden />
        <span>{t("State không còn trên YouTrack:")}</span>
        {gone.map((s) => (
          <button key={s} type="button" onClick={() => onPick(s)}
            className="rounded-full border border-dashed border-error/60 px-2 py-0.5 font-medium text-error line-through decoration-error/50 transition-colors hover:bg-error/10">{s}</button>
        ))}
        <span className="text-ink-3">{t("bấm để thay bằng State mới hoặc bỏ")}</span>
      </div>
    </Fold>
  );
}

/** The picked deleted state's fix: another state takes its place and its arrows (the likeliest one, by name, offered first), or
 *  it leaves the workflow with its arrows. Over the canvas's top-right corner, not scaled with the zoom. */
export function GonePanel({ state, arrows, states, hidden, onReplace, onDrop }: {
  state: string; arrows: number; states: string[]; hidden: string[];
  onReplace: (to: string) => void; onDrop: () => void;
}) {
  const t = useT();
  const g = fold(state), like = (s: string) => fold(s).includes(g) || g.includes(fold(s));
  const guess = states.find(like) ?? hidden[0] ?? states[0] ?? ""; // a rename keeps most of the name; else one not in use yet
  const [pick, setPick] = useState<string | null>(null);
  const to = pick ?? guess;
  return (
    <motion.div role="dialog" aria-label={t("Sửa State đã bị xóa: {state}", { state })} onPointerDown={(e) => e.stopPropagation()}
      initial={{ opacity: 0, y: -6, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.96 }} transition={{ type: "spring", stiffness: 420, damping: 32 }}
      className="absolute top-3 right-3 z-20 grid w-80 max-w-[calc(100%-1.5rem)] origin-top-right gap-2.5 rounded-[var(--radius-card)] border border-rule bg-cotton p-3 shadow-lg">
      <p className="flex items-start gap-2 text-sm font-medium text-ink">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-error" aria-hidden />
        <span>{t("“{state}” không còn trên YouTrack", { state })}</span>
      </p>
      <p className="text-xs leading-relaxed text-ink-3">
        {t("{n} mũi tên còn nối với nó. Chọn State thay thế: State đó nhận vị trí và các mũi tên này (vd. State đã được đổi tên).", { n: arrows })}
      </p>
      <div className="flex items-center gap-2">
        <Dropdown label={t("Thay bằng")} prefix={t("Thay bằng")} value={to} onChange={setPick} className="min-w-0 flex-1 text-sm"
          options={states.map((s) => ({ value: s, label: s, hint: like(s) ? t("tên gần giống") : hidden.includes(s) ? t("chưa dùng") : undefined }))} />
        <Button type="button" size="sm" disabled={!to} onClick={() => onReplace(to)}>{t("Thay")}</Button>
      </div>
      <button type="button" onClick={onDrop} className="w-fit text-xs text-error underline decoration-error/40 underline-offset-[3px] hover:decoration-error">
        {t("Bỏ khỏi workflow (cùng {n} mũi tên)", { n: arrows })}
      </button>
    </motion.div>
  );
}
