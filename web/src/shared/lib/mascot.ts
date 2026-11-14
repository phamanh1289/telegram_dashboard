"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { api, errorText } from "./api";
import { t, useT } from "./i18n";
import { toast } from "./notifications";
import { getPref, MASCOT_MAX, onPrefs, setPref } from "./prefs";

// AI mascot drawings (Cài đặt › Linh vật AI): the server draws in the background like an AI session, so the dialog
// may close; the page polls one query while one runs, and a toast on any page says when it is done.

export type MascotStyle = "cute" | "pixel" | "line";
export type MascotJob = {
  id: string; description: string; style: MascotStyle; state: "running" | "done" | "error"; svg: string; rigged: boolean; error: string; detail: string;
};
const KEY = ["ai", "mascot"];

/** The drawings since the server started, oldest first; polled every 3s only while one runs. */
export const useMascotJobs = (on = true) => useQuery({
  queryKey: KEY, enabled: on, queryFn: ({ signal }) => api<MascotJob[]>("/ai/mascot", { signal }),
  refetchInterval: (q) => (q.state.data?.some((j) => j.state === "running") ? 3000 : false),
});

/** A drawing as the mascot pref (an image data: URL, see Mascot). */
export const mascotUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

/** Drawings started in this browser and not announced yet (ids), so the toast follows the member to any page. */
const WATCH = "mascotWatch";
const watching = () => getPref(WATCH) ?? "";
const unwatch = (ids: string[]) => setPref(WATCH, watching().split(",").filter((x) => x && !ids.includes(x)).join(",") || null);

export function useMascotActions() {
  const qc = useQueryClient();
  // a list read still in flight (the dialog opening) would land after this and drop the change: cancel it first
  const edit = async (f: (l: MascotJob[]) => MascotJob[]) => { await qc.cancelQueries({ queryKey: KEY }); qc.setQueryData<MascotJob[]>(KEY, (l) => f(l ?? [])); };
  const start = useMutation({
    mutationFn: (b: { description: string; style: MascotStyle; image?: string; model?: string; effort?: string }) => api<MascotJob>("/ai/mascot", { method: "POST", json: b }),
    onSuccess: async (job) => { await edit((l) => [...l, job].slice(-8)); setPref(WATCH, [watching(), job.id].filter(Boolean).join(",")); },
  });
  const t = useT();
  /** Dùng linh vật này: the AI readies the drawing to move like the robot, then it becomes the mascot. Applied here,
   *  not in the dialog, so closing it meanwhile still lands; failing that (no run, a redrawing, a restart), the still
   *  drawing is used. */
  const use = useMutation({
    mutationFn: (b: { job: MascotJob; model?: string; effort?: string }) =>
      api<MascotJob>(`/ai/mascot/${b.job.id}/rig`, { method: "POST", json: { model: b.model, effort: b.effort } }),
    onSuccess: async (job) => { await edit((l) => l.map((j) => (j.id === job.id ? job : j))); keep(mascotUrl(job.svg)); },
    onError: (e, b) => {
      keep(mascotUrl(b.job.svg));
      toast({ text: errorText(e, { mascot_rig_invalid: t("AI không tách được mắt / tay của hình này") }, t("Không làm linh vật cử động được"))
        + t(": đang dùng bản đứng yên.") });
    },
  });
  const keep = (v: string) => { if (!setPref("mascot", v)) toast({ text: t("Không lưu được: bộ nhớ trình duyệt đã đầy.") }); };
  const stop = useMutation({
    mutationFn: (id: string) => api<void>(`/ai/mascot/${id}`, { method: "DELETE" }),
    onSuccess: (_, id) => { unwatch([id]); return edit((l) => l.filter((j) => j.id !== id)); },
  });
  return { start, stop, use };
}

/** Why a drawing failed, for the member. */
export function useMascotError() {
  const t = useT();
  return (j: MascotJob) => j.error === "mascot_invalid" ? t("AI không trả về hình vẽ hợp lệ, thử lại hoặc mô tả khác.")
    : j.error === "ai_timeout" ? t("AI vẽ quá lâu, thử lại.")
    : j.detail ? t("Không vẽ được linh vật ({detail}).", { detail: j.detail }) : t("Không vẽ được linh vật.");
}

/** Mounted once (Providers): a drawing started here that ends gets a toast on whichever page is open; "Xem" opens the
 *  drawing dialog in Cài đặt. Polls only while there is one to announce. */
export function useMascotWatch() {
  const t = useT();
  const router = useRouter();
  const ids = useSyncExternalStore(onPrefs, watching, () => "");
  const jobs = useMascotJobs(!!ids).data;
  useEffect(() => {
    if (!ids || !jobs) return;
    const ended = ids.split(",").filter((id) => jobs.find((j) => j.id === id)?.state !== "running"); // gone (restart) too
    if (!ended.length) return;
    unwatch(ended);
    for (const j of jobs.filter((x) => ended.includes(x.id))) {
      toast(j.state === "done"
        ? { text: t("Linh vật “{d}” đã vẽ xong", { d: j.description }), action: { label: t("Xem"), run: () => router.push("/settings?mascot=1#look") } }
        : { text: t("Không vẽ được linh vật “{d}”", { d: j.description }) });
    }
  }, [ids, jobs, t, router]);
}

// Pictures picked from disk: the member's own mascot, and AI vẽ's reference. Each rejects with what to tell the member.

const MASCOT_PX = 256; // the mascot shows at 96 px at most: 2x for sharp screens
const REF_PX = 384; // the AI only needs a reference's shape and colours
const REF_TYPES = /^image\/(png|jpeg|webp|gif)$/;

const bitmap = (f: File) => createImageBitmap(f).catch(() => { throw t("Không đọc được file ảnh."); });

/** `src` on a canvas at most `px` a side; `fill`: a colour under it. */
function scaled(src: CanvasImageSource & { width: number; height: number }, px: number, fill?: string) {
  const k = Math.min(1, px / Math.max(src.width, src.height));
  const c = Object.assign(document.createElement("canvas"), { width: Math.round(src.width * k), height: Math.round(src.height * k) });
  const g = c.getContext("2d")!;
  if (fill) { g.fillStyle = fill; g.fillRect(0, 0, c.width, c.height); }
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

const BG_TOL = 28; // how far (per channel, 0-255) a pixel may be from a background colour: JPEG / WebP noise, soft shading
/** Clears a plain background: one colour (any), or two (a transparency checkerboard baked into the pixels, as stock
 *  "PNG" previews have). Its colours are the 1-2 that cover most of the edge (60%+, each 20%+); none such (a photo, an
 *  image already see-through, a drawing up to the edge): left as it is. Flood-fills from the edge, so the same colour
 *  inside the drawing stays; the pixels along the cut go half see-through to soften it. True when something was cut. */
export function clearBackground(c: HTMLCanvasElement) {
  const { width: w, height: h } = c, g = c.getContext("2d")!, d = g.getImageData(0, 0, w, h), px = d.data;
  const near = (p: number, k: number[]) =>
    Math.abs(px[p * 4] - k[0]) <= BG_TOL && Math.abs(px[p * 4 + 1] - k[1]) <= BG_TOL && Math.abs(px[p * 4 + 2] - k[2]) <= BG_TOL;
  const edge = [...Array(w).keys()].flatMap((x) => [x, (h - 1) * w + x]).concat([...Array(h).keys()].flatMap((y) => [y * w, y * w + w - 1]));
  // the edge's colours: each opaque pixel joins the first group whose mean is near it, else starts one
  const groups: { k: number[]; sum: number[]; n: number }[] = [];
  for (const p of edge) {
    if (px[p * 4 + 3] < 250) continue;
    let gr = groups.find((x) => near(p, x.k));
    if (!gr) {
      if (groups.length >= 64) continue; // ponytail: a busy edge is no plain background anyway
      groups.push(gr = { k: [px[p * 4], px[p * 4 + 1], px[p * 4 + 2]], sum: [0, 0, 0], n: 0 });
    }
    for (let i = 0; i < 3; i++) gr.sum[i] += px[p * 4 + i];
    const n = ++gr.n;
    gr.k = gr.sum.map((v) => v / n); // the mean so far
  }
  const top = groups.sort((a, b) => b.n - a.n).slice(0, 2).filter((x) => x.n >= edge.length * 0.2);
  if (top.reduce((n, x) => n + x.n, 0) < edge.length * 0.6) return false;
  const bg = (p: number) => px[p * 4 + 3] >= 250 && top.some((x) => near(p, x.k));
  // ponytail: edge-joined only; background shut in by the drawing (between a wing and the head) stays, since clearing
  // such patches by colour punched holes in a white dragon on white (its body is within BG_TOL of the background)
  const stack = edge.filter(bg), gone = new Uint8Array(w * h);
  while (stack.length) {
    const p = stack.pop()!;
    if (gone[p]) continue;
    gone[p] = 1;
    const x = p % w;
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) if (q >= 0 && q < w * h && !gone[q] && bg(q)) stack.push(q);
  }
  for (let p = 0; p < w * h; p++) {
    const x = p % w;
    if (gone[p]) px[p * 4 + 3] = 0;
    else if ((x > 0 && gone[p - 1]) || (x < w - 1 && gone[p + 1]) || gone[p - w] || gone[p + w]) px[p * 4 + 3] = 128;
  }
  g.putImageData(d, 0, 0);
  return true;
}

/** The member's own mascot as a data: URL. PNG / JPEG / WebP lose a plain background (clearBackground) and
 *  shrink to MASCOT_PX; SVG and GIF (it may move) stay as they are, up to MASCOT_MAX. */
export async function mascotImage(f: File) {
  if (!f.type.startsWith("image/")) throw t("Chỉ nhận file ảnh.");
  const big = () => t("Ảnh quá lớn, tối đa {n} KB.", { n: MASCOT_MAX / 1000 });
  if (!/^image\/(png|jpeg|webp)$/.test(f.type)) {
    if (f.size > MASCOT_MAX) throw big();
    return new Promise<string>((ok, no) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result));
      r.onerror = () => no(t("Không đọc được file ảnh."));
      r.readAsDataURL(f);
    });
  }
  const img = await bitmap(f);
  const c = scaled(img, 1024); // the cut at a size that keeps its edge fine, then down
  img.close();
  clearBackground(c);
  const url = scaled(c, MASCOT_PX).toDataURL("image/png");
  if (url.length > MASCOT_MAX) throw big();
  return url;
}

/** AI vẽ's reference picture, any size, as a JPEG of at most REF_PX a side on white (far under the server's cap). */
export async function referenceImage(f: File) {
  if (!REF_TYPES.test(f.type)) throw t("Ảnh tham khảo chỉ nhận PNG, JPG, WebP, GIF.");
  const img = await bitmap(f);
  const c = scaled(img, REF_PX, "#fff");
  img.close();
  return c.toDataURL("image/jpeg", 0.85);
}

/** The ready-made mascots, one per role (Cài đặt › Giao diện › Linh vật AI; a member who picks none gets their role's):
 *  hand-drawn in the 32 × 32 box with the parts the app animates (m-blink, m-wave, m-glow), drawn like a rigged AI
 *  drawing (Mascot, components/ai/chat.tsx). Dev: a white, blue-eyed dragon coding on a laptop; QA/QC: a learned owl
 *  with a magnifier; PO/PM: a wise fox pointing the team's way to the flag. */
export const ROLE_MASCOTS: Record<"dev" | "qa" | "po", string> = {
  dev: '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><path d="M21.5 27c5 .5 8-2 7.5-5.5-.3-2.2-2.6-2.4-3.3-.8" fill="none" stroke="#8FA6BF" stroke-width="2.6" stroke-linecap="round"/><path d="M21.5 27c5 .5 8-2 7.5-5.5-.3-2.2-2.6-2.4-3.3-.8" fill="none" stroke="#F4F7FB" stroke-width="1.4" stroke-linecap="round"/><path d="M10 17 3 10.5l1.2 4.6L2 15.5l6.3 5.4z" fill="#DCE7F5" stroke="#8FA6BF" stroke-width=".8" stroke-linejoin="round"/><g class="m-wave" transform-origin="22 18"><path d="M22 17l7-6.5-1.2 4.6 2.2.4-6.3 5.4z" fill="#DCE7F5" stroke="#8FA6BF" stroke-width=".8" stroke-linejoin="round"/></g><ellipse cx="16" cy="23" rx="7.2" ry="6" fill="#F4F7FB" stroke="#8FA6BF" stroke-width=".8"/><path d="M11.2 6.4C10 4.6 8.4 3.4 6.6 3.2c1 1.4 1.6 3 1.8 4.8zM20.8 6.4c1.2-1.8 2.8-3 4.6-3.2-1 1.4-1.6 3-1.8 4.8z" fill="#BFD5EE" stroke="#8FA6BF" stroke-width=".7" stroke-linejoin="round"/><path d="M14.6 5 16 2.6 17.4 5" fill="#BFD5EE" stroke="#8FA6BF" stroke-width=".7" stroke-linejoin="round"/><circle cx="16" cy="12" r="7.4" fill="#F8FAFD" stroke="#8FA6BF" stroke-width=".8"/><ellipse cx="16" cy="15.6" rx="3.6" ry="2.2" fill="#E8EFF8" stroke="#8FA6BF" stroke-width=".6"/><circle cx="14.8" cy="15" r=".45" fill="#6B7F95"/><circle cx="17.2" cy="15" r=".45" fill="#6B7F95"/><g class="m-blink"><circle cx="12.9" cy="11.4" r="2.3" fill="#2F80ED"/><circle cx="19.1" cy="11.4" r="2.3" fill="#2F80ED"/><circle cx="13.1" cy="11.6" r="1.1" fill="#0B2545"/><circle cx="19.3" cy="11.6" r="1.1" fill="#0B2545"/><circle cx="12.3" cy="10.7" r=".6" fill="#fff"/><circle cx="18.5" cy="10.7" r=".6" fill="#fff"/></g><path d="M14.4 16.4q1.6 1 3.2 0" fill="none" stroke="#6B7F95" stroke-width=".6" stroke-linecap="round"/><rect x="9" y="18.6" width="14" height="8.6" rx="1.3" fill="#1F2937" stroke="#4B5563" stroke-width=".6"/><g class="m-glow"><path d="M13.6 20.9 11.6 22.9l2 2M18.4 20.9l2 2-2 2M16.9 20.4l-1.8 5" fill="none" stroke="#5EEAD4" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></g><rect x="7.5" y="27" width="17" height="1.8" rx=".9" fill="#9CA3AF"/><ellipse cx="8.6" cy="26.4" rx="1.6" ry="1.2" fill="#F4F7FB" stroke="#8FA6BF" stroke-width=".6"/><ellipse cx="23.4" cy="26.4" rx="1.6" ry="1.2" fill="#F4F7FB" stroke="#8FA6BF" stroke-width=".6"/></svg>',
  qa: '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><path d="M8.6 10 6.4 3.2l5 4.6zM21.4 10l2.2-6.8-5 4.6z" fill="#8B6B4E" stroke="#5B4330" stroke-width=".7" stroke-linejoin="round"/><ellipse cx="15" cy="18.6" rx="9" ry="10.4" fill="#8B6B4E" stroke="#5B4330" stroke-width=".8"/><ellipse cx="15" cy="22.4" rx="5.8" ry="6.2" fill="#EBDCC4"/><path d="M12.4 21.4l1 .9 1-.9M15.6 21.4l1 .9 1-.9M14 24.2l1 .9 1-.9" fill="none" stroke="#B89A78" stroke-width=".6" stroke-linecap="round"/><circle cx="11" cy="13" r="4" fill="#FFF8EC" stroke="#5B4330" stroke-width=".7"/><circle cx="19" cy="13" r="4" fill="#FFF8EC" stroke="#5B4330" stroke-width=".7"/><g class="m-blink"><circle cx="11.2" cy="13.2" r="2.3" fill="#F5B301"/><circle cx="18.8" cy="13.2" r="2.3" fill="#F5B301"/><circle cx="11.3" cy="13.3" r="1.2" fill="#1F1300"/><circle cx="18.7" cy="13.3" r="1.2" fill="#1F1300"/><circle cx="10.6" cy="12.6" r=".5" fill="#fff"/><circle cx="18.1" cy="12.6" r=".5" fill="#fff"/></g><path d="M15 15.2 13.8 17l1.2 1.6 1.2-1.6z" fill="#F59E0B" stroke="#B45309" stroke-width=".4" stroke-linejoin="round"/><path d="M11.5 28.6v1.2M13 28.6v1.2M17 28.6v1.2M18.5 28.6v1.2" stroke="#F59E0B" stroke-width=".9" stroke-linecap="round"/><g class="m-wave" transform-origin="22 22"><path d="M22.5 16.5c4 2.5 4.6 6.6 2.6 9.8-1.6-.6-3.2-1.8-4-3.4z" fill="#7A5B40" stroke="#5B4330" stroke-width=".7" stroke-linejoin="round"/><path d="M24.2 22.6 22 25.6" stroke="#374151" stroke-width="1.6" stroke-linecap="round"/><circle cx="26.4" cy="19.4" r="3.6" fill="#CDE9FF" fill-opacity=".75" stroke="#374151" stroke-width="1.2"/><g class="m-glow"><path d="M24.6 18.4q.6-1.4 2-1.6" fill="none" stroke="#fff" stroke-width=".9" stroke-linecap="round"/></g></g></svg>',
  po: '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><path d="M8.4 26.5c-6 .4-7.6-5.4-4.4-8.6.2 3 2.2 4.4 5.2 4.4z" fill="#F08A3C" stroke="#9A4A14" stroke-width=".7" stroke-linejoin="round"/><path d="M4 17.9c-1 1.6-1 3.4 0 4.8 1-.4 1.8-1.4 2-2.6z" fill="#FFF7EE"/><ellipse cx="13" cy="23.4" rx="6.6" ry="6" fill="#F08A3C" stroke="#9A4A14" stroke-width=".7"/><ellipse cx="13" cy="24.4" rx="3.6" ry="4.2" fill="#FFF7EE"/><path d="M6 9.4 7.8 2.6l4.2 4.6h2l4.2-4.6L20 9.4c0 5.2-3.2 7.8-7 7.8s-7-2.6-7-7.8z" fill="#F08A3C" stroke="#9A4A14" stroke-width=".7" stroke-linejoin="round"/><path d="M8 4.6 9.6 7.2M18 4.6l-1.6 2.6" stroke="#5A2A0A" stroke-width=".8" stroke-linecap="round"/><path d="M8.4 12.2c1.6 3.6 7.6 3.6 9.2 0-.6 3-2.4 4.6-4.6 4.6s-4-1.6-4.6-4.6z" fill="#FFF7EE"/><g class="m-blink"><ellipse cx="10.2" cy="10.4" rx="1" ry="1.2" fill="#2B1608"/><ellipse cx="15.8" cy="10.4" rx="1" ry="1.2" fill="#2B1608"/></g><circle cx="10.2" cy="10.4" r="2.2" fill="none" stroke="#3B2A1A" stroke-width=".7"/><circle cx="15.8" cy="10.4" r="2.2" fill="none" stroke="#3B2A1A" stroke-width=".7"/><path d="M12.4 10.2h1.2" stroke="#3B2A1A" stroke-width=".7"/><ellipse cx="13" cy="13.6" rx=".9" ry=".7" fill="#2B1608"/><path d="M17.5 29.2c3-.4 4.6-2 4.2-3.8-.4-1.6 1.4-3 4.4-2.4" fill="none" stroke="#6366F1" stroke-width="1.1" stroke-linecap="round" stroke-dasharray=".1 2"/><g class="m-glow"><path d="M27.4 23.2V16.6" stroke="#4B5563" stroke-width=".8" stroke-linecap="round"/><path d="M27.4 16.6l3.8 1.4-3.8 1.4z" fill="#EF4444"/></g><g class="m-wave" transform-origin="18.6 20.6"><path d="M19.4 20.4 25.6 13" stroke="#7C4A1E" stroke-width="1.1" stroke-linecap="round"/><circle cx="25.8" cy="12.8" r=".8" fill="#FBBF24"/><ellipse cx="18.8" cy="20.8" rx="1.7" ry="1.4" fill="#F08A3C" stroke="#9A4A14" stroke-width=".6"/></g></svg>',
};
