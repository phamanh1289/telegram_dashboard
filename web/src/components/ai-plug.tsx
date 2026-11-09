"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AiBot } from "@/components/ai/chat";
import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/utils";

/** The cable from the robot's hand: a dip, then straight into the socket (the jack slides along the straight part). */
const WIRE = "M-3 18C10 34 34 18 50 18H110";

/** Sidebar footer of a module (Telegram, YouTrack): the AI robot plugs a cable into the service's socket. "on" = plugged,
 *  `live` sends pulses service → AI; "try" reaches the jack in and out (connecting); "off" pulls it out to hang loose.
 *  `href` makes the card the way to fix it (setup / login). Motion lives in globals.css (.plug-*). */
export function AiPlug({ pose, live, icon, sock, title, sub, subWarn, hint, href, textClass, testId }: {
  pose: "on" | "try" | "off"; live: boolean; icon: ReactNode; sock: string; title: string; sub: string; subWarn?: boolean;
  hint: { title: string; text: string }; href?: string; textClass?: string; testId?: string;
}) {
  // All well (plugged in, live): one quiet line, so the sidebar keeps its room; the robot scene is for when something is off.
  if (pose === "on" && live && !href) return (
    <Hint title={hint.title} text={hint.text}>
      <div className="flex items-center gap-2.5 px-1.5 py-1">
        <span data-testid={testId && `${testId}-state`} data-pose={pose} className={cn("relative grid size-7 shrink-0 place-items-center rounded-full", sock)}>
          <span className="grid scale-90 place-items-center">{icon}</span>
          <span aria-hidden className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-ok ring-2 ring-paper-2" />
        </span>
        <span className={cn("grid min-w-0 whitespace-nowrap text-xs leading-tight", textClass)}>
          <span className="truncate font-medium text-ink-2">{title}</span>
          <span data-testid={testId && `${testId}-sub`} className="truncate text-ink-3">{sub}</span>
        </span>
      </div>
    </Hint>
  );
  const body = (
    <>
      <span data-testid={testId && `${testId}-state`} data-pose={pose} className="plug flex items-center">
        <AiBot className={cn("plug-bot size-9 shrink-0", pose === "try" && "ai-hop")} />
        <svg viewBox="0 0 128 32" aria-hidden className="h-8 w-32 shrink-0 overflow-visible">
          <path d={WIRE} fill="none" strokeWidth="2.5" strokeLinecap="round" className="plug-wire" />
          {live && pose === "on" && <path d={WIRE} fill="none" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="2 10" className="plug-pulse" />}
          <g className="plug-jack">
            <rect x="120" y="14" width="8" height="1.8" rx="0.9" className="plug-prong" />
            <rect x="120" y="20.2" width="8" height="1.8" rx="0.9" className="plug-prong" />
            <rect x="107" y="11.5" width="14" height="13" rx="3.5" className="plug-head" />
          </g>
          {pose === "on" && <path d="M127 9v-4M127 27v4M121 11l-3-3M121 25l-3 3" strokeWidth="1.6" strokeLinecap="round" className="plug-spark" />}
          {pose === "off" && <path d="M121 9.5l3.5 5-3.5 2.5 3.5 5" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="plug-zap" />}
        </svg>
        <span className={cn("plug-sock relative grid size-8 shrink-0 place-items-center rounded-full transition-[opacity,filter] duration-(--dur-short)", sock, pose === "off" && "opacity-60 grayscale")}>
          <span className="relative grid place-items-center">{icon}</span>
        </span>
        <span className="sr-only">{title}</span>
      </span>
      <span className={cn("grid min-w-0 gap-0.5 whitespace-nowrap px-0.5 text-xs leading-tight", textClass)}>
        <span className={cn("truncate font-semibold", pose === "on" ? "text-ink" : pose === "try" ? "text-ink-2" : "text-warn")}>{title}</span>
        <span data-testid={testId && `${testId}-sub`} className={cn("truncate", subWarn ? "text-warn" : "text-ink-3")}>{sub}</span>
      </span>
    </>
  );
  const card = "grid gap-1.5 rounded-[var(--radius-card)] bg-cotton p-2.5 shadow-stock";
  return (
    <Hint title={hint.title} text={hint.text}>
      {href ? (
        <Link href={href} className={cn(card, "transition-[scale] duration-(--dur-micro) hover:scale-[1.02]")}>{body}</Link>
      ) : (
        <div className={card}>{body}</div>
      )}
    </Hint>
  );
}
