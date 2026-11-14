"use client";

import { Hint } from "@/shared/components/ui/hint";
import { cn } from "@/shared/lib/utils";

/** The row of a message's feature marks (session, Đối chiếu BE, Đã gửi, Q&A, Nháp, retest), most pressing first. Every
 *  mark spells itself out: a bare icon reads the same for two kinds and needs a hover to tell them apart. */
export const FEATS = "inline-flex flex-wrap items-center gap-1 empty:hidden";

// Slides open via the grid-cols 0fr → 1fr trick (animates the width, no measuring).
const SLIDE = "grid overflow-hidden transition-[grid-template-columns] duration-(--dur-short) motion-reduce:transition-none";
const OPEN = "group-hover/feat:grid-cols-[1fr]! group-focus-within/feat:grid-cols-[1fr]!";
const PILL = "inline-flex h-5 items-center rounded-full text-xs leading-5 font-medium whitespace-nowrap";
const MAIN = "inline-flex h-full items-center px-1.5";

export type FeatAction = { icon: React.ReactNode; label: string; hint: string; onClick: () => void; danger?: boolean };

/** One mark: icon + label (a button when `onClick`); `actions` (copy, attach, delete) slide out on hover / focus.
 *  What hover adds floats over the marks beside it (an invisible twin keeps the slot), so the row never reflows. */
export function Feat({ icon, label, title, hint, tone = "bg-paper-3 text-ink-2", onClick, actions, mono }: {
  icon: React.ReactNode; label: React.ReactNode; title?: string; hint: string; tone?: string;
  onClick?: () => void; actions?: FeatAction[]; mono?: boolean;
}) {
  const body = (
    <>
      <span className="grid size-3.5 shrink-0 place-items-center [&_svg]:size-3">{icon}</span>
      <span className={cn("pr-0.5 pl-1", mono && "font-mono")}>{label}</span>
    </>
  );
  return (
    <span className="group/feat relative inline-flex">
      <span aria-hidden className={cn(PILL, MAIN, "invisible")}>{body}</span>
      <span className={cn(PILL, tone, "absolute top-0 left-0 w-max overflow-hidden group-hover/feat:z-10 group-hover/feat:shadow-stock group-focus-within/feat:z-10")}>
        <Hint side="bottom" title={title} text={hint}>
          {onClick ? (
            <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }}
              className={cn(MAIN, "transition-colors duration-(--dur-micro) hover:bg-current/10")}>{body}</button>
          ) : <span tabIndex={0} className={MAIN}>{body}</span>}
        </Hint>
        {!!actions?.length && (
          <span className={cn(SLIDE, "h-full grid-cols-[0fr]", OPEN)}>
            <span className="flex min-w-0 items-center">
              {actions.map((a) => (
                <Hint key={a.label} side="bottom" text={a.hint}>
                  <button type="button" aria-label={a.label} onClick={(e) => { e.stopPropagation(); a.onClick(); }}
                    className={cn("grid h-5 w-6 shrink-0 place-items-center border-l border-current/15 transition-colors duration-(--dur-micro) [&_svg]:size-3",
                      a.danger ? "hover:bg-error-wash hover:text-error" : "hover:bg-current/10")}>{a.icon}</button>
                </Hint>
              ))}
            </span>
          </span>
        )}
      </span>
    </span>
  );
}
