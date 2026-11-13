"use client";

// The UI flow engine (web/public/uiflow.js, plain JS, also inlined in every exported file) in React: loaded once by a
// <script> tag, mounted on an element. The engine owns its DOM; React only hands it a flow and hears its changes.

import { useEffect, useRef, useState } from "react";
import { type Lang, t } from "@/lib/i18n";
import type { FlowShot, UiFlow } from "@/lib/yt";

/** What the dashboard uses of the engine's api (it also has mode / goto / fit / undo, driven by its own toolbar). */
type FlowApi = {
  get(): UiFlow;
  /** Replace the flow, treated as clean (it lays the screens out and clears the undo history). */
  set(f: UiFlow): void;
  /** New Zeplin images: the frames redraw, positions stay. */
  shots(s: Shots): void;
  destroy(): void;
};
type Shots = Record<string, FlowShot>;
type Engine = {
  mount(el: HTMLElement, f: UiFlow, o: { edit?: boolean; lang?: Lang; shots?: Shots; onChange?: (f: UiFlow, dirty: boolean) => void }): FlowApi;
};
/** The engine's global. Not a `declare global`: the engine's own spec declares the same name with its own types. */
const win = () => window as unknown as { UIFlow?: Engine };

let loading: Promise<Engine> | null = null;
/** The engine, its script added once per page; a failed load is forgotten so the next call tries again. */
function loadEngine(): Promise<Engine> {
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
export function useUiFlow(el: HTMLElement | null, flow: UiFlow | null, { lang, onChange, shots }: { lang: Lang; onChange: (f: UiFlow, dirty: boolean) => void; shots?: Shots }) {
  const [api, setApi] = useState<FlowApi | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [tries, setTries] = useState(0);
  const latest = useRef({ flow, onChange, lang, shots });
  const shown = useRef<UiFlow | null>(null);
  const drawn = useRef<Shots | undefined>(undefined);
  useEffect(() => { latest.current = { flow, onChange, lang, shots }; });
  const has = !!flow;
  useEffect(() => {
    if (!el || !has) return;
    let gone = false, a: FlowApi | null = null;
    loadEngine().then((E) => {
      if (gone) return;
      shown.current = latest.current.flow;
      drawn.current = latest.current.shots;
      a = E.mount(el, shown.current!, { edit: true, lang: latest.current.lang, shots: drawn.current, onChange: (f, d) => latest.current.onChange(f, d) });
      setApi(a);
    }, (e: Error) => { if (!gone) setError(e); });
    return () => { gone = true; a?.destroy(); setApi(null); };
  }, [el, has, tries]);
  useEffect(() => {
    if (api && flow && flow !== shown.current) { shown.current = flow; api.set(flow); }
  }, [api, flow]);
  useEffect(() => {
    if (api && shots && shots !== drawn.current) { drawn.current = shots; api.shots(shots); }
  }, [api, shots]);
  return { api, error, retry: () => { setError(null); setTries((n) => n + 1); } };
}

/** The Zeplin links of a flow's screens, sorted: the key the images are fetched by. */
export const zeplinUrls = (f: UiFlow | null) =>
  [...new Set((f?.screens ?? []).map((s) => (s as { zeplin?: string }).zeplin).filter((u): u is string => !!u))].sort();

const PACK_W = 780; // 2× the 390 frame: sharp when zoomed in, small enough to embed tens of screens
const PACK_MAX = 1_400_000; // = uiflow.MAX_SHOT (1.5 MB) with margin: past it the screen is drawn plain in the file
const packed = new Map<string, Promise<string>>(); // image URL -> its data URI, encoded once per page

/** One Zeplin image as a compact data URI: scaled to PACK_W, WebP (JPEG where the browser cannot write WebP). Read
 *  through the backend (same origin): Zeplin's image redirect has no CORS, which would taint the canvas. toBlob encodes
 *  off the main thread. */
function pack(src: string): Promise<string> {
  let p = packed.get(src);
  if (!p) {
    p = new Promise<string>((ok, fail) => {
      const img = new Image();
      img.onerror = () => fail(new Error("image"));
      img.onload = () => {
        const w = Math.min(img.naturalWidth, PACK_W), h = Math.round((img.naturalHeight * w) / img.naturalWidth);
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d")?.drawImage(img, 0, 0, w, h);
        const read = (b: Blob | null) => {
          if (!b) return fail(new Error("encode"));
          const r = new FileReader();
          r.onload = () => ok(String(r.result));
          r.onerror = () => fail(new Error("read"));
          r.readAsDataURL(b);
        };
        c.toBlob((b) => (b?.type === "image/webp" ? read(b) : c.toBlob(read, "image/jpeg", 0.82)), "image/webp", 0.8);
      };
      img.src = `/api/yt/flow/image?u=${encodeURIComponent(src)}`;
    });
    p.catch(() => packed.delete(src)); // a failed one is tried again on the next save
    packed.set(src, p);
  }
  return p;
}

/** The images a flow's file embeds ({url: shot with a data URI}) and how many could not be packed (drawn plain). */
export async function packShots(f: UiFlow, shots: Shots | undefined): Promise<{ shots: Shots; failed: number }> {
  const urls = zeplinUrls(f).filter((u) => shots?.[u]);
  const got = await Promise.all(urls.map((u) => pack(shots![u].src).then((src) => (src.length <= PACK_MAX ? src : null), () => null)));
  const out: Shots = {};
  urls.forEach((u, i) => { if (got[i]) out[u] = { ...shots![u], src: got[i] }; });
  return { shots: out, failed: urls.length - Object.keys(out).length };
}
