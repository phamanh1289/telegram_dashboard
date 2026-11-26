"use client";

import { ArrowDownLeft, ArrowDownRight, ArrowUpLeft, ArrowUpRight, Move, PanelRight, PanelTop } from "lucide-react";
import { Card, Row } from "@/features/settings/components/parts";
import { Switch } from "@/shared/components/ui/switch";
import { ModelEffortPicker } from "@/shared/components/ai";
import { AiBot } from "@/shared/components/ai/chat";
import { Segmented } from "@/shared/components/ui/segmented";
import { type Key, useT } from "@/shared/lib/i18n";
import { type BotCorner, type BotMode, type BotSize, reopenTips, setPref, useBotDock, useBotMode, useBotShow, useBotSize, useSetupTips } from "@/shared/lib/prefs";
import { Button } from "@/shared/components/ui/button";

const BOT_SIZE_ITEMS: [BotSize, Key, string][] = [["s", "Nhỏ", "size-3.5"], ["m", "Vừa", "size-4"], ["l", "Lớn", "size-5"]];
const BOT_CORNERS: [BotCorner, Key, typeof Move][] = [["tl", "Trên trái", ArrowUpLeft], ["tr", "Trên phải", ArrowUpRight], ["bl", "Dưới trái", ArrowDownLeft], ["br", "Dưới phải", ArrowDownRight]];
const BOT_MODE_ICONS: Record<BotMode, typeof Move> = { float: Move, side: PanelRight, bar: PanelTop };
const BOT_MODES: [BotMode, Key, Key][] = [
  ["float", "Nổi", "Bot nổi, kéo tới chỗ nào sát mép màn hình cũng được; khung chat mở ra từ chính nó."],
  ["side", "Cố định bên phải", "Bot nằm yên ở giữa cạnh phải; khung chat trượt ra từ bên phải, giữa màn hình."],
  ["bar", "Trên thanh công cụ", "Không nổi trên nội dung: bot là một nút trên thanh trên cùng, khung chat thả xuống ngay dưới."],
];

/** The know-it-all bot (components/guide): shown or F1 only, how it shows, size, where it docks (it never reads the app's code). */
export function BotSection() {
  const t = useT();
  const show = useBotShow(), mode = useBotMode(), size = useBotSize(), dock = useBotDock(), tips = useSetupTips();
  const corner = BOT_CORNERS.some(([c]) => c === dock) ? (dock as BotCorner) : null; // docked mid-edge: no corner lit
  return <>
    <Card title="Hiển thị">
    <Row label={t("Hiện bot trên màn hình")} desc={t("Tắt: bot ẩn đi, vẫn mở được bằng F1.")}>
      <Switch label={t("Hiện bot trên màn hình")} checked={show} onChange={(v) => setPref("botShow", v ? null : "0")} />
    </Row>
    <Row label={t("Cách hiển thị")} desc={t(BOT_MODES.find(([m]) => m === mode)![2])} stack>
      <Segmented id="set-bot-mode" variant="card" label={t("Cách hiển thị")} value={mode} onChange={(v) => setPref("botMode", v === "float" ? null : v)}
        items={BOT_MODES.map(([v, name]) => { const Icon = BOT_MODE_ICONS[v]; return { value: v, label: <><Icon className="size-3.5" aria-hidden />{t(name)}</> }; })} />
    </Row>
    {mode !== "bar" && <Row label={t("Kích thước bot")} stack>
      <Segmented id="set-bot-size" variant="card" label={t("Kích thước bot")} value={size} onChange={(v) => setPref("botSize", v === "m" ? null : v)}
        items={BOT_SIZE_ITEMS.map(([v, name, cls]) => ({ value: v, label: <><AiBot className={cls} />{t(name)}</> }))} />
    </Row>}
    {mode === "float" && <Row label={t("Vị trí")} desc={t("Chọn nhanh một góc, hoặc kéo bot rồi thả ở bất kỳ chỗ nào sát một trong 4 mép màn hình: bot tự bám vào mép gần nhất.")} stack>
      <Segmented id="set-bot-corner" variant="card" label={t("Vị trí")} value={corner} onChange={(v) => setPref("botCorner", v === "br" ? null : v)}
        items={BOT_CORNERS.map(([v, name, Icon]) => ({ value: v, label: <><Icon className="size-3.5" aria-hidden />{t(name)}</> }))} />
    </Row>}
    </Card>
    <Card title="Gợi ý cài đặt" info="Bot liệt kê các bước nên làm theo vai trò (Giới thiệu bản thân cho AI, thông báo, thư mục dự án, workflow, Instructions cho AI). Cạnh tính năng cần một cài đặt cũng có gợi ý: chỗ đổi State (menu, đổi hàng loạt, Board) khi vai trò chưa có workflow (chưa đổi được State), chỗ của tính năng AI khi máy chưa có AI, dòng dưới câu trả lời AI khi chưa có giới thiệu / instructions. Bấm gợi ý để được chỉ tận nơi.">
    <Row label={t("Hiện gợi ý cài đặt")} desc={t("Tắt: bot chỉ còn báo các bước bắt buộc (Telegram, AI, YouTrack); tính năng AI chưa cài thì ẩn như cũ.")}>
      <Switch label={t("Hiện gợi ý cài đặt")} checked={tips} onChange={(v) => setPref("setupTips", v ? null : "0")} />
    </Row>
    <Row label={t("Gợi ý đã ẩn")} desc={t("Hiện lại các gợi ý đã bấm “Để sau”.")}>
      <Button type="button" size="sm" variant="outline" disabled={!tips} onClick={reopenTips}>{t("Hiện lại")}</Button>
    </Row>
    </Card>
    <Card title="Cách trả lời">
    <Row label={t("Model cho trợ lý")} desc={t("Riêng cho bot. “Như tóm tắt”: dùng model/effort của tóm tắt, soạn nháp (Cài đặt › AI). Model nhanh trả lời gọn hơn.")} stack>
      <ModelEffortPicker kind="guide" variant="full" />
    </Row>
    </Card>
  </>;
}
