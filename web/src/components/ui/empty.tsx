import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { AiBot } from "@/components/ai/chat";
import { cn } from "@/lib/utils";

/** A list's empty / no-match state (AI Agent, Q&A, Việc cần xử lý, tin tag của nhóm): icon in a wash circle (`tone`) bobbing
 *  over a soft ping (or a whole scene as `art`, e.g. `AllDone`), a bold line, a note, one action. */
export function Empty({ icon, art, tone = "bg-hl-wash text-hl-2", title, children, action, className }: {
  icon?: ReactNode; art?: ReactNode; tone?: string; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string;
}) {
  return (
    <div className={cn("grid justify-items-center gap-2 px-4 py-12 text-center animate-in fade-in-0", className)}>
      {art}
      {!art && icon && (
        <span className="relative mb-1 grid size-14 place-items-center">
          <span aria-hidden className={cn(tone, "absolute inset-1.5 animate-ping rounded-full bg-current opacity-20 [animation-duration:2.4s]")} />
          <span className={cn("ai-float relative grid size-11 place-items-center rounded-full [&_svg]:size-5", tone)}>{icon}</span>
        </span>
      )}
      <p className="text-sm font-bold text-ink">{title}</p>
      {children && <p className="max-w-xs text-sm leading-relaxed text-ink-3">{children}</p>}
      {action}
    </div>
  );
}

/** The robot's stage (NoPick, AI vẽ linh vật): a soft disc in a dashed orbit with a sparkle circling it, the halo
 *  breathing, `children` (the mascot, floating) over a shadow that shrinks as it rises. */
export function BotStage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span aria-hidden className={cn("relative grid size-44 place-items-center", className)}>
      <span className="absolute inset-0 rounded-full border border-dashed border-hl/45" />
      <span className="absolute inset-5 rounded-full bg-hl-wash/60 ring-1 ring-hl/10" />
      <span className="ai-halo absolute inset-12 rounded-full bg-hl/30 blur-2xl" />
      <span className="ai-spin absolute inset-0 [animation-duration:8s]">
        <Sparkles className="ai-twinkle absolute top-0 left-1/2 size-4 -translate-x-1/2 -translate-y-1/2 text-hl-2" />
      </span>
      <Sparkles className="ai-twinkle absolute top-7 right-6 size-3 text-hl-2/70 [animation-delay:0.4s]" />
      <Sparkles className="ai-twinkle absolute bottom-9 left-5 size-2.5 text-hl-2/60 [animation-delay:0.8s]" />
      {children}
      <span className="ai-shadow absolute bottom-10 h-1.5 w-12 rounded-full bg-ink-3/40 blur-[2px]" />
    </span>
  );
}

/** Nothing picked on a list + detail page (AI Agent, Q&A): the robot bobs over its shadow inside a soft disc, a dashed
 *  orbit with a sparkle circling it, over a title and one line saying what to do; fills the detail pane. */
export function NoPick({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-0 flex-1 place-items-center p-6 text-center animate-in fade-in-0 zoom-in-95 duration-(--dur-short)">
      <div className="grid justify-items-center gap-2.5">
        <BotStage className="mb-2"><AiBot className="ai-float relative size-20 drop-shadow-lg" /></BotStage>
        <p className="text-base font-bold text-ink">{title}</p>
        <p className="max-w-sm text-md leading-relaxed text-ink-3">{children}</p>
      </div>
    </div>
  );
}
