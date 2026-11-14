import { cn } from "@/shared/lib/utils";

/** One of the six categorical hues (1-6), fixed per name: the avatar wash and the sender's name share it. */
export const hueOf = (name: string) => ([...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 0) % 6) + 1;

/** 24px initial on a wash of the name's categorical hue (fixed L/C via tokens). */
/** First letter of the last word that starts with one ("Thảo Lê (PO)" → L, "C-Bank (Valuation)" → C), else any letter. */
const initial = (name: string) =>
  ([...(name.split(/\s+/).findLast((w) => /^[\p{L}\p{N}]/u.test(w)) ?? name.match(/[\p{L}\p{N}]/u)?.[0] ?? "?")][0]).toLocaleUpperCase("vi");

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      style={{ background: `color-mix(in oklch, var(--cat-${hueOf(name)}) 24%, var(--color-cotton))` }}
      className={cn("grid size-6 shrink-0 place-items-center rounded-full text-2xs font-bold text-ink-2", className)}
    >
      {initial(name)}
    </span>
  );
}

