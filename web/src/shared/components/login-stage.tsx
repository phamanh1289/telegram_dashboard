"use client";

import { motion, useAnimate, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect } from "react";
import { AiBot } from "@/shared/components/ai/chat";
import { BotStage } from "@/shared/components/ui/empty";

/** What the login mascot does: shy covers its eyes (a secret field has focus), peek half-opens them (the secret is
 *  shown), busy pulses (a request runs), no shakes its head (an error), happy waves (signed in). */
export type Mood = "idle" | "shy" | "peek" | "busy" | "no" | "happy";

/** A tab's sign-in, alone in the middle of the page: the mascot on its stage over one card. The mood rides on
 *  `data-mood` (eyes and head in globals.css); the card shakes once each time it turns to "no". */
export function LoginStage({ mood, title, sub, children }: { mood: Mood; title: ReactNode; sub?: ReactNode; children: ReactNode }) {
  const [card, animate] = useAnimate();
  const still = useReducedMotion();
  useEffect(() => {
    if (mood === "no" && !still && card.current) void animate(card.current, { x: [0, -6, 6, -4, 4, 0] }, { duration: 0.35 });
  }, [mood, still, animate, card]);
  return (
    <main data-mood={mood} className="grid place-items-center px-4 py-10">
      <div className="grid w-full max-w-md justify-items-center gap-4">
        <BotStage className="size-36">
          {mood === "busy" && <span aria-hidden className="absolute inset-8 animate-ping rounded-full bg-hl/20 [animation-duration:1.4s]" />}
          <AiBot key={mood === "happy" ? "happy" : "bot"} className="ai-float relative size-20 drop-shadow-lg" />
        </BotStage>
        <div className="grid gap-1 text-center">
          <h1 className="text-lg font-bold text-ink">{title}</h1>
          {sub && <p className="text-sm text-ink-2">{sub}</p>}
        </div>
        <motion.div ref={card} className="w-full rounded-[var(--radius-card)] border border-rule bg-cotton p-5 shadow-stock">
          {children}
        </motion.div>
      </div>
    </main>
  );
}
