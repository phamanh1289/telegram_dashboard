"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { BookOpen, Bug, Check, Cpu, Ellipsis, Eye, FileText, HelpCircle, ImagePlus, Info, Lightbulb, Send, Settings, Sparkles, Square, TriangleAlert, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Card, linkCls, PickPill, picked, StatusLine, tMap, useStatus } from "@/features/settings/components/parts";
import { clearPrefill, type ContactDraft, PREFILL_EVENT, readPrefill } from "@/features/settings/lib/contact-prefill";
import { AiAsk } from "@/features/youtrack/components/bits";
import { AiWriting } from "@/shared/components/ai/chat";
import type { components } from "@/shared/lib/api.generated";
import { Button } from "@/shared/components/ui/button";
import { CharCount } from "@/shared/components/ui/char-count";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/shared/components/ui/dialog";
import { Fold, FoldMore } from "@/shared/components/ui/fold";
import { Hint } from "@/shared/components/ui/hint";
import { Input } from "@/shared/components/ui/input";
import { Segmented } from "@/shared/components/ui/segmented";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Textarea } from "@/shared/components/ui/textarea";
import { YtLogo } from "@/shared/components/yt-logo";
import { api, apiStream, errorText, updateStateQuery } from "@/shared/lib/api";
import { type Key, useT } from "@/shared/lib/i18n";
import { toast } from "@/shared/lib/notifications";
import { put, readJson } from "@/shared/lib/prefs";
import { cn, MOD } from "@/shared/lib/utils";

type Req = components["schemas"]["ContactRequest"];
type Preview = components["schemas"]["ContactPreview"];
type Polish = components["schemas"]["ContactPolish"];
type Draft = ContactDraft;
type Photo = { id: number; name: string; url: string; b64: string };

const DRAFT_KEY = "contact-draft";
const MAX_PHOTOS = 5, MAX_BYTES = 5 * 1024 * 1024; // backend/telegram_dashboard/telegram/contact.py
const TYPES = ["image/png", "image/jpeg", "image/webp"]; // sent as they are; anything else is redrawn as JPEG
const MAX_SIDE = 2560;
// Limits (backend ContactRequest too): a one-line title, and a description that keeps the whole message (with the
// machine info, ~500 characters) inside one Telegram message (4096); more detail belongs in screenshots / log.txt.
const TITLE_MAX = 120, TEXT_MAX = 3000;
/** Per type: chip, what it is for (hover), what to write (the line under the chips) and the two placeholders. */
const KINDS: { value: Req["kind"]; label: Key; icon: typeof Bug; hint: Key; guide: Key; title: Key; text: Key }[] = [
  { value: "bug", label: "Báo lỗi", icon: Bug, hint: "App chạy sai, treo hoặc báo lỗi.",
    guide: "Ghi các bước để gặp lỗi, kết quả thực tế và kết quả mong đợi. Ảnh chụp màn hình và Log lỗi giúp xử lý nhanh hơn.",
    title: "Tóm tắt lỗi trong một câu, vd: Gửi ảnh trong nhóm bị treo",
    text: "Các bước để gặp lỗi:\n1. Mở …\n2. Bấm …\n\nKết quả thực tế: thấy gì, thông báo lỗi nếu có\nKết quả mong đợi: đúng ra phải thế nào\nTần suất: lần nào cũng bị / thỉnh thoảng" },
  { value: "feature", label: "Tính năng", icon: Sparkles, hint: "Việc app chưa làm được mà bạn cần.",
    guide: "Nêu việc bạn cần làm được, dùng trong tình huống nào và thế nào là xong. Có cách làm tạm hiện tại thì ghi luôn.",
    title: "Tính năng cần có, vd: Lọc tin theo người gửi",
    text: "Cần làm được: …\nDùng khi: tình huống, ai dùng, bao lâu một lần\nHiện đang làm tạm thế nào: …\nThế nào là xong: kết quả bạn mong đợi" },
  { value: "idea", label: "Góp ý", icon: Lightbulb, hint: "Cải thiện điều app đã có: dễ dùng hơn, nhanh hơn, rõ hơn.",
    guide: "Chỉ rõ chỗ đang chưa ổn, đề xuất đổi thành gì và lợi ích mang lại.",
    title: "Điều nên cải thiện, vd: Nút Gửi khó thấy trên màn hẹp",
    text: "Hiện tại: đang thế nào, chỗ nào chưa ổn\nĐề xuất: nên đổi thành gì\nLý do: lợi ích cho bạn / team" },
  { value: "question", label: "Câu hỏi", icon: HelpCircle, hint: "Hỏi cách dùng hoặc cách app hoạt động.",
    guide: "Hỏi thẳng điều cần biết, kèm màn đang mở và điều bạn đã thử.",
    title: "Câu hỏi ngắn, vd: Briefing tự chạy lúc mấy giờ?",
    text: "Bạn muốn biết điều gì, đang ở màn nào, đã thử gì…" },
];
/** Each area with the icon its page has in the nav (Telegram, YouTrack, AI) or its own. */
const AREAS: [Req["area"], Key, React.ComponentType<{ className?: string }>][] = [["telegram", "Telegram", Send], ["youtrack", "YouTrack", YtLogo], ["docs", "Tài liệu", BookOpen], ["ai", "AI", Sparkles], ["settings", "Cài đặt", Settings], ["other", "Khác", Ellipsis]];
const MIN_H = 560; // below this the page scrolls instead of squeezing the description
const EMPTY: Draft = { kind: "bug", area: "telegram", title: "", text: "" };
let seq = 0;

/** A photo Telegram takes as is: kept when it already fits (PNG / JPG / WebP, ≤ MAX_SIDE, ≤ 5 MB), else redrawn as a JPEG
 *  ≤ MAX_SIDE (big Retina screenshots, HEIC, GIF…); null when the browser can't open it or it still won't fit. */
async function fit(f: File): Promise<Blob | null> {
  let img: ImageBitmap;
  try { img = await createImageBitmap(f); } catch { return null; }
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  if (scale === 1 && TYPES.includes(f.type) && f.size <= MAX_BYTES) { img.close(); return f; }
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  const x = c.getContext("2d");
  if (!x) return null;
  x.fillStyle = "#fff"; // JPEG has no transparency
  x.fillRect(0, 0, c.width, c.height);
  x.drawImage(img, 0, 0, c.width, c.height);
  img.close();
  for (const q of [0.85, 0.7]) {
    const b = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", q));
    if (b && b.size <= MAX_BYTES) return b;
  }
  return null;
}
const dataUrl = (b: Blob) => new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(r.error); r.readAsDataURL(b); });

/** The type: one tile per kind (icon, name, what it is for), the picked one's highlight sliding between them. */
function KindTiles({ value, onChange }: { value: Req["kind"]; onChange: (v: Req["kind"]) => void }) {
  const t = useT();
  const reduce = useReducedMotion();
  return (
    <div role="radiogroup" aria-label={t("Loại")} className="grid grid-cols-2 gap-2 @3xl:grid-cols-4">
      {KINDS.map((k) => {
        const on = k.value === value;
        return (
          <motion.button key={k.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(k.value)} whileTap={reduce ? undefined : { scale: 0.97 }}
            className={cn("flex items-start gap-2.5 rounded-lg border p-2.5 text-left", picked(on))}>
            <PickPill id="contact-kind" on={on} className="rounded-lg" />
            <motion.span animate={{ scale: on && !reduce ? [1, 1.15, 1] : 1 }} transition={{ duration: 0.32 }}
              className={cn("grid size-8 shrink-0 place-items-center rounded-md transition-colors duration-(--dur-short)", on ? "bg-hl text-hl-ink" : "bg-paper-2 text-ink-3")}>
              <k.icon className="size-4" aria-hidden />
            </motion.span>
            <span className="grid min-w-0 gap-0.5">
              <span className={cn("text-sm font-medium transition-colors duration-(--dur-short)", on ? "text-hl-2" : "text-ink")}>{t(k.label)}</span>
              <span className="hidden text-xs leading-snug text-ink-3 @sm:block">{t(k.hint)}</span>
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}

/** A field's name (its `<label>`) and, on the right, how much of its limit is used. */
const FieldHead = ({ id, label, n, max }: { id: string; label: string; n: number; max: number }) => (
  <div className="flex items-end justify-between gap-3">
    <label htmlFor={id} className="text-xs font-medium text-ink-2">{label}</label>
    <CharCount n={n} max={max} />
  </div>
);

const chipCls = (on: boolean) => cn("flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-[background-color,border-color,color] duration-(--dur-micro) disabled:pointer-events-none disabled:opacity-50",
  on ? "border-hl/40 bg-hl-wash text-hl-2" : "border-rule text-ink-3 hover:border-rule-2 hover:text-ink-2");

/** The height that takes `ref` to the bottom of the window less the page's bottom padding, so the page itself does not
 *  scroll; MIN_H at least (a short window scrolls the page rather than squeeze the form). null below the page's `md`
 *  layout (the menu on top, chips wrapping): the form keeps its natural height there and the page scrolls. */
function useFillHeight(ref: React.RefObject<HTMLElement | null>) {
  const [h, setH] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const wide = matchMedia("(min-width: 48rem)");
    const fit = () => {
      if (!wide.matches) return setH(null);
      const pad = parseFloat(getComputedStyle(el.closest("main")?.parentElement ?? el).paddingBottom) || 0;
      setH(Math.max(MIN_H, Math.floor(innerHeight - (el.getBoundingClientRect().top + scrollY) - pad)));
    };
    fit();
    // The window, and anything above that settles late (fonts, the header's wrap): `fit` never moves our own top, so
    // the observer settles after one pass.
    const ro = new ResizeObserver(fit);
    ro.observe(document.body);
    addEventListener("resize", fit);
    wide.addEventListener("change", fit);
    return () => { ro.disconnect(); removeEventListener("resize", fit); wide.removeEventListener("change", fit); };
  }, [ref]);
  return h;
}

/** One on / off chip in the composer's toolbar (what goes along with the message): its icon turns into a tick when on. */
function Toggle({ on, onChange, hint, icon: Icon, label }: { on: boolean; onChange: (v: boolean) => void; hint: string; icon: typeof Bug; label: string }) {
  const swap = "absolute inset-0 size-3.5 transition-[opacity,scale] duration-(--dur-short) ease-(--ease-out)";
  return (
    <Hint text={hint}>
      <button type="button" aria-pressed={on} onClick={() => onChange(!on)} className={chipCls(on)}>
        <span className="relative size-3.5" aria-hidden>
          <Icon className={cn(swap, on && "scale-50 opacity-0")} /><Check className={cn(swap, !on && "scale-50 opacity-0")} />
        </span>
        {label}
      </button>
    </Hint>
  );
}

/** The AI's answer so far as (title, description): its title line until the "---" line comes, then both. */
function livePolish(s: string, d: Draft) {
  const i = s.indexOf("\n---\n");
  return i < 0 ? { title: s.trim() || d.title, text: d.text } : { title: s.slice(0, i).trim(), text: s.slice(i + 5) };
}

/** Browser, language and window size: the part of the machine info only the page knows. */
function clientLine() {
  const browser = navigator.userAgent.match(/(Edg|Chrome|Firefox|Version)\/[\d.]+/)?.[0]?.replace("Version", "Safari") ?? "?";
  return `${browser} · ${navigator.language} · ${innerWidth}×${innerHeight}`;
}

const kindOf = (k: Req["kind"]) => KINDS.find((x) => x.value === k) ?? KINDS[0];
const fadeIn = (reduce: boolean | null) => reduce ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 0 } }
  : { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -4 } };

/** The photos going along (≤ MAX_PHOTOS, each one Telegram takes) and why some were left out. */
function usePhotos() {
  const t = useT();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [bad, setBad] = useState("");
  const add = async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    const room = MAX_PHOTOS - photos.length;
    const got = (await Promise.all(imgs.slice(0, room).map(async (f) => {
      const b = await fit(f);
      const url = b && await dataUrl(b).catch(() => null);
      return url ? { id: ++seq, name: f.name || t("Ảnh dán"), url, b64: url.slice(url.indexOf(",") + 1) } : null;
    }))).filter((p) => p !== null);
    setPhotos((p) => [...p, ...got].slice(0, MAX_PHOTOS));
    setBad(imgs.length > room ? t("Tối đa {n} ảnh.", { n: MAX_PHOTOS }) : got.length < imgs.length ? t("Có ảnh không mở được, đã bỏ qua.") : "");
  };
  const remove = (id: number) => setPhotos((x) => x.filter((y) => y.id !== id));
  const clear = () => { setPhotos([]); setBad(""); };
  return { photos, bad, add, remove, clear };
}
type Photos = ReturnType<typeof usePhotos>;

/** AI viết lại: one tool-less run; the answer streams into the fields (`live`), then a toast offers to undo it. */
function usePolish(d: Draft, setD: React.Dispatch<React.SetStateAction<Draft>>) {
  const t = useT();
  const [partial, setPartial] = useState<string | null>(null);
  const stop = useRef<AbortController | null>(null);
  const polish = useMutation({
    mutationFn: (before: Draft) => {
      stop.current = new AbortController();
      setPartial("");
      return apiStream<Polish>("/contact/polish", { kind: before.kind, area: before.area, title: before.title, text: before.text }, stop.current.signal, setPartial);
    },
    onSuccess: (r, before) => {
      setD((x) => ({ ...x, title: r.title, text: r.text }));
      toast({ text: t("AI đã viết lại tiêu đề và mô tả"), undo: () => setD(before) });
    },
    onSettled: () => setPartial(null),
  });
  const err = polish.isError && !(polish.error instanceof Error && polish.error.name === "AbortError")
    ? errorText(polish.error, {}, t("AI không viết lại được, thử lại.")) : "";
  return { run: polish.mutate, writing: polish.isPending, live: partial !== null ? livePolish(partial, d) : null, err, stop: () => stop.current?.abort() };
}

/** The "update first" notice (bugs only), the type tiles, the area, and what to write for the type. */
function ContactHead({ d, edit }: { d: Draft; edit: (p: Partial<Draft>) => void }) {
  const t = useT();
  const fade = fadeIn(useReducedMotion());
  const behind = useQuery({ ...updateStateQuery, retry: false }).data?.behind ?? 0;
  return (
    <>
      <div className="grid gap-2">{/* no gap around the folded notice */}
        <Fold open={d.kind === "bug" && behind > 0}>
          <p className="mb-1 flex flex-wrap items-center gap-x-2 rounded-md bg-signal-wash px-3 py-2 text-xs text-signal-2">
            <TriangleAlert aria-hidden className="size-3.5 shrink-0" />{t("Đang chậm {n} bản: lỗi có thể đã được sửa ở bản mới.", { n: behind })}
            <a href="#github" className={linkCls}>{t("Cập nhật trước")}</a>
          </p>
        </Fold>
        <KindTiles value={d.kind} onChange={(v) => edit({ kind: v })} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-xs font-medium text-ink-2">{t("Khu vực")}</span>
        <Segmented id="contact-area" variant="card" label={t("Khu vực")} value={d.area} onChange={(v) => edit({ area: v })}
          items={AREAS.map(([value, k, Icon]) => ({ value, label: <><Icon className="size-3.5" />{t(k)}</> }))} />
      </div>
      <div className="flex gap-2 rounded-md bg-paper-2 px-3 py-2 text-xs leading-relaxed text-ink-2">
        <Info aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ink-3" />
        <AnimatePresence mode="wait" initial={false}>
          <motion.p key={d.kind} {...fade} transition={{ duration: 0.16 }}>{t(kindOf(d.kind).guide)}</motion.p>
        </AnimatePresence>
      </div>
    </>
  );
}

/** The photos under the description, each with its remove button, and the privacy reminder. */
function PhotoStrip({ ph }: { ph: Photos }) {
  const t = useT();
  const reduce = useReducedMotion();
  return (
    <Fold open={ph.photos.length > 0}>
      <div className="grid gap-1.5 px-3 pb-2.5">
        <div className="flex flex-wrap gap-2">
          <AnimatePresence initial={false}>
            {ph.photos.map((p) => (
              <motion.figure key={p.id} layout={!reduce} initial={reduce ? false : { opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
                className="group relative size-16 overflow-hidden rounded-md border border-rule bg-paper-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- a local data: URL, nothing to optimise */}
                <img src={p.url} alt={p.name} className="size-full object-cover transition-transform duration-(--dur-short) ease-(--ease-out) group-hover:scale-105" />
                <button type="button" aria-label={t("Bỏ ảnh {name}", { name: p.name })} onClick={() => ph.remove(p.id)}
                  className="absolute top-0.5 right-0.5 grid size-5 place-items-center rounded-full bg-ink/70 text-paper opacity-0 transition-opacity duration-(--dur-micro) group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100">
                  <X className="size-3" aria-hidden />
                </button>
              </motion.figure>
            ))}
          </AnimatePresence>
        </div>
        <span className="text-xs text-ink-3">{t("Ảnh chụp có thể lộ tin nhắn của khách hàng: kiểm tra trước khi gửi.")}</span>
      </div>
    </Fold>
  );
}

/** The description box: text (photos pasted / dropped in), the photos, and the toolbar of what goes along + AI viết lại. */
function DescBox({ id, text, placeholder, onText, d, ph, ai, diag, setDiag, logs, setLogs }: {
  id: string; text: string; placeholder: string; onText: (v: string) => void; d: Draft; ph: Photos; ai: ReturnType<typeof usePolish>;
  diag: boolean; setDiag: (v: boolean) => void; logs: boolean; setLogs: (v: boolean) => void;
}) {
  const t = useT();
  const reduce = useReducedMotion();
  const [over, setOver] = useState(false); // a file dragged over the composer
  const file = useRef<HTMLInputElement>(null);
  const textBox = useRef<HTMLTextAreaElement>(null);
  const { writing } = ai;
  return (
    <div className={cn("relative flex min-h-0 flex-1 flex-col rounded-md border bg-cotton transition-colors duration-(--dur-micro) focus-within:border-hl", over ? "border-hl" : "border-rule-2 hover:border-ink-3", writing && "ai-ring")}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
      onDrop={(e) => { e.preventDefault(); setOver(false); void ph.add([...e.dataTransfer.files]); }}>
      <Textarea id={id} ref={textBox} maxLength={TEXT_MAX} value={text} readOnly={writing} aria-busy={writing} onChange={(e) => onText(e.target.value)} placeholder={placeholder}
        className="min-h-48 flex-1 resize-none md:min-h-24 overflow-y-auto border-0 bg-transparent field-sizing-fixed hover:border-0 focus-visible:outline-none"
        onPaste={(e) => { const f = [...e.clipboardData.files]; if (f.length) { e.preventDefault(); void ph.add(f); } }} />
      <PhotoStrip ph={ph} />
      <div className="flex flex-wrap items-center gap-1.5 border-t border-rule px-2 py-1.5">
        <Hint text={t("Thêm ảnh (tối đa 5, ảnh lớn tự thu nhỏ). Dán ⌘V hoặc kéo thả vào ô này cũng được.")}>
          <button type="button" className={chipCls(ph.photos.length > 0)} disabled={ph.photos.length >= MAX_PHOTOS} onClick={() => file.current?.click()}>
            <ImagePlus aria-hidden className="size-3.5" />{ph.photos.length ? `${ph.photos.length}/${MAX_PHOTOS}` : t("Ảnh")}
          </button>
        </Hint>
        <Toggle on={diag} onChange={setDiag} icon={Cpu} label={t("Thông tin máy")}
          hint={t("Kèm phiên bản app, hệ điều hành, trình duyệt, trạng thái Telegram / YouTrack. Không gửi token, tin nhắn hay tên nhóm.")} />
        <AnimatePresence initial={false}>
          {d.kind === "bug" && (
            <motion.span key="logs" initial={reduce ? false : { opacity: 0, width: 0 }} animate={{ opacity: 1, width: "auto" }} exit={reduce ? { opacity: 0 } : { opacity: 0, width: 0 }} className="overflow-hidden">
              <Toggle on={logs} onChange={setLogs} icon={FileText} label={t("Log lỗi")}
                hint={t("Kèm cảnh báo / lỗi của app trong 24 giờ qua thành file log.txt (đã ẩn SĐT / email); xem được trước khi gửi.")} />
            </motion.span>
          )}
        </AnimatePresence>
        <span className="ml-auto flex items-center gap-2">
          {writing ? <>
            <AiWriting label={t("AI đang viết lại")} />
            <Hint text={t("Dừng, giữ nguyên bản của bạn")}>
              <Button variant="outline" size="icon-xs" className="rounded-full" aria-label={t("Dừng")} onClick={ai.stop}><Square className="fill-current" aria-hidden /></Button>
            </Hint>
          </> : (
            <AiAsk label={t("AI viết lại mô tả")} hint={t("Viết lại cho rõ: các bước, kết quả, mong đợi. Bạn xem rồi giữ hoặc hoàn tác.")}
              onClick={() => (d.text.trim() ? ai.run(d) : textBox.current?.focus())} />
          )}
        </span>
      </div>
      <div aria-hidden className={cn("pointer-events-none absolute inset-0 grid place-items-center rounded-md border-2 border-dashed border-hl bg-hl-wash/90 text-sm font-medium text-hl-2 transition-opacity duration-(--dur-short)", !over && "opacity-0")}>
        <span className={cn("flex items-center gap-2 transition-transform duration-(--dur-short) ease-(--ease-out)", !over && "scale-95")}><ImagePlus className="size-5" />{t("Thả ảnh vào đây")}</span>
      </div>
      <input ref={file} type="file" accept="image/*" multiple hidden onChange={(e) => { void ph.add([...(e.target.files ?? [])]); e.target.value = ""; }} />
    </div>
  );
}

/** Cài đặt › Liên hệ: a bug report / request with photos, previewed, then sent to the developer as a Telegram DM from this account. */
export function ContactGroup() {
  const t = useT();
  // A toast's "Báo lỗi" opens this with its report; else the saved draft.
  const [d, setD] = useState<Draft>(() => readPrefill() ?? { ...EMPTY, ...(readJson(DRAFT_KEY, {}) as Partial<Draft>) });
  useEffect(() => {
    clearPrefill();
    const apply = () => { const p = readPrefill(); if (p) { setD(p); clearPrefill(); } }; // a toast's report, open already
    addEventListener(PREFILL_EVENT, apply);
    return () => removeEventListener(PREFILL_EVENT, apply);
  }, []);
  const [logs, setLogs] = useState(false);
  const [diag, setDiag] = useState(true);
  const [req, setReq] = useState<Req | null>(null); // the message last previewed (photos as base64); kept while the dialog animates out
  const [open, setOpen] = useState(false);
  const ph = usePhotos();
  const ai = usePolish(d, setD);
  const { writing, live } = ai;
  const fade = fadeIn(useReducedMotion());
  const box = useRef<HTMLDivElement>(null);
  const height = useFillHeight(box);
  const kind = kindOf(d.kind);
  useEffect(() => { put(DRAFT_KEY, d.title || d.text ? JSON.stringify(d) : null); }, [d]); // text survives a reload or a failed send
  const edit = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));

  const ready = !!d.title.trim() && !!d.text.trim();
  const preview = () => { setReq({ ...d, diag, logs: logs && d.kind === "bug", client: diag ? clientLine() : "", photos: ph.photos.map((p) => p.b64) }); setOpen(true); };
  const sent = () => { setOpen(false); setD(EMPTY); ph.clear(); toast({ text: t("Đã gửi cho nhà phát triển qua Telegram") }); };

  const title = live?.title ?? d.title, text = live?.text ?? d.text;
  const ids = useId();
  const errs = [ph.bad && { k: "bad", tone: "text-warn", msg: ph.bad }, ai.err && { k: "ai", tone: "text-error", msg: ai.err }].filter((x) => !!x);

  return (
    <div ref={box} className="@container min-w-0" style={height ? { height } : undefined}>
    <Card fill title="Gửi cho nhà phát triển" info="Gửi bằng tài khoản Telegram đang đăng nhập trong app, thành tin nhắn riêng tới nhà phát triển; ảnh đi kèm thành một album. Câu trả lời sẽ về Telegram của bạn.">
      <div className="flex min-h-0 flex-col gap-4 pt-1" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && ready && !writing) { e.preventDefault(); preview(); } }}>
        <ContactHead d={d} edit={edit} />
        <div className="grid gap-1.5">
          <FieldHead id={`${ids}t`} label={t("Tiêu đề")} n={title.length} max={TITLE_MAX} />
          <Input id={`${ids}t`} maxLength={TITLE_MAX} value={title} readOnly={writing} onChange={(e) => edit({ title: e.target.value })} placeholder={t(kind.title)} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-1.5">
          <FieldHead id={`${ids}d`} label={t("Mô tả")} n={text.length} max={TEXT_MAX} />
          <DescBox id={`${ids}d`} text={text} placeholder={t(kind.text)} onText={(v) => edit({ text: v })} d={d} ph={ph} ai={ai}
            diag={diag} setDiag={setDiag} logs={logs} setLogs={setLogs} />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="grid min-w-0 flex-1 gap-1">
            <AnimatePresence initial={false}>
              {errs.map((x) => (
                <motion.p key={x.k} role="alert" {...fade} className={cn("flex items-start gap-1.5 text-xs", x.tone)}>
                  <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />{x.msg}
                </motion.p>
              ))}
            </AnimatePresence>
          </div>
          <Hint text={t("Xem đúng tin sẽ gửi (⌘Enter)")}>
            <Button className="ml-auto rounded-full px-4" disabled={!ready || writing} onClick={preview}>
              <Eye aria-hidden />{t("Xem trước")}<kbd className="ml-1 text-2xs font-normal opacity-60">{MOD}↵</kbd>
            </Button>
          </Hint>
        </div>
      </div>
      {req && <PreviewDialog open={open} req={req} photos={ph.photos} onClose={() => setOpen(false)} onSent={sent} />}
    </Card>
    </div>
  );
}

/** The message as Telegram will show it (text from the server's own compose, then the album); Gửi sends exactly that. */
function PreviewDialog({ open, req, photos, onClose, onSent }: { open: boolean; req: Req; photos: Photo[]; onClose: () => void; onSent: () => void }) {
  const t = useT();
  const reduce = useReducedMotion();
  /** A bubble arriving like a sent message: up from the bottom right; `delay` staggers the album after the text. */
  const pop = (delay: number) => reduce ? {} : { initial: { opacity: 0, y: 8, scale: 0.97 }, animate: { opacity: 1, y: 0, scale: 1 }, transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] as const, delay } };
  const online = useStatus().data?.state === "connected";
  const pv = useQuery({ queryKey: ["contact-preview", { ...req, photos: [] }], retry: false, enabled: open,
    queryFn: ({ signal }) => api<Preview>("/contact/preview", { method: "POST", json: { ...req, photos: [] }, signal }) });
  const send = useMutation({ mutationFn: () => api<void>("/contact", { method: "POST", json: req }), onSuccess: onSent });
  const canSend = online && !!pv.data && !send.isPending;
  const go = () => { send.reset(); send.mutate(); };
  const { reset } = send;
  useEffect(() => { if (open) reset(); }, [open, reset]); // a new preview starts without the last send's error
  const err = send.isError ? errorText(send.error, tMap(t, {
    forbidden: "Không gửi được tới nhà phát triển: tài khoản Telegram của bạn bị chặn hoặc không nhắn được cho người này.",
    bad_photo: "Có ảnh không đọc được, xóa ảnh đó rồi gửi lại.",
    photo_too_large: "Có ảnh lớn hơn 5 MB.",
    validation: "Thiếu tiêu đề hoặc mô tả.",
    delivery_unknown: "Chưa rõ đã gửi chưa (mất kết nối giữa chừng). Xem chat với nhà phát triển trên Telegram trước khi gửi lại.",
  }), t("Không gửi được, thử lại.")) : pv.isError ? errorText(pv.error, {}, t("Không dựng được bản xem trước.")) : "";
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !send.isPending) onClose(); }}>
      <DialogContent showCloseButton={!send.isPending} className="gap-4 sm:max-w-lg"
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSend) { e.preventDefault(); go(); } }}>
        <div className="grid gap-1">
          <DialogTitle>{t("Xem trước tin nhắn")}</DialogTitle>
          <DialogDescription>{pv.data ? t("Gửi tới {to} bằng tài khoản Telegram của bạn.", { to: pv.data.to }) : t("Bằng tài khoản Telegram của bạn.")}</DialogDescription>
        </div>
        <div className="grid max-h-[55vh] auto-rows-max justify-items-end gap-1.5 overflow-y-auto rounded-lg bg-paper-2 p-3 shadow-groove">{/* auto-rows-max: a long message must not squash the album */}
          {pv.data
            ? <motion.p {...pop(0)} className="max-w-[90%] origin-bottom-right rounded-2xl rounded-br-md bg-hl-wash px-3.5 py-2.5 text-sm whitespace-pre-wrap text-ink">{pv.data.text}</motion.p>
            : <Skeleton className="h-40 w-[80%] rounded-2xl" />}
          {!!photos.length && (
            <motion.div {...pop(0.06)} className={cn("grid w-[70%] origin-bottom-right gap-0.5 overflow-hidden rounded-2xl rounded-br-md", photos.length > 1 && "grid-cols-2", photos.length > 2 && "grid-cols-3")}>
              {/* eslint-disable-next-line @next/next/no-img-element -- local data: URLs */}
              {photos.map((p) => <img key={p.id} src={p.url} alt={p.name} className="aspect-square w-full object-cover" />)}
            </motion.div>
          )}
          {pv.data?.log && (
            <FoldMore className="w-[70%] rounded-2xl rounded-br-md bg-hl-wash" labelClassName="gap-2 px-3.5 py-2.5 text-sm"
              label={<><FileText aria-hidden className="size-4 shrink-0" />log.txt <span className="font-normal text-ink-3">{t("{n} dòng", { n: pv.data.log.split("\n").length })}</span></>}>
              <pre className="max-h-48 overflow-auto border-t border-rule px-3.5 py-2 font-mono text-2xs whitespace-pre-wrap text-ink-2">{pv.data.log}</pre>
            </FoldMore>
          )}
        </div>
        {!online && <StatusLine tone="warn">{t("Telegram chưa kết nối:")} <a href="#telegram" onClick={onClose} className={linkCls}>{t("mở Cài đặt › Telegram")}</a></StatusLine>}
        {err && <p role="alert" className="flex gap-2 rounded-lg bg-error-wash px-3 py-2 text-xs text-error"><TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />{err}</p>}
        <DialogFooter className="border-t-0 bg-transparent pt-0">
          <DialogClose disabled={send.isPending} render={<Button variant="outline" />}>{t("Sửa tiếp")}</DialogClose>
          <Button disabled={!canSend} aria-busy={send.isPending} onClick={go}>
            <Send aria-hidden />{send.isPending ? t("Đang gửi…") : t("Gửi")}<kbd className="ml-1 text-2xs font-normal opacity-60">{MOD}↵</kbd>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
