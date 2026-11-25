"use client";

import { Lock } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AiBot } from "@/shared/components/ai/chat";
import { Button } from "@/shared/components/ui/button";
import { GuideBulb, Hint } from "@/shared/components/ui/hint";
import { useT } from "@/shared/lib/i18n";
import { openTour } from "@/shared/lib/nav";
import { closeTip, useSetupTips, useTipShown } from "@/shared/lib/prefs";
import { cn } from "@/shared/lib/utils";

/** One line under an AI answer (or a menu) when a setting would make it better: `go` walks the guide feature `tour` on the
 *  page; "Để sau" closes this one for good (Cài đặt › Trợ lý biết tuốt › Gợi ý cài đặt turns them all off). */
export function SetupTip({ id, when, text, go, tour, className }: { id: string; when: boolean; text: string; go: string; tour: string; className?: string }) {
  const t = useT();
  const shown = useTipShown(id) && when;
  const still = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {shown && (
        <motion.p role="note" initial={still ? { opacity: 0 } : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={still ? { opacity: 0 } : { opacity: 0, height: 0 }}
          className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 overflow-hidden text-xs text-ink-2", className)}>
          <GuideBulb className="size-4 shrink-0" />
          <span className="min-w-48 flex-1">{text}</span>{/* narrow (a menu): the buttons wrap under the text */}
          <Button type="button" size="xs" variant="outline" className="rounded-full" onClick={() => openTour(tour)}>{go}</Button>
          <Hint side="bottom" text={t("Ẩn gợi ý này. Bật / tắt mọi gợi ý ở Cài đặt › Trợ lý biết tuốt.")}>
            <Button type="button" size="xs" variant="ghost" onClick={() => closeTip(id)}>{t("Để sau")}</Button>
          </Hint>
        </motion.p>
      )}
    </AnimatePresence>
  );
}

/** Where an AI feature would be while no AI CLI is set up: what it does and the way to set one up, instead of nothing
 *  (setup suggestions off: nothing, as before). */
export function AiLocked({ title, what, className }: { title: string; what: string; className?: string }) {
  const t = useT();
  if (!useSetupTips()) return null;
  return (
    <section aria-label={title} className={cn("grid justify-items-start gap-2 rounded-[var(--radius-card)] border border-dashed border-rule-2 bg-paper-2 p-4", className)}>
      <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
        <span className="relative"><AiBot className="size-6 opacity-60" /><Lock aria-hidden className="absolute -right-1 -bottom-1 size-3 rounded-full bg-paper-2 text-ink-3" /></span>
        {title}
      </h3>
      <p className="text-sm text-ink-2">{what}</p>
      <p className="text-xs text-ink-3">{t("Cần một AI CLI đã đăng nhập (Claude Code, Codex hoặc Antigravity) trên máy này.")}</p>
      <Button type="button" size="sm" variant="outline" onClick={() => openTour("settings-ai-accounts")}>{t("Chỉ tôi cách cài AI")}</Button>
    </section>
  );
}
