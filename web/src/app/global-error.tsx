"use client"; // error boundaries are client components

import { Bug, RotateCw } from "lucide-react";
import { useEffect } from "react";
import { prefillReport } from "@/features/settings/lib/contact-prefill";
import { Button } from "@/shared/components/ui/button";
import { useT } from "@/shared/lib/i18n";
import { applyTheme, readTheme } from "@/shared/lib/prefs";
import "./globals.css";

// A render crash anywhere (Next's global-error): replaces the root layout, so it brings its own <html>/<body> and styles,
// and runs outside Providers (no query client): the language and theme are read from prefs directly.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const t = useT();
  const msg = error instanceof Error ? error.message : String(error);
  useEffect(() => {
    console.error(error);
    applyTheme(readTheme(), false); // the layout's boot script set it; keep it if this document replaced the root
  }, [error]);
  const report = () => {
    prefillReport(t("Màn hình gặp lỗi"), { code: error instanceof Error ? error.name : "error", status: null, detail: msg });
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load: the crashed tree (and its router) can't be trusted
    location.href = "/settings/#contact";
  };
  return (
    <html lang={t.lang} translate="no">
      <body className="font-sans">
        <main className="grid min-h-dvh place-items-center bg-paper p-4 text-ink">
          <div role="alert" className="grid max-w-sm justify-items-start gap-3">
            <h1 className="text-base">{t("Màn hình gặp lỗi")}</h1>
            <p className="text-sm leading-relaxed text-ink-2">{t("Trang này gặp lỗi không mong đợi. Bấm Thử lại; vẫn lỗi thì tải lại trang hoặc báo lỗi (Cài đặt › Liên hệ).")}</p>
            {msg && <code className="max-w-full break-words font-mono text-xs text-ink-3">{msg.slice(0, 300)}</code>}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => retry()}><RotateCw /> {t("Thử lại")}</Button>
              <Button size="sm" variant="outline" onClick={() => location.reload()}>{t("Tải lại")}</Button>
              <Button size="sm" variant="ghost" onClick={report}><Bug /> {t("Báo lỗi này")}</Button>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
