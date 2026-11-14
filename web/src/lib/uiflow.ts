"use client";

// The UI flow engine (web/public/uiflow.js, plain JS, also inlined in every exported file) in React: loaded once by a
// <script> tag, mounted on an element. The engine owns its DOM; React only hands it a flow and hears its changes.

import { useEffect, useRef, useState } from "react";
import { type Lang, t } from "@/lib/i18n";
import { type FlowShot, type UiFlow, yt } from "@/lib/yt";

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
  mount(el: HTMLElement, f: UiFlow, o: { edit?: boolean; lang?: Lang; shots?: Shots; onChange?: (f: UiFlow, dirty: boolean) => void;
    /** "+ Từ Zeplin": one screen's image / size / name; null when Zeplin has no such screen, throws on 401 / network. */
    lookup?: (url: string) => Promise<FlowShot | null> }): FlowApi;
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
  const recovery = useRef<UiFlow | null>(flow);
  const dispose = useRef<(() => void) | null>(null);
  const fail = (e: unknown) => {
    dispose.current?.();
    setError(e instanceof Error ? e : new Error(String(e)));
  };
  useEffect(() => { latest.current = { flow, onChange, lang, shots }; });
  const has = !!flow;
  useEffect(() => {
    if (!el || !has) return;
    let gone = false, a: FlowApi | null = null;
    const clean = () => {
      a?.destroy();
      a = null;
      el.replaceChildren();
      setApi(null);
    };
    dispose.current = clean;
    loadEngine().then((E) => {
      if (gone) return;
      if (shown.current !== latest.current.flow) recovery.current = latest.current.flow;
      drawn.current = latest.current.shots;
      const mountStart = performance.now();
      a = E.mount(el, recovery.current!, { edit: true, lang: latest.current.lang, shots: drawn.current, lookup,
        onChange: (f, d) => { recovery.current = f; latest.current.onChange(f, d); } });
      performance.clearMeasures("uiflow.mount");
      performance.measure("uiflow.mount", { start: mountStart, detail: { screens: recovery.current?.screens.length ?? 0 } });
      shown.current = latest.current.flow;
      setApi(a);
    }).catch((e: unknown) => { if (!gone) fail(e); });
    return () => { gone = true; clean(); dispose.current = null; };
  }, [el, has, tries]);
  useEffect(() => {
    if (api && flow && flow !== shown.current) {
      recovery.current = flow;
      shown.current = flow;
      // Imperative renderer failures must reach the error UI.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      try { api.set(flow); } catch (e) { fail(e); }
    }
  }, [api, flow]);
  useEffect(() => {
    if (api && shots && shots !== drawn.current) {
      drawn.current = shots;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- imperative renderer error
      try { api.shots(shots); } catch (e) { fail(e); }
    }
  }, [api, shots]);
  return { api, error, retry: () => { setError(null); setTries((n) => n + 1); } };
}

/** One Zeplin screen read through the backend (its cache serves the shots query that follows the new screen). */
const lookup = (url: string) => yt.flowShots([url]).then((r) => r.shots[url] ?? null);

/** The Zeplin links of a flow's screens, sorted: the key the images are fetched by. */
export const zeplinUrls = (f: UiFlow | null) =>
  [...new Set((f?.screens ?? []).map((s) => s.zeplin).filter(Boolean))].sort();

const PACK_W = 780; // 2× the 390 frame: sharp when zoomed in, small enough to embed tens of screens
const PACK_MAX = 1_400_000; // = uiflow.MAX_SHOT (1.5 MB) with margin: past it the screen is drawn plain in the file
const PACK_CACHE_ENTRIES = 64;
const PACK_CACHE_BYTES = 16 * 1024 * 1024;
const packed = new Map<string, string>(); // LRU: completed data URIs only
const packing = new Map<string, Promise<string>>(); // at most three active decodes across all saves
let packedBytes = 0, packActive = 0;
const packWaiters: (() => void)[] = [];
async function packSlot() {
  if (packActive < 3) packActive++;
  else await new Promise<void>((resolve) => packWaiters.push(resolve));
}
function packDone() {
  const next = packWaiters.shift();
  if (next) next();
  else packActive--;
}
function cachePacked(src: string, data: string) {
  packed.set(src, data);
  packedBytes += data.length;
  while (packed.size > PACK_CACHE_ENTRIES || packedBytes > PACK_CACHE_BYTES) {
    const oldest = packed.keys().next().value!;
    packedBytes -= packed.get(oldest)!.length;
    packed.delete(oldest);
  }
}
function cachedPack(src: string) {
  const data = packed.get(src);
  if (data !== undefined) { packed.delete(src); packed.set(src, data); }
  return data;
}
/** Three active decodes page-wide; no decoded Image/canvas survives its task. */
async function pack(src: string): Promise<string> {
  const cached = cachedPack(src);
  if (cached !== undefined) return cached;
  const active = packing.get(src);
  if (active) return active;
  await packSlot();
  const ready = cachedPack(src), running = packing.get(src);
  if (ready !== undefined || running) {
    packDone();
    return ready !== undefined ? ready : running!;
  }
  const img = new Image(), canvas = document.createElement("canvas");
  const task = new Promise<string>((ok, fail) => {
    img.onerror = () => fail(new Error("image"));
    img.onload = () => {
      try {
        if (!img.naturalWidth || !img.naturalHeight) throw new Error("image dimensions");
        canvas.width = Math.min(img.naturalWidth, PACK_W);
        canvas.height = Math.round((img.naturalHeight * canvas.width) / img.naturalWidth);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("canvas");
        context.drawImage(img, 0, 0, canvas.width, canvas.height);
        const read = (blob: Blob | null) => {
          if (!blob) return fail(new Error("encode"));
          const reader = new FileReader();
          reader.onload = () => {
            const data = String(reader.result);
            if (data.length > PACK_MAX) return fail(new Error("image too large"));
            ok(data);
          };
          reader.onerror = () => fail(new Error("read"));
          reader.readAsDataURL(blob);
        };
        canvas.toBlob((blob) => {
          try { if (blob?.type === "image/webp") read(blob); else canvas.toBlob(read, "image/jpeg", 0.82); }
          catch (error) { fail(error); }
        }, "image/webp", 0.8);
      } catch (error) { fail(error); }
    };
    img.src = `/api/yt/flow/image?u=${encodeURIComponent(src)}`;
  }).then((data) => { cachePacked(src, data); return data; }).finally(() => {
    packing.delete(src);
    img.onload = img.onerror = null;
    img.removeAttribute("src");
    canvas.width = canvas.height = 0;
    packDone();
  });
  packing.set(src, task);
  return task;
}

/** The images a flow's file embeds ({url: shot with a data URI}) and how many could not be packed (drawn plain);
 *  `onEach(done, total)` as each one is packed. */
export async function packShots(f: UiFlow, shots: Shots | undefined, onEach?: (done: number, total: number) => void): Promise<{ shots: Shots; failed: number }> {
  const start = performance.now();
  const urls = zeplinUrls(f).filter((u) => shots?.[u]);
  let done = 0;
  const out: Shots = {};
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(3, urls.length) }, async () => {
    while (cursor < urls.length) {
      const url = urls[cursor++];
      try { out[url] = { ...shots![url], src: await pack(shots![url].src) }; }
      catch { /* A missing image remains a plain frame; the flow JSON is still saved. */ }
      finally { onEach?.(++done, urls.length); }
    }
  }));
  const failed = urls.length - Object.keys(out).length;
  performance.clearMeasures("uiflow.pack");
  performance.measure("uiflow.pack", { start, detail: { images: urls.length, failed, encodedBytes: Object.values(out).reduce((sum, shot) => sum + shot.src.length, 0) } });
  return { shots: out, failed };
}
