"use client";

import { BookCheck, BookPlus, ExternalLink, FilePlus, Loader2, NotebookText, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { Button, buttonVariants } from "@/shared/components/ui/button";
import { Hint } from "@/shared/components/ui/hint";
import { errorText } from "@/shared/lib/api";
import { useT } from "@/shared/lib/i18n";
import { ago } from "@/shared/lib/time";
import { cn } from "@/shared/lib/utils";
import { yt, ytProjectsQuery } from "@/features/youtrack/lib/yt";
import { allDocsQuery, type Doc, docErrors, docs } from "@/features/docs/lib/docs";
import { DocPop } from "./doc-pop";
import { DocSheet } from "./doc-sheet";
import { kbAddError, useKbAdd } from "./kb-add";

// A Knowledge Base article named in a Telegram message (its link on our YouTrack, or its ID alone) against Tài liệu:
// a check when the library holds it, a plus when not. Whether it does is read from the library list already loaded
// (the article's ID against the stored ones): nothing is fetched to draw it or to open its popover. Hover shows the
// popover; a click pins it when the library lacks the article, else opens its text in place (DocSheet). Only the buttons
// reach YouTrack: "Thêm vào Tài liệu" (the article and the ones under it join the sources, one sync) and "Cập nhật"
// (the article downloaded again now, rather than at the next sync).

export const docHref = (id: number) => `/docs/?doc=${id}`;

const sameHost = (url: string, base: string) => {
  try {
    return new URL(url).host === new URL(base).host;
  } catch {
    return false;
  }
};

/** `label`: what the message shows (default the ID); `url`: the link it had; `fallback`: drawn instead when the article
 *  is not on our YouTrack (another host, a project we don't have) or the library is not read yet. */
export function KbChip({ id, label, url, fallback, className }: { id: string; label?: ReactNode; url?: string; fallback: ReactNode; className: string }) {
  const base = useQuery({ queryKey: ["yt", "config"], queryFn: yt.config, staleTime: Infinity }).data?.base;
  const projects = useQuery(ytProjectsQuery);
  const list = useQuery({ ...allDocsQuery, staleTime: 60_000, retry: false });
  const ours = url ? !!base && sameHost(url, base) : !!projects.data?.some((p) => p.shortName === id.split("-A-")[0]);
  if (!ours || !list.data) return fallback;
  const d = list.data.find((x) => x.source === "youtrack" && x.ref === id);
  const ytUrl = url ?? (base ? `${base.replace(/\/$/, "")}/articles/${id}` : undefined);
  return <KbPop id={id} doc={d} ytUrl={ytUrl} label={label ?? id} className={className} />;
}

function KbPop({ id, doc: d, ytUrl, label, className }: { id: string; doc?: Doc; ytUrl?: string; label: ReactNode; className: string }) {
  const t = useT();
  const qc = useQueryClient();
  const add = useKbAdd();
  const [fresh, setFresh] = useState<"changed" | "same" | null>(null); // what the last "Cập nhật" found
  const [reading, setReading] = useState(false); // DocSheet: the article's text in place
  const refresh = useMutation({
    mutationFn: () => docs.kbRefresh(id),
    onSuccess: (n) => {
      setFresh(n.updated_at === d?.updated_at ? "same" : "changed");
      void qc.invalidateQueries({ queryKey: ["docs"] });
    },
    onError: () => setFresh(null), // shown in the popover
  });
  const Mark = d ? BookCheck : BookPlus;
  const ext = ytUrl && (
    <Hint text={t("Mở bài trên YouTrack")}>
      <a href={ytUrl} target="_blank" rel="noreferrer" aria-label={t("Mở bài trên YouTrack")}
        className={buttonVariants({ size: "icon-sm", variant: "ghost", className: "text-ink-3" })}><ExternalLink /></a>
    </Hint>
  );
  return (
    <>
    <DocPop label={t("Bài {ref} trong Tài liệu", { ref: id })} onPress={d && (() => setReading(true))}
      trigger={(
        <button type="button" className={cn(className, "font-mono", !d && "decoration-dashed")}>
          {label}<Mark aria-hidden className="ml-0.5 inline size-3.5 align-[-0.15em]" />
        </button>
      )}
      icon={<NotebookText />} title={d?.title || id} sub={d ? `${id} · Knowledge Base` : "Knowledge Base · YouTrack"}
      tone={d ? "ok" : "none"}
      status={d ? (d.updated_at ? t("Có trong Tài liệu · bản lưu sửa {when}", { when: ago(d.updated_at) }) : t("Có trong Tài liệu"))
        : t("Chưa có trong Tài liệu")}
      note={d ? (refresh.isPending ? t("Đang tải lại từ YouTrack…") : fresh === "changed" ? t("Đã cập nhật bản mới từ YouTrack.")
        : fresh === "same" ? t("Đã là bản mới nhất trên YouTrack.") : t("Bấm vào chip để đọc nội dung ngay tại đây."))
        : t("Thêm cả các bài con của bài này, đồng bộ một lần.")}
      error={d ? refresh.error && errorText(refresh.error, docErrors()) : add.error && kbAddError(add.error)}
      secondary={<>{ext}{d && (
        <Hint text={t("Cập nhật: tải lại bài từ YouTrack ngay")}>
          <Button type="button" size="icon-sm" variant="ghost" className="text-ink-3" aria-label={t("Cập nhật")} aria-busy={refresh.isPending}
            disabled={refresh.isPending} onClick={() => refresh.mutate()}>
            <RefreshCw className={cn(refresh.isPending && "animate-spin")} />
          </Button>
        </Hint>
      )}</>}
      primary={d ? <Link href={docHref(d.id)} className={buttonVariants({ size: "sm", className: "no-underline" })}>{t("Mở trong Tài liệu")}</Link> : (
        <Button type="button" size="sm" aria-busy={add.isPending} disabled={add.isPending} onClick={() => add.mutate(id)}>
          {add.isPending ? <Loader2 className="animate-spin" /> : <FilePlus />}{add.isPending ? t("Đang thêm…") : t("Thêm vào Tài liệu")}
        </Button>
      )} />
    <DocSheet id={reading && d ? d.id : null} onClose={() => setReading(false)} />
    </>
  );
}
