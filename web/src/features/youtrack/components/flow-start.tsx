"use client";

import { Code, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { AiBot } from "@/shared/components/ai/chat";
import { Button } from "@/shared/components/ui/button";
import { Hint } from "@/shared/components/ui/hint";
import { Segmented } from "@/shared/components/ui/segmented";
import { useT } from "@/shared/lib/i18n";
import type { FlowCheck, FlowMode, FlowTarget } from "@/features/youtrack/lib/yt";
import { fmtK, fmtUsd } from "./flow-check";
import { OptionCard } from "./flow-option-card";

/** The empty UI flow: what the ticket can get, and the two ways to build it. The choice is the mode the run uses; the
 *  note and the run button sit in the box below. */
/** Mobile or web: picked before a render, so the pre-check leaves out the other platform's screens from the start. */
export function FlowTargetPicker({ id, value, onChange, counts }: { id: string; value: FlowTarget; onChange: (v: FlowTarget) => void; counts?: Record<FlowTarget, number> }) {
  const t = useT();
  const n = (v: FlowTarget, label: string) => (counts ? `${label} · ${counts[v]}` : label); // how many Zeplin screens are that size
  return (
    <span className="flex items-center gap-2 text-xs text-ink-3">{t("Nền tảng")}
      <Segmented id={id} label={t("Nền tảng")} value={value} onChange={onChange}
        items={[
          { value: "mobile", label: n("mobile", t("Mobile")), title: t("Vẽ app mobile: màn web / desktop mặc định bỏ qua") },
          { value: "web", label: n("web", t("Web")), title: t("Vẽ web: màn mobile mặc định bỏ qua") },
        ]} />
    </span>
  );
}

export function FlowStart({ mode, onPick, onRun, resume, notice, target, onTarget, check, checkError }: {
  mode: FlowMode; onPick: (m: FlowMode) => void; onRun: () => void; resume?: ReactNode; notice?: ReactNode; target: FlowTarget; onTarget: (v: FlowTarget) => void;
  check?: FlowCheck; checkError?: unknown;
}) {
  const t = useT();
  // the pre-check (no AI, cached: the warning dialog opens on it): screens per size, the ceiling of an AI render
  const size = (code: FlowTarget) => Number.parseInt(check?.risks.find((r) => r.code === code)?.text ?? "0") || 0;
  // no screen with a known size (no Zeplin image read): no counts, rather than a misleading "0 · 0"
  const counts = check && size("mobile") + size("web") > 0 ? { mobile: size("mobile"), web: size("web") } : undefined;
  const unclear = Number.parseInt(check?.risks.find((r) => r.code === "ambiguous")?.text ?? "0") || 0;
  const noZeplin = check?.screens === 0; // "Chỉ màn hình" has nothing to build (the server refuses it)
  const aiCost = check ? t("tối đa ~{k} token · theo model bạn chọn", { k: fmtK(check.tokens) }) + (check.cost_usd != null ? ` · ~${fmtUsd(check.cost_usd)}` : "") : t("Tốn token · theo model bạn chọn");
  return (
    <div className="flex h-full flex-col content-center items-center justify-center gap-6 overflow-y-auto px-4 py-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="grid size-16 place-items-center rounded-2xl bg-hl-wash shadow-stock"><AiBot className="ai-float size-11 drop-shadow-lg" /></span>
        <h2 className="text-lg font-bold text-ink">{t("Ticket này chưa có UI flow")}</h2>
        <p className="max-w-md text-sm text-ink-2">{t("Dựng sơ đồ màn hình và luồng bấm từ ticket và link Zeplin. Chọn cách dựng, rồi bấm nút bên dưới.")}</p>
        {checkError ? <p role="alert" className="max-w-md text-xs text-error">{t("Không đọc được ticket để đếm màn: {msg}", { msg: (checkError as Error).message })}</p>
          : check ? <p className="flex flex-wrap justify-center gap-x-3 gap-y-1 font-mono text-xs text-ink-3">
              <span>{t("{n} màn Zeplin trong ticket", { n: check.screens })}</span>
              {unclear > 0 && <Hint side="bottom" text={t("Các dòng luồng này AI phải tự đoán. Hộp cảnh báo trước khi render liệt kê từng dòng, lý do và cách sửa trong ticket.")}>
                <span className="text-warn">{t("{n} dòng luồng chưa rõ", { n: unclear })}</span>
              </Hint>}
            </p>
          : <p className="ai-text text-xs">{t("Đang đọc ticket và các màn Zeplin…")}</p>}
      </div>
      <div role="radiogroup" aria-label={t("Cách dựng")} className="grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
        <OptionCard value="screens" picked={mode} onPick={onPick} icon={Code} title={t("Chỉ màn hình")} disabled={noZeplin} badge={noZeplin ? undefined : t("Gợi ý")}
          when={noZeplin ? t("Ticket chưa có link Zeplin nào: chọn Màn + liên kết để AI đọc AC") : t("Chỉ UI các màn Zeplin, không có nút và mũi tên")} cost={t("0 token · vài giây")}
          tip={t("Khi nào: cần khung các màn để xem nhanh. Đánh đổi: không có nút và mũi tên nối màn, AI không đọc AC.")} />
        <OptionCard value="flow" picked={mode} onPick={onPick} icon={Sparkles} title={t("Màn + liên kết")} badge={noZeplin ? t("Gợi ý") : undefined}
          when={t("AI đọc AC và vẽ mũi tên giữa các màn")} cost={aiCost}
          tip={t("Khi nào: cần sơ đồ luồng bấm đầy đủ. Đánh đổi: tốn token và chạy lâu hơn; với nhiều màn, model nhẹ dễ vẽ thiếu.")} />
      </div>
      {notice}
      <FlowTargetPicker id="uiflow-target-start" value={target} onChange={onTarget} counts={counts} />
      <Hint side="bottom" text={mode === "screens" ? t("Dựng các màn Zeplin bằng code, không dùng AI") : t("AI đọc ticket rồi dựng sơ đồ màn hình và luồng bấm")}>
        <Button size="lg" className="rounded-full bg-hl px-6 text-hl-ink hover:brightness-110" disabled={mode === "screens" && noZeplin} onClick={onRun}>
          {mode === "screens" ? <><Code aria-hidden />{t("Dựng màn hình")}</> : <><Sparkles aria-hidden />{t("Render bằng AI")}</>}
        </Button>
      </Hint>
      {resume}
    </div>
  );
}
