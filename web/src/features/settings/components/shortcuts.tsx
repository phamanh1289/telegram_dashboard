"use client";

import { Search } from "lucide-react";
import { useState } from "react";
import { Card } from "@/features/settings/components/parts";
import { type ShortcutGroup, ShortcutList, TG_KEYS, YT_KEYS } from "@/shared/components/shortcuts";
import { Input } from "@/shared/components/ui/input";
import { Segmented } from "@/shared/components/ui/segmented";
import { useT } from "@/shared/lib/i18n";
import { fold } from "@/shared/lib/utils";

export function ShortcutsGroup() {
  const t = useT();
  const [find, setFind] = useState("");
  const [app, setApp] = useState<"tg" | "yt">("tg");
  const f = fold(find.trim());
  const groups = (app === "tg" ? TG_KEYS : YT_KEYS)
    .map(([name, list]): ShortcutGroup => [name, list.filter(([, what]) => !f || fold(`${what} ${t(what)}`).includes(f) || fold(`${name} ${t(name)}`).includes(f))])
    .filter(([, list]) => list.length);
  return <>
    <div className="flex flex-wrap items-center gap-2">
      <Segmented id="set-keys-app" label={t("Phím tắt của")} value={app} onChange={setApp} items={[{ value: "tg", label: "Telegram Inbox" }, { value: "yt", label: "YouTrack" }]} />
      <label className="relative ml-auto w-full sm:w-64">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
        <Input aria-label={t("Tìm phím tắt")} placeholder={t("Tìm: hoãn, ghim, gửi…")} value={find} onChange={(e) => setFind(e.target.value)} className="h-8 pl-8" />
      </label>
    </div>
    {groups.length ? (
      <div className="grid gap-4">
        {groups.map(([name, list]) => (
          <Card key={name} title={name}><ShortcutList list={list} /></Card>
        ))}
      </div>
    ) : <p className="py-6 text-center text-sm text-ink-3">{t("Không có phím tắt nào khớp “{q}”.", { q: find })}</p>}
  </>;
}
