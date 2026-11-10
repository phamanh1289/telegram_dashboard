import { useId } from "react";
import type { Provider } from "@/components/ai/prefs";
import { cn } from "@/lib/utils";

// Each AI CLI's mascot (brand colours, not theme tokens): idles on its own (agent-* / ai-blink in globals.css), hops on hover.

const Eyes = ({ y, gap = 4.5, fill }: { y: number; gap?: number; fill: string }) => (
  <g className="ai-blink" fill={fill}>
    <ellipse cx={24 - gap} cy={y} rx="1.7" ry="2.3" />
    <ellipse cx={24 + gap} cy={y} rx="1.7" ry="2.3" />
  </g>
);

/** Claude: a terracotta sunburst whose rays turn slowly around a smiling face. */
function Claude() {
  return (
    <g className="agent-bob">
      <g className="ai-spin" fill="#D97757" style={{ animationDuration: "16s", transformBox: "view-box", transformOrigin: "24px 24px" }}>
        {Array.from({ length: 10 }, (_, i) => (
          <rect key={i} x="21.75" y={i % 2 ? 5 : 1.5} width="4.5" height={i % 2 ? 14 : 17} rx="2.25" transform={`rotate(${i * 36} 24 24)`} />
        ))}
      </g>
      <circle cx="24" cy="24" r="11" fill="#D97757" />
      <circle cx="24" cy="24" r="8.5" fill="#FBF3EC" />
      <Eyes y={23} gap={3.4} fill="#3B2418" />
      <path d="M21.6 27q2.4 2 4.8 0" fill="none" stroke="#3B2418" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="18.8" cy="26.4" r="1.2" fill="#F2A48A" />
      <circle cx="29.2" cy="26.4" r="1.2" fill="#F2A48A" />
    </g>
  );
}

/** Codex: a little terminal bot, prompt chevron nudging, cursor blinking, antenna light pulsing. */
function Codex() {
  return (
    <g className="agent-bob">
      <path d="M24 10V5.5" stroke="#9CA3AF" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="24" cy="4.5" r="2.4" fill="#34D399" className="ai-twinkle" style={{ transformBox: "fill-box", transformOrigin: "center" }} />
      <rect x="4.5" y="10" width="39" height="32" rx="11" fill="#0F1115" stroke="#FFFFFF" strokeOpacity="0.18" />
      <path className="agent-nudge" d="M14 21l6 5-6 5" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <rect className="sk-caret" x="24" y="29" width="10" height="3" rx="1.5" fill="#7DD3FC" />
    </g>
  );
}

/** Antigravity: a gradient planet floating over its shadow, a moon riding its ring. */
function Antigravity() {
  const g = useId();
  return (
    <>
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4F8BFF" />
          <stop offset="0.55" stopColor="#9B6BFF" />
          <stop offset="1" stopColor="#FF7AB6" />
        </linearGradient>
      </defs>
      <ellipse className="agent-shadow" cx="24" cy="44.5" rx="10" ry="2" fill="#9B6BFF" opacity="0.35" />
      <g className="agent-bob" style={{ "--bob": "-3px" } as React.CSSProperties}>
        <circle cx="24" cy="21" r="12.5" fill={`url(#${g})`} />
        <Eyes y={19.5} fill="#FFFFFF" />
        <path d="M21.8 24.6q2.2 1.6 4.4 0" fill="none" stroke="#FFFFFF" strokeWidth="1.4" strokeLinecap="round" />
        <g transform="rotate(-14 24 21)">
          <ellipse cx="24" cy="21" rx="20" ry="5.5" fill="none" stroke="#C7B8FF" strokeWidth="1.5" strokeOpacity="0.85" />
          <circle className="agent-orbit" r="2.3" fill="#FFD166" style={{ offsetPath: 'path("M4 21a20 5.5 0 1 0 40 0a20 5.5 0 1 0 -40 0")' }} />
        </g>
      </g>
    </>
  );
}

const MASCOTS: Record<Provider, () => React.ReactElement> = { claude: Claude, codex: Codex, antigravity: Antigravity };

/** The animated mascot of one AI CLI; size it with `className` (e.g. size-9). */
export function AgentIcon({ provider, className }: { provider: Provider; className?: string }) {
  const Mascot = MASCOTS[provider];
  return (
    <svg viewBox="0 0 48 48" aria-hidden className={cn("agent overflow-visible", className)}>
      {Mascot ? <Mascot /> : <circle cx="24" cy="24" r="16" fill="currentColor" opacity="0.2" />}
    </svg>
  );
}
