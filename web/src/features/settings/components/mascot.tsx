"use client";

import { Check, Grid2x2, ImagePlus, PencilLine, PenLine, Smile, Sparkles, X, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { picked } from "@/features/settings/components/parts";
import { Picks, useAiPrefs } from "@/shared/components/ai";
import { AiBot, AiPromptBox, AiThinking, Mascot } from "@/shared/components/ai/chat";
import { type Effort } from "@/shared/components/ai/prefs";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/shared/components/ui/dialog";
import { CHIP, Dropdown } from "@/shared/components/ui/dropdown";
import { BotStage } from "@/shared/components/ui/empty";
import { Hint } from "@/shared/components/ui/hint";
import { errorText } from "@/shared/lib/api";
import { type Key, useT } from "@/shared/lib/i18n";
import { mascotImage, type MascotStyle, mascotUrl, referenceImage, useMascotActions, useMascotError, useMascotJobs } from "@/shared/lib/mascot";
import { MASCOT_MAX, readJson, readMascot, roleMascot, setPref, useMascot } from "@/shared/lib/prefs";
import { cn } from "@/shared/lib/utils";

/** The AI mascot (every AI loading scene, empty page, AI box): the robot, a role's (the member's own by default), an
 *  image of theirs or an AI drawing. */
export function MascotRow() {
  const t = useT();
  const m = useMascot();
  const [err, setErr] = useState("");
  const [draw, setDraw] = useState(false);
  const drawing = useMascotJobs().data?.some((j) => j.state === "running");
  useEffect(() => { // the "done" toast's Xem lands on /settings?mascot=1: open the drawings, drop the param
    if (!new URLSearchParams(location.search).has("mascot")) return;
    history.replaceState(null, "", location.pathname + location.hash);
    setDraw(true); // eslint-disable-line react-hooks/set-state-in-effect -- a one-off read of the URL on arrival
  }, []);
  // Rule: never picked, the mascot follows the role (readMascot); once picked, any pick (even the role's own) stays
  // through a change of role.
  const pick = (v: string) => setErr(setPref("mascot", v) ? "" : t("Không lưu được: bộ nhớ trình duyệt đã đầy."));
  const upload = (f?: File) => { if (f) mascotImage(f).then(pick, setErr); };
  const img = m.startsWith("data:image/") ? m : "";
  const tile = (on: boolean) => cn("grid size-11 place-items-center rounded-xl border", picked(on));
  const mine = roleMascot();
  const opts: [string, string][] = [["robot", t("Robot")], ...ROLES.map(([v, k]): [string, string] => [v, v === mine ? t("{name} (mặc định của vai trò bạn)", { name: t(k) }) : t(k)]),
    ...(img ? [[img, t("Ảnh của bạn")] as [string, string]] : [])];
  const upHint = t("Tải ảnh của bạn: PNG, JPG, WebP tự xóa nền một màu / ô caro; GIF, SVG tối đa {n} KB", { n: MASCOT_MAX / 1000 });
  return (
    <div className="grid gap-2.5 pt-1">
      <p className={cn("text-xs leading-relaxed", err ? "text-error" : "text-ink-3")}>{err || t("Mặc định theo vai trò (Cài đặt chung › Vai trò); hiện ở mọi cảnh AI đang tải, trang trống và ô AI; lưu trên trình duyệt này.")}</p>
      <div role="radiogroup" aria-label={t("Linh vật AI")} className="flex flex-wrap gap-1.5">
        {opts.map(([v, name]) => (
          <Hint key={v === img && img ? "img" : v} side="bottom" text={name}>
            <button type="button" role="radio" aria-checked={m === v} aria-label={name} onClick={() => pick(v)} className={tile(m === v)}>
              <Mascot m={v} className="size-7" />
            </button>
          </Hint>
        ))}
        <Hint side="bottom" text={drawing ? t("AI đang vẽ linh vật…") : t("Nhờ AI vẽ linh vật theo mô tả")}>
          <button type="button" aria-label={t("Nhờ AI vẽ linh vật theo mô tả")} onClick={() => setDraw(true)} className={cn(tile(false), "relative text-hl-2", drawing && "ai-ring")}>
            <Sparkles className={cn("size-5", drawing && "ai-twinkle")} aria-hidden />
          </button>
        </Hint>
        <Hint side="bottom" text={upHint}>
          <label className={cn(tile(false), "relative cursor-pointer text-ink-3 has-focus-visible:ring-2 has-focus-visible:ring-hl")}>
            <ImagePlus className="size-5" aria-hidden />
            <input type="file" accept="image/*" aria-label={upHint} className="absolute inset-0 size-full cursor-pointer opacity-0"
              onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
        </Hint>
      </div>
      {draw && <MascotDraw onClose={() => setDraw(false)} />}
    </div>
  );
}

const ROLES: [string, Key][] = [
  ["role:dev", "Rồng trắng lập trình viên (Dev)"], ["role:qa", "Cú tinh thông cầm kính lúp (QA/QC)"], ["role:po", "Cáo thông thái chỉ đường (PO/PM)"],
];
const MASCOT_STYLES: { value: MascotStyle; label: Key; hint: Key; icon: LucideIcon }[] = [
  { value: "cute", label: "Dễ thương", hint: "Mắt to, khối tròn, màu phẳng", icon: Smile },
  { value: "pixel", label: "Pixel", hint: "Ô vuông như game cổ điển", icon: Grid2x2 },
  { value: "line", label: "Nét mảnh", hint: "Chỉ nét vẽ, gần như không tô màu", icon: PenLine },
];
const MASCOT_IDEAS: Key[] = ["Mèo cam đeo kính", "Cáo nhỏ cầm laptop", "Gấu trúc phi hành gia", "Cú mèo đọc sách", "Bạch tuộc lập trình viên", "Khủng long xanh dễ thương"];
const MASCOT_DRAWING: Key[] = ["Đang phác dáng…", "Đang vẽ đôi mắt…", "Đang tô màu…", "Thêm chút lấp lánh…"];
const MASCOT_RIGGING: Key[] = ["Đang tìm đôi mắt…", "Đang gắn khớp tay…", "Đang thử chớp mắt…"];
/** Sketch strokes (80 × 80): a head, two ears, two eyes, a smile; each draws itself in turn (.mascot-sketch). */
const SKETCH = ["M40 18c14 0 25 10 25 24s-11 24-25 24-25-10-25-24 11-24 25-24z", "M21 30 17 12l14 9", "M59 30l4-18-14 9", "M32 40v3", "M48 40v3", "M34 52q6 5 12 0"];

type MascotAi = { p: string; model: string; effort: Effort };
/** The model / effort AI vẽ draws with, on the drafts CLI: the last one picked in the dialog (this browser), else the
 *  "Tóm tắt, soạn nháp" picks. `pick`: what to send, undefined until the picks have loaded (the server's own then). */
function useMascotAi() {
  const { on, info, picks, p } = useAiPrefs();
  const id = on("chat"), k = picks(id), c = info(id);
  const [mine, setMine] = useState(() => readJson("mascotAi") as MascotAi | null);
  const cur: MascotAi = mine?.p === id && typeof mine.model === "string" ? mine : { p: id, model: k.model, effort: k.effort };
  const set = (v: Partial<MascotAi>) => { const n = { ...cur, ...v }; setMine(n); setPref("mascotAi", JSON.stringify(n)); };
  return { c, cur, set, pick: c && p ? { model: cur.model, effort: cur.effort } : undefined };
}

/** "AI vẽ linh vật": a description (and a style) in, an SVG mascot out. The server draws in the background (lib/mascot),
 *  so the dialog may close and a toast says when it is done. The mascot stands on the robot's stage; while the AI draws, a
 *  sketch draws itself there with the current mascot as the artist. Every drawing stays pickable, previewed where the
 *  mascot really shows (nav, button, AI thinking). */
function MascotDraw({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [text, setText] = useState("");
  const [style, setStyle] = useState<MascotStyle>("cute");
  const [pick, setPick] = useState<string | null>(null); // the drawing picked; null = the newest
  const [ref, setRef] = useState(""); // a reference picture to draw after (data: URL)
  const [refErr, setRefErr] = useState("");
  const attach = (f?: File) => { if (f) referenceImage(f).then((v) => { setRef(v); setRefErr(""); }, setRefErr); };
  const jobs = useMascotJobs().data ?? [];
  const { start, stop, use } = useMascotActions();
  const ai = useMascotAi();
  const why = useMascotError();
  const shots = jobs.filter((j) => j.state === "done");
  const running = jobs.find((j) => j.state === "running");
  const failed = jobs.at(-1)?.state === "error" ? jobs.at(-1) : undefined;
  const shot = shots.find((j) => j.id === pick) ?? shots.at(-1);
  const rigging = use.isPending; // Dùng linh vật này: the AI readies its parts to move
  const busy = !!running || start.isPending || rigging;
  const run = (v = text) => {
    const description = v.trim() || (ref ? t("Theo ảnh tham khảo") : "");
    if (description && !busy) { setPick(null); start.mutate({ description, style, image: ref, ...ai.pick }); }
  };
  const verb = shots.length ? t("Vẽ lại") : t("Vẽ");
  const StyleIcon = MASCOT_STYLES.find((o) => o.value === style)!.icon;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="gap-4 sm:max-w-lg">
        <div className="-mx-(--dlg-p) -mt-(--dlg-p) grid justify-items-center gap-1 bg-radial-[at_50%_45%] from-hl-wash to-transparent to-70% px-(--dlg-p) pt-5">
          <BotStage>
            {busy && !rigging ? <>
              <svg viewBox="0 0 80 80" className="relative size-24 overflow-visible" fill="none" stroke="var(--color-hl-2)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                {SKETCH.map((d, k) => <path key={d} d={d} pathLength={1} className="mascot-sketch" style={{ animationDelay: `${k * 0.18}s` }} />)}
              </svg>
              <span className="ai-spin absolute inset-9 [animation-duration:2.6s]"><PencilLine className="absolute top-0 left-1/2 size-4 -translate-x-1/2 -translate-y-1/2 text-hl-2" /></span>
              <AiBot className="ai-hop absolute right-1 bottom-4 size-10 drop-shadow-sm" />
            </> : (
              <span key={shot?.id ?? "now"} className="sk-pop relative grid place-items-center">
                <Mascot m={shot ? mascotUrl(shot.svg) : readMascot()} className={cn("size-24 drop-shadow-lg", rigging ? "ai-hop" : "ai-float")} />
                {shot && <>
                  <Sparkles className="ai-twinkle absolute -top-2 -right-3 size-4 text-hl-2" />
                  <Sparkles className="ai-twinkle absolute bottom-3 -left-4 size-3 text-hl-2/70 [animation-delay:0.3s]" />
                </>}
              </span>
            )}
          </BotStage>
          <DialogTitle className="text-center">{t("AI vẽ linh vật")}</DialogTitle>
          <div className="grid min-h-7 justify-items-center gap-0.5 text-center">
            {busy ? <>
              <AiThinking lines={(rigging ? MASCOT_RIGGING : MASCOT_DRAWING).map((k) => t(k))} />
              <p className="text-xs text-ink-3">{rigging ? t("Có thể đóng cửa sổ này: xong linh vật tự được dùng.") : t("Có thể đóng cửa sổ này: AI vẽ tiếp ở nền, xong sẽ báo.")}</p>
            </> : start.isError ? <p role="alert" className="text-sm text-error">{errorText(start.error, { mascot_image_invalid: t("Ảnh tham khảo không đọc được, thử ảnh PNG / JPG khác."), ai_agent_missing: t("Không tìm thấy AI CLI để đọc ảnh, xem Cài đặt › AI.") }, t("Không bắt đầu vẽ được."))}</p>
              : failed ? <p role="alert" className="text-sm text-error">{why(failed)}</p>
              : shot ? <p className="max-w-sm truncate text-sm text-ink-2">“{shot.description}”</p>
              : <p className="text-sm text-ink-3">{t("Linh vật hiện tại. Mô tả con vật bạn muốn, AI vẽ thành biểu tượng.")}</p>}
          </div>
        </div>

        {shot && !busy && <>
          <div className="grid gap-1.5">
            <span className="text-xs text-ink-3">{t("Trong app trông thế này")}</span>
            <div aria-hidden className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-rule bg-paper px-3 py-2.5">
              <span className="flex items-center gap-2 rounded-lg bg-hl-wash px-2.5 py-1.5 text-sm font-medium text-hl-2"><Mascot m={mascotUrl(shot.svg)} className="agent-still size-[1.125rem]" />AI Agent</span>
              <span className="flex h-[30px] items-center gap-1 rounded-full border border-rule-2 bg-cotton px-2.5 text-xs font-medium text-ink"><Mascot m={mascotUrl(shot.svg)} className="agent-still size-3.5" />AI Agent</span>
              <span className="flex min-w-0 items-center gap-2"><Mascot m={mascotUrl(shot.svg)} className="ai-hop size-7 shrink-0" /><span className="ai-text truncate text-sm font-medium">{t("AI đang suy nghĩ")}</span></span>
            </div>
          </div>
          {shots.length > 1 && (
            <div className="grid gap-1.5">
              <span className="text-xs text-ink-3">{t("Các bản đã vẽ")}</span>
              <div role="radiogroup" aria-label={t("Các bản đã vẽ")} className="flex flex-wrap gap-1.5">
                {shots.map((x) => (
                  <Hint key={x.id} side="bottom" text={x.description}>
                    <button type="button" role="radio" aria-checked={x.id === shot.id} aria-label={x.description} onClick={() => setPick(x.id)}
                      className={cn("grid size-12 place-items-center rounded-xl border", picked(x.id === shot.id))}>
                      <Mascot m={mascotUrl(x.svg)} className="size-8" />
                    </button>
                  </Hint>
                ))}
              </div>
            </div>
          )}
          <Hint text={t("AI tách mắt, tay của hình để linh vật chớp mắt, vẫy tay như robot rồi dùng nó")}>
            <Button type="button" onClick={() => use.mutate({ job: shot, ...ai.pick }, { onSettled: onClose })}><Check aria-hidden />{t("Dùng linh vật này")}</Button>
          </Hint>
        </>}

        <AiPromptBox aria-label={t("Mô tả linh vật")} autoFocus maxLength={200} value={text} onChange={setText} onSend={() => run()}
          placeholder={t("Ví dụ: chú mèo cam đeo kính, cầm laptop")}
          onPaste={(e) => { const f = [...e.clipboardData.files].find((x) => x.type.startsWith("image/")); if (f) { e.preventDefault(); attach(f); } }}
          running={busy} onStop={running ? () => stop.mutate(running.id) : undefined} stopping={stop.isPending}
          top={!shots.length && !busy && (
            <div className="flex flex-wrap gap-1.5">
              {MASCOT_IDEAS.map((k) => (
                <button key={k} type="button" onClick={() => { setText(t(k)); run(t(k)); }}
                  className="rounded-full border border-rule bg-paper px-2.5 py-1 text-xs text-ink-2 transition-colors duration-(--dur-micro) hover:border-hl hover:text-ink">
                  {t(k)}
                </button>
              ))}
            </div>
          )}
          tools={<>
            <Dropdown label={t("Phong cách vẽ")} value={style} onChange={(v) => setStyle(v as MascotStyle)} trigger={CHIP}
              prefix={<StyleIcon aria-hidden className="size-3.5 shrink-0 text-ink-3" />}
              options={MASCOT_STYLES.map((o) => ({ value: o.value, label: t(o.label), hint: t(o.hint) }))} />
            {ai.c && (
              <Hint side="bottom" text={t("Model {name} vẽ linh vật; mặc định theo \"Tóm tắt, soạn nháp\" ở Cài đặt › AI", { name: ai.c.name })}>
                <span role="group" aria-label={t("Model và effort vẽ linh vật")} className="flex min-w-0 items-center gap-1.5">
                  <Picks c={ai.c} label={t("vẽ linh vật")} model={ai.cur.model} effort={ai.cur.effort} chip variant="short"
                    modelClass="flex min-w-0 max-w-36" effortClass="w-20" onModel={(model) => ai.set({ model })} onEffort={(effort) => ai.set({ effort })} />
                </span>
              </Hint>
            )}
            {ref ? (
              <span className={cn(CHIP, "pl-1")}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a local data: URL */}
                <img src={ref} alt="" className="size-5 rounded-full object-cover" />
                {t("Ảnh tham khảo")}
                <Hint text={t("Bỏ ảnh tham khảo")}>
                  <button type="button" aria-label={t("Bỏ ảnh tham khảo")} onClick={() => setRef("")} className="grid size-5 place-items-center rounded-full hover:bg-paper">
                    <X className="size-3" aria-hidden />
                  </button>
                </Hint>
              </span>
            ) : (
              <Hint text={t("Thêm ảnh tham khảo để AI vẽ theo (PNG, JPG, WebP, GIF; có thể dán ảnh)")}>
                <label className={cn(CHIP, "relative pr-2.5 has-focus-visible:ring-2 has-focus-visible:ring-hl")}>
                  <ImagePlus className="size-3.5 text-ink-3" aria-hidden />{t("Ảnh tham khảo")}
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label={t("Thêm ảnh tham khảo")}
                    className="absolute inset-0 size-full cursor-pointer opacity-0" onChange={(e) => { attach(e.target.files?.[0]); e.target.value = ""; }} />
                </label>
              </Hint>
            )}
          </>}
          actions={!busy && (
            <Hint text={verb}>
              <Button type="button" size="sm" aria-label={verb} disabled={!text.trim() && !ref} onClick={() => run()} className="rounded-full bg-hl">
                <Sparkles aria-hidden />{verb}
              </Button>
            </Hint>
          )} />
        {stop.isError && <p role="alert" className="text-xs text-error">{errorText(stop.error, {}, t("Không dừng được."))}</p>}
        {refErr && <p role="alert" className="text-xs text-error">{refErr}</p>}
      </DialogContent>
    </Dialog>
  );
}
