"use client";

import { FolderPlus, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Hint } from "@/shared/components/ui/hint";
import { errorText } from "@/shared/lib/api";
import { useT } from "@/shared/lib/i18n";
import { toast } from "@/shared/lib/notifications";
import { setPref } from "@/shared/lib/prefs";
import { ytProjectsQuery } from "@/features/youtrack/lib/yt";
import { Popover } from "@/features/youtrack/components/bits";
import { docErrors, docs, type DocSources, docSourcesQuery, syncErrorText } from "@/features/docs/lib/docs";

// "Nguồn ▾": the Knowledge Base projects and folders fed into the library, and each source's last sync error.
// The panel mounts only while open (Popover). Every change saves, then `onSaved` syncs (the server does not by itself).

/** Set once sources were saved here or defaulted on first use: an empty config after that is the user's choice. */
export const SOURCES_SET = "docsSourcesSet";

export function Sources({ onSaved }: { onSaved: () => void }) {
  const t = useT();
  const n = useQuery(docSourcesQuery).data?.errors.length ?? 0;
  return (
    <Popover align="right" title={t("Chọn project Knowledge Base và thư mục đưa vào kho; xem lỗi đồng bộ.")}
      name={n > 0 ? t("Nguồn ({n} lỗi đồng bộ)", { n }) : t("Nguồn")}
      label={<span className="flex items-center gap-1.5">{t("Nguồn")}{n > 0 && <span className="rounded-full bg-error px-1.5 font-mono text-2xs text-cotton">{n}</span>}</span>}>
      {() => <Panel onSaved={onSaved} />}
    </Popover>
  );
}

function Panel({ onSaved }: { onSaved: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const src = useQuery(docSourcesQuery);
  const projects = useQuery(ytProjectsQuery);
  const saved = (s: DocSources | undefined) => {
    if (!s) return; // the folder picker was cancelled
    setPref(SOURCES_SET, "1");
    qc.setQueryData(docSourcesQuery.queryKey, s);
    onSaved();
  };
  const onError = (e: unknown) => toast({ text: errorText(e, docErrors()) });
  const save = useMutation({ mutationFn: docs.setSources, onSuccess: saved, onError });
  const pick = useMutation({ mutationFn: docs.pickFolder, onSuccess: saved, onError });
  const busy = save.isPending || pick.isPending;

  if (src.isError) return <p role="alert" className="p-3 text-sm text-error">{errorText(src.error, docErrors())}</p>;
  if (!src.data) return <p className="p-3 text-sm text-ink-3">{t("Đang tải…")}</p>;
  const { projects: on, folders, errors } = src.data;
  const all = [...new Set([...(projects.data ?? []).map((p) => p.shortName), ...on])];
  const tick = (p: string, v: boolean) => save.mutate({ projects: v ? [...on, p] : on.filter((x) => x !== p), folders });

  return (
    <div className="grid gap-3 p-3 text-sm">
      <section className="grid gap-1.5">
        <h3 className="text-xs font-medium text-ink-3">{t("Project Knowledge Base (YouTrack)")}</h3>
        {projects.isError && <p role="alert" className="text-xs text-error">{t("Không tải được danh sách project: {msg}", { msg: (projects.error as Error).message })}</p>}
        {all.map((p) => (
          <label key={p} className="flex min-w-0 items-center gap-2 text-ink">
            <Checkbox checked={on.includes(p)} disabled={busy} onCheckedChange={(v) => tick(p, !!v)} />
            <span className="font-mono text-xs">{p}</span>
            <span className="truncate text-xs text-ink-3">{projects.data?.find((x) => x.shortName === p)?.name}</span>
          </label>
        ))}
      </section>
      <section className="grid gap-1.5">
        <h3 className="text-xs font-medium text-ink-3">{t("Thư mục trên máy")}</h3>
        {folders.length === 0 && <p className="text-xs text-ink-3">{t("Chưa có thư mục nào.")}</p>}
        {folders.map((f) => (
          <div key={f} className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{f}</span>
            <Hint side="bottom" text={t("Bỏ thư mục khỏi kho (file trên máy vẫn giữ nguyên).")}>
              <Button size="icon-xs" variant="ghost" aria-label={t("Bỏ thư mục {f}", { f })} disabled={busy}
                onClick={() => save.mutate({ projects: on, folders: folders.filter((x) => x !== f) })}><X /></Button>
            </Hint>
          </div>
        ))}
        <Button size="sm" variant="outline" className="justify-self-start" aria-busy={pick.isPending} disabled={busy} onClick={() => pick.mutate()}>
          <FolderPlus />{t("Thêm thư mục")}
        </Button>
      </section>
      {errors.length > 0 && (
        <section className="grid gap-1">
          <h3 className="text-xs font-medium text-error">{t("Lỗi đồng bộ")}</h3>
          <ul className="grid gap-0.5 text-xs text-ink-2">{errors.map((e, i) => <li key={i} className="break-all">{syncErrorText(e)}</li>)}</ul>
        </section>
      )}
    </div>
  );
}
