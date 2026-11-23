"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Bug, Cpu, Eye, FileText, HelpCircle, ImagePlus, Lightbulb, Send, Sparkles, Square, TriangleAlert, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Card, linkCls, StatusLine, tMap, useStatus } from "@/features/settings/components/parts";
import { clearPrefill, type ContactDraft, readPrefill } from "@/features/settings/lib/contact-prefill";
import { AiAsk } from "@/features/youtrack/components/bits";
import { AiWriting } from "@/shared/components/ai/chat";
import type { components } from "@/shared/lib/api.generated";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/shared/components/ui/dialog";
import { Dropdown } from "@/shared/components/ui/dropdown";
import { Fold, FoldMore } from "@/shared/components/ui/fold";
import { Hint } from "@/shared/components/ui/hint";
import { Input } from "@/shared/components/ui/input";
import { Segmented } from "@/shared/components/ui/segmented";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Textarea } from "@/shared/components/ui/textarea";
import { api, apiStream, errorText, updateStateQuery } from "@/shared/lib/api";
import { type Key, useT } from "@/shared/lib/i18n";
import { toast } from "@/shared/lib/notifications";
import { put, readJson } from "@/shared/lib/prefs";
import { cn } from "@/shared/lib/utils";

type Req = components["schemas"]["ContactRequest"];
type Preview = components["schemas"]["ContactPreview"];
type Polish = components["schemas"]["ContactPolish"];
type Draft = ContactDraft;
type Photo = { id: number; name: string; url: string; b64: string };

const DRAFT_KEY = "contact-draft";
const MAX_PHOTOS = 5, MAX_BYTES = 5 * 1024 * 1024; // backend/telegram_dashboard/telegram/contact.py
const TYPES = ["image/png", "image/jpeg", "image/webp"]; // sent as they are; anything else is redrawn as JPEG
const MAX_SIDE = 2560;
const KINDS: [Req["kind"], Key, typeof Bug][] = [["bug", "Báo lỗi", Bug], ["feature", "Tính năng", Sparkles], ["idea", "Góp ý", Lightbulb], ["question", "Câu hỏi", HelpCircle]];
const AREAS: [Req["area"], Key][] = [["telegram", "Telegram"], ["youtrack", "YouTrack"], ["docs", "Tài liệu"], ["ai", "AI"], ["settings", "Cài đặt"], ["other", "Khác"]];
const PLACEHOLDER: Record<Req["kind"], Key> = {
  bug: "Đã làm gì, thấy gì, đúng ra phải thế nào…",
  feature: "Cần làm được gì, dùng trong tình huống nào…",
  idea: "Điều gì nên khác đi, vì sao…",
  question: "Bạn muốn hỏi gì…",
};
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

/** One on / off chip in the composer's toolbar (what goes along with the message). */
function Chip({ on, onChange, hint, icon: Icon, label }: { on: boolean; onChange: (v: boolean) => void; hint: string; icon: typeof Bug; label: string }) {
  return (
    <Hint text={hint}>
      <Button variant="ghost" size="xs" aria-pressed={on} onClick={() => onChange(!on)} className={cn(on ? "text-hl-2" : "text-ink-3")}>
        <Icon aria-hidden />{label}
      </Button>
    </Hint>
  );
}

/** The AI's answer so far as (title, description): its title line until the "---" line comes, then both. */
function livePolish(s: string, d: Draft) {
  const i = s.indexOf("\n---\n");
  return i < 0 ? { title: s.trim() || d.title, text: d.text } : { title: s.slice(0, i).trim(), text: s.slice(i + 5) };
}

/** Browser, language and window size: the part of the machine info only the page knows. */
const clientLine = () => `${navigator.userAgent.match(/(Edg|Chrome|Firefox|Version)\/[\d.]+/)?.[0]?.replace("Version", "Safari") ?? "?"} · ${navigator.language} · ${innerWidth}×${innerHeight}`;

/** Cài đặt › Liên hệ: a bug report / request with photos, previewed, then sent to the developer as a Telegram DM from this account. */
export function ContactGroup() {
  const t = useT();
  // A toast's "Báo lỗi" opens this with its report; else the saved draft.
  const [d, setD] = useState<Draft>(() => readPrefill() ?? { ...EMPTY, ...(readJson(DRAFT_KEY, {}) as Partial<Draft>) });
  useEffect(clearPrefill, []);
  const behind = useQuery({ ...updateStateQuery, retry: false }).data?.behind ?? 0;
  const [logs, setLogs] = useState(false);
  const [over, setOver] = useState(false); // a file dragged over the composer
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [diag, setDiag] = useState(true);
  const [bad, setBad] = useState("");
  const [req, setReq] = useState<Req | null>(null); // the message last previewed (photos as base64); kept while the dialog animates out
  const [open, setOpen] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const textBox = useRef<HTMLTextAreaElement>(null);
  // AI viết lại: one tool-less run; the answer streams into the fields, then a toast offers to undo it.
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
  const writing = polish.isPending;
  const live = partial !== null ? livePolish(partial, d) : null;
  const polishErr = polish.isError && !(polish.error instanceof Error && polish.error.name === "AbortError")
    ? errorText(polish.error, {}, t("AI không viết lại được, thử lại.")) : "";
  const reduce = useReducedMotion();
  useEffect(() => { put(DRAFT_KEY, d.title || d.text ? JSON.stringify(d) : null); }, [d]); // text survives a reload or a failed send
  const edit = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));

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
  const ready = !!d.title.trim() && !!d.text.trim();
  const preview = () => { setReq({ ...d, diag, logs, client: diag ? clientLine() : "", photos: photos.map((p) => p.b64) }); setOpen(true); };
  const sent = () => { setOpen(false); setD(EMPTY); setPhotos([]); setBad(""); toast({ text: t("Đã gửi cho nhà phát triển qua Telegram") }); };

  return (
    <Card title="Gửi cho nhà phát triển" info="Gửi bằng tài khoản Telegram đang đăng nhập trong app, thành tin nhắn riêng tới nhà phát triển; ảnh đi kèm thành một album. Câu trả lời sẽ về Telegram của bạn.">
      <div className="grid grid-cols-1 gap-3 pt-1" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && ready && !writing) { e.preventDefault(); preview(); } }}>
        <div>{/* no grid gap around the folded notice */}
        <Fold open={behind > 0}>
          <div className="pb-3">
            <p className="flex flex-wrap items-center gap-x-2 rounded-md bg-signal-wash px-3 py-2 text-xs text-signal-2">
              <TriangleAlert aria-hidden className="size-3.5 shrink-0" />{t("Đang chậm {n} bản: lỗi có thể đã được sửa ở bản mới.", { n: behind })}
              <a href="#github" className={linkCls}>{t("Cập nhật trước")}</a>
            </p>
          </div>
        </Fold>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 max-w-full overflow-x-auto [scrollbar-width:none]">{/* narrow screens scroll the chips instead of widening the card */}
          <Segmented id="contact-kind" label={t("Loại")} value={d.kind} onChange={(kind) => edit({ kind })}
            items={KINDS.map(([value, k, Icon]) => ({ value, label: <span className="flex items-center gap-1.5"><Icon className="size-3.5" aria-hidden />{t(k)}</span> }))} />
          </div>
          <Dropdown label={t("Khu vực")} prefix={<span className="text-ink-3">{t("Khu vực")}</span>} className="w-48" value={d.area}
            onChange={(v) => edit({ area: v as Req["area"] })} options={AREAS.map(([value, k]) => ({ value, label: t(k) }))} />
        </div>
        </div>
        <Input aria-label={t("Tiêu đề")} maxLength={200} value={live?.title ?? d.title} readOnly={writing} onChange={(e) => edit({ title: e.target.value })} placeholder={t("Tiêu đề: một câu ngắn")} />
        <div className={cn("grid rounded-md border bg-cotton transition-colors duration-(--dur-micro) focus-within:border-hl", over ? "border-hl bg-hl-wash" : "border-rule-2 hover:border-ink-3", writing && "ai-ring")}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
          onDrop={(e) => { e.preventDefault(); setOver(false); void add([...e.dataTransfer.files]); }}>
          <Textarea ref={textBox} aria-label={t("Mô tả")} maxLength={4000} value={live?.text ?? d.text} readOnly={writing} aria-busy={writing} onChange={(e) => edit({ text: e.target.value })} placeholder={t(PLACEHOLDER[d.kind])}
            className="min-h-28 border-0 bg-transparent hover:border-0 focus-visible:outline-none"
            onPaste={(e) => { const f = [...e.clipboardData.files]; if (f.length) { e.preventDefault(); void add(f); } }} />
          <Fold open={photos.length > 0}>
            <div className="grid gap-1.5 px-3 pb-2.5">
              <div className="flex flex-wrap gap-2">
                <AnimatePresence initial={false}>
                  {photos.map((p) => (
                    <motion.figure key={p.id} layout={!reduce} initial={reduce ? false : { opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
                      className="group relative size-14 overflow-hidden rounded-md border border-rule bg-paper-2">
                      {/* eslint-disable-next-line @next/next/no-img-element -- a local data: URL, nothing to optimise */}
                      <img src={p.url} alt={p.name} className="size-full object-cover" />
                      <button type="button" aria-label={t("Bỏ ảnh {name}", { name: p.name })} onClick={() => setPhotos((x) => x.filter((y) => y.id !== p.id))}
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
          <div className="flex items-center gap-1 border-t border-rule px-1.5 py-1.5">
            <Hint text={t("Thêm ảnh (tối đa 5, ảnh lớn tự thu nhỏ). Dán ⌘V hoặc kéo thả vào ô này cũng được.")}>
              <Button variant="ghost" size="xs" disabled={photos.length >= MAX_PHOTOS} onClick={() => file.current?.click()}>
                <ImagePlus aria-hidden />{photos.length ? `${photos.length}/${MAX_PHOTOS}` : t("Ảnh")}
              </Button>
            </Hint>
            <Chip on={diag} onChange={setDiag} icon={Cpu} label={t("Thông tin máy")}
              hint={t("Kèm phiên bản app, hệ điều hành, trình duyệt, trạng thái Telegram / YouTrack. Không gửi token, tin nhắn hay tên nhóm.")} />
            <Chip on={logs} onChange={setLogs} icon={FileText} label={t("Log lỗi")}
              hint={t("Kèm cảnh báo / lỗi của app trong 24 giờ qua thành file log.txt (đã ẩn SĐT / email); xem được trước khi gửi.")} />
            <span className="ml-auto flex items-center gap-2">
              {writing ? <>
                <AiWriting label={t("AI đang viết lại")} />
                <Hint text={t("Dừng, giữ nguyên bản của bạn")}>
                  <Button variant="outline" size="icon-xs" className="rounded-full" aria-label={t("Dừng")} onClick={() => stop.current?.abort()}><Square className="fill-current" aria-hidden /></Button>
                </Hint>
              </> : (
                <AiAsk label={t("AI viết lại mô tả")} hint={t("Viết lại cho rõ: các bước, kết quả, mong đợi. Bạn xem rồi giữ hoặc hoàn tác.")}
                  onClick={() => (d.text.trim() ? polish.mutate(d) : textBox.current?.focus())} />
              )}
            </span>
            <Hint text={t("Xem đúng tin sẽ gửi (⌘Enter)")}>
              <Button size="sm" className="rounded-full" disabled={!ready || writing} onClick={preview}>
                <Eye aria-hidden />{t("Xem trước")}
              </Button>
            </Hint>
          </div>
        </div>
        <input ref={file} type="file" accept="image/*" multiple hidden onChange={(e) => { void add([...(e.target.files ?? [])]); e.target.value = ""; }} />
        {bad && <p role="alert" className="text-xs text-warn">{bad}</p>}
        {polishErr && <p role="alert" className="text-xs text-error">{polishErr}</p>}
      </div>
      {req && <PreviewDialog open={open} req={req} photos={photos} onClose={() => setOpen(false)} onSent={sent} />}
    </Card>
  );
}

/** The message as Telegram will show it (text from the server's own compose, then the album); Gửi sends exactly that. */
function PreviewDialog({ open, req, photos, onClose, onSent }: { open: boolean; req: Req; photos: Photo[]; onClose: () => void; onSent: () => void }) {
  const t = useT();
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
    not_connected: "Telegram chưa kết nối.",
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
            ? <p className="max-w-[90%] rounded-2xl rounded-br-md bg-hl-wash px-3.5 py-2.5 text-sm whitespace-pre-wrap text-ink">{pv.data.text}</p>
            : <Skeleton className="h-40 w-[80%] rounded-2xl" />}
          {!!photos.length && (
            <div className={cn("grid w-[70%] gap-0.5 overflow-hidden rounded-2xl rounded-br-md", photos.length > 1 && "grid-cols-2", photos.length > 2 && "grid-cols-3")}>
              {/* eslint-disable-next-line @next/next/no-img-element -- local data: URLs */}
              {photos.map((p) => <img key={p.id} src={p.url} alt={p.name} className="aspect-square w-full object-cover" />)}
            </div>
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
            <Send aria-hidden />{send.isPending ? t("Đang gửi…") : t("Gửi")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
