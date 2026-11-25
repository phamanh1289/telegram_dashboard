"use client";

import { useQuery } from "@tanstack/react-query";
import { MousePointerClick } from "lucide-react";
import { AiBubble } from "@/shared/components/ai/chat";
import { useProjects } from "@/shared/components/project-picker";
import { Hint } from "@/shared/components/ui/hint";
import { statusQuery } from "@/shared/lib/api";
import { useT } from "@/shared/lib/i18n";
import { getPref, setPref, useIntro, usePrefValue, useRoleOrDev, useSetupTips, usesCode } from "@/shared/lib/prefs";
import { cn } from "@/shared/lib/utils";
import { resolveProject, ytNotesQuery, ytProjectsQuery, ytWorkflowQuery } from "@/features/youtrack/lib/yt";
import type { Feature } from "./guide";

// The bot's setup list: what this machine still lacks, each step a walk-through of its guide feature (shared/lib/guide).
// "Cần": the app cannot do its job without it (always listed). "Nên làm": the answers get better for this role (Cài đặt ›
// Trợ lý biết tuốt › Gợi ý cài đặt turns it off). Read only while the chat is open.

export const CHIP = "rounded-full border border-rule-2 bg-cotton px-3 py-1 text-left text-xs text-ink shadow-stock transition-[translate,border-color,background-color] duration-(--dur-short) hover:-translate-y-0.5 hover:border-hl hover:bg-hl-wash disabled:opacity-50";

/** [guide feature, done] per step; done null: not known yet (still loading, or unreadable): left out. */
type Step = [id: string, done: boolean | null];

function useSetup() {
  const st = useQuery({ ...statusQuery, staleTime: Infinity }).data;
  const role = useRoleOrDev(), tips = useSetupTips(), intro = useIntro();
  const notify = usePrefValue("notify") === "1" && typeof Notification !== "undefined" && Notification.permission === "granted";
  const yt = !!st?.youtrack_configured, ai = !!st?.ai_configured, code = ai && usesCode(role);
  const projects = useProjects();
  const ps = useQuery({ ...ytProjectsQuery, enabled: yt && tips });
  const p = resolveProject(ps.data, getPref("project") || "VA"); // the project the YouTrack tab works on
  const wf = useQuery({ ...ytWorkflowQuery(p, role), enabled: yt && tips && !!ps.data });
  const notes = useQuery({ ...ytNotesQuery, enabled: yt && tips });
  if (!st) return { need: [], nice: [] };
  const known = <T,>(q: { data?: T }, f: (d: T) => boolean) => (q.data === undefined ? null : f(q.data));
  const need: Step[] = [
    ["settings-telegram-account", st.state !== "setup_required" && st.state !== "login_required"],
    ["settings-ai-accounts", ai],
    ["settings-youtrack", yt],
  ];
  const nice: Step[] = !tips ? [] : [
    ["settings-ai-intro", !!intro],
    ["settings-notify", notify],
    ...(code ? [["agent-project", known(projects, (d) => d.length > 0)] as Step] : []),
    ...(yt ? [["settings-workflow", known(wf, (d) => d.on)], ["settings-yt-instructions", known(notes, (d) => !!d[role]?.trim())]] as Step[] : []),
  ];
  const sure = (s: Step[]) => s.filter(([, d]) => d !== null);
  return { need: sure(need), nice: sure(nice) };
}

/** The bot's greeting, under its hello: the missing steps as chips (a click walks it on the page). */
export function SetupBubble({ byId, onTour }: { byId: Map<string, Feature>; onTour: (f: Feature) => void }) {
  const t = useT();
  const { need, nice } = useSetup();
  const chips = (s: Step[]) => (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {s.filter(([, d]) => !d).flatMap(([id]) => byId.get(id) ?? []).map((f) => (
        <button key={f.id} type="button" onClick={() => onTour(f)} className={cn("flex items-center gap-1", CHIP)}>
          <MousePointerClick className="size-3.5 shrink-0 text-hl-2" />{f.title}
        </button>
      ))}
    </div>
  );
  const missing = need.filter(([, d]) => !d).length, todo = nice.filter(([, d]) => !d).length;
  return <>
    {missing > 0 && (
      <AiBubble className="gb-in" style={{ animationDelay: "0.3s" }}>
        <p>{t("Còn {n} bước cài đặt để dùng đủ tính năng, bấm để em chỉ tận nơi:", { n: missing })}</p>
        {chips(need)}
      </AiBubble>
    )}
    {todo > 0 && (
      <AiBubble className="gb-in" style={{ animationDelay: "0.35s" }}>
        <p>{t("Nên làm để AI hiểu đúng việc của anh/chị (xong {done}/{all}):", { done: nice.length - todo, all: nice.length })}</p>
        {chips(nice)}
        <Hint side="bottom" text={t("Tắt mọi gợi ý cài đặt; bật lại ở Cài đặt › Trợ lý biết tuốt.")}>
          <button type="button" onClick={() => setPref("setupTips", "0")} className="mt-2 text-xs text-ink-3 underline-offset-2 hover:text-ink hover:underline">{t("Không cần gợi ý nữa")}</button>
        </Hint>
      </AiBubble>
    )}
  </>;
}
