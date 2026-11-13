"use client";

// The UI flow engine (web/public/uiflow.js, plain JS, also inlined in every exported file) in React: loaded once by a
// <script> tag, mounted on an element. The engine owns its DOM; React only hands it a flow and hears its changes.

import { useEffect, useRef, useState } from "react";
import { type Lang, t } from "@/lib/i18n";
import type { UiFlow } from "@/lib/yt";

export type FlowApi = {
  get(): UiFlow;
  /** Replace the flow, treated as clean (its undo history cleared). */
  set(f: UiFlow): void;
  mode(m: "map" | "play"): void;
  goto(id: string): void;
  fit(): void;
  undo(): void;
  destroy(): void;
};
type Engine = {
  layout(f: UiFlow): UiFlow;
  mount(el: HTMLElement, f: UiFlow, o: { edit?: boolean; lang?: Lang; onChange?: (f: UiFlow, dirty: boolean) => void }): FlowApi;
};
/** The engine's global. Not a `declare global`: the engine's own spec declares the same name with its own types. */
const win = () => window as unknown as { UIFlow?: Engine };

let loading: Promise<Engine> | null = null;
/** The engine, its script added once per page; a failed load is forgotten so the next call tries again. */
export function loadEngine(): Promise<Engine> {
  const w = win();
  if (w.UIFlow) return Promise.resolve(w.UIFlow);
  return (loading ??= new Promise<Engine>((ok, fail) => {
    const s = document.createElement("script");
    s.src = "/uiflow.js";
    const bad = () => { loading = null; s.remove(); fail(new Error(t("Không nạp được bộ vẽ UI flow"))); };
    s.onload = () => (w.UIFlow ? ok(w.UIFlow) : bad());
    s.onerror = bad;
    document.head.append(s);
  }));
}

/**
 * Mounts the engine on `el` once both `el` and `flow` exist (editable, in `lang` at that time: a switch mid-edit would
 * cost the edits); a new `flow` afterwards is `set` into it, clean. `onChange(flow, dirty)` on every edit. Unmounts with `el`.
 */
export function useUiFlow(el: HTMLElement | null, flow: UiFlow | null, { lang, onChange }: { lang: Lang; onChange: (f: UiFlow, dirty: boolean) => void }) {
  const [api, setApi] = useState<FlowApi | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [tries, setTries] = useState(0);
  const latest = useRef({ flow, onChange, lang });
  const shown = useRef<UiFlow | null>(null);
  useEffect(() => { latest.current = { flow, onChange, lang }; });
  const has = !!flow;
  useEffect(() => {
    if (!el || !has) return;
    let gone = false, a: FlowApi | null = null;
    loadEngine().then((E) => {
      if (gone) return;
      shown.current = latest.current.flow;
      a = E.mount(el, shown.current!, { edit: true, lang: latest.current.lang, onChange: (f, d) => latest.current.onChange(f, d) });
      setApi(a);
    }, (e: Error) => { if (!gone) setError(e); });
    return () => { gone = true; a?.destroy(); setApi(null); };
  }, [el, has, tries]);
  useEffect(() => {
    if (api && flow && flow !== shown.current) { shown.current = flow; api.set(flow); }
  }, [api, flow]);
  return { api, error, retry: () => { setError(null); setTries((n) => n + 1); } };
}
