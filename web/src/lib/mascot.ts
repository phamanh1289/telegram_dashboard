"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { api } from "./api";
import { useT } from "./i18n";
import { toast } from "./inbox";
import { getPref, onPrefs, setPref } from "./prefs";

// AI mascot drawings (Cài đặt › Linh vật AI): the server draws in the background like an AI session, so the dialog
// may close; the page polls one query while one runs, and a toast on any page says when it is done.

export type MascotStyle = "cute" | "pixel" | "line";
export type MascotJob = {
  id: string; description: string; style: MascotStyle; state: "running" | "done" | "error"; svg: string; error: string; detail: string;
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
    mutationFn: (b: { description: string; style: MascotStyle }) => api<MascotJob>("/ai/mascot", { method: "POST", json: b }),
    onSuccess: async (job) => { await edit((l) => [...l, job].slice(-8)); setPref(WATCH, [watching(), job.id].filter(Boolean).join(",")); },
  });
  const stop = useMutation({
    mutationFn: (id: string) => api<void>(`/ai/mascot/${id}`, { method: "DELETE" }),
    onSuccess: (_, id) => { unwatch([id]); return edit((l) => l.filter((j) => j.id !== id)); },
  });
  return { start, stop };
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
