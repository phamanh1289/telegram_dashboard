"use client";

import { Card, Row, Switch } from "@/features/settings/components/parts";
import { ModelEffortPicker } from "@/shared/components/ai";
import { AiBot } from "@/shared/components/ai/chat";
import { Segmented } from "@/shared/components/ui/segmented";
import { type Key, useT } from "@/shared/lib/i18n";
import { type BotCorner, type BotMode, type BotSize, setPref, useBotCode, useBotDock, useBotMode, useBotShow, useBotSize } from "@/shared/lib/prefs";

const BOT_SIZE_ITEMS: [BotSize, Key, string][] = [["s", "Nhỏ", "size-3.5"], ["m", "Vừa", "size-4"], ["l", "Lớn", "size-5"]];
const BOT_CORNERS: [BotCorner, Key][] = [["tl", "Trên trái"], ["tr", "Trên phải"], ["bl", "Dưới trái"], ["br", "Dưới phải"]];
const BOT_MODES: [BotMode, Key, Key][] = [
  ["float", "Nổi", "Bot nổi, kéo tới chỗ nào sát mép màn hình cũng được; khung chat mở ra từ chính nó."],
  ["side", "Cố định bên phải", "Bot nằm yên ở giữa cạnh phải; khung chat trượt ra từ bên phải, giữa màn hình."],
  ["bar", "Trên thanh công cụ", "Không nổi trên nội dung: bot là một nút trên thanh trên cùng, khung chat thả xuống ngay dưới."],
];

/** The know-it-all bot (components/guide): shown or F1 only, how it shows, size, where it docks, and whether it reads the app's code. */
export function BotSection() {
  const t = useT();
  const show = useBotShow(), mode = useBotMode(), size = useBotSize(), dock = useBotDock(), code = useBotCode();
  const corner = BOT_CORNERS.some(([c]) => c === dock) ? (dock as BotCorner) : null; // docked mid-edge: no corner lit
  return <>
    <Card title="Hiển thị">
    <Row label={t("Hiện bot trên màn hình")} desc={t("Tắt: bot ẩn đi, vẫn mở được bằng F1.")}>
      <Switch label={t("Hiện bot trên màn hình")} checked={show} onChange={(v) => setPref("botShow", v ? null : "0")} />
    </Row>
    <Row label={t("Cách hiển thị")} desc={t(BOT_MODES.find(([m]) => m === mode)![2])} stack>
      <Segmented id="set-bot-mode" variant="card" label={t("Cách hiển thị")} value={mode} onChange={(v) => setPref("botMode", v === "float" ? null : v)}
        items={BOT_MODES.map(([v, name]) => ({ value: v, label: t(name) }))} />
    </Row>
    {mode !== "bar" && <Row label={t("Kích thước bot")} stack>
      <Segmented id="set-bot-size" variant="card" label={t("Kích thước bot")} value={size} onChange={(v) => setPref("botSize", v === "m" ? null : v)}
        items={BOT_SIZE_ITEMS.map(([v, name, cls]) => ({ value: v, label: <><AiBot className={cls} />{t(name)}</> }))} />
    </Row>}
    {mode === "float" && <Row label={t("Vị trí")} desc={t("Chọn nhanh một góc, hoặc kéo bot rồi thả ở bất kỳ chỗ nào sát một trong 4 mép màn hình: bot tự bám vào mép gần nhất.")} stack>
      <Segmented id="set-bot-corner" variant="card" label={t("Vị trí")} value={corner} onChange={(v) => setPref("botCorner", v === "br" ? null : v)}
        items={BOT_CORNERS.map(([v, name]) => ({ value: v, label: t(name) }))} />
    </Row>}
    </Card>
    <Card title="Cách trả lời">
    <Row label={t("Đọc code khi trả lời")} desc={t("Bật: AI đọc code của app (chỉ đọc) để trả lời rule, giới hạn, vì sao một nút ẩn / hiện; chậm hơn. Tắt: chỉ dựa vào hướng dẫn, nhanh hơn.")}>
      <Switch label={t("Đọc code khi trả lời")} checked={code} onChange={(v) => setPref("botCode", v ? null : "0")} />
    </Row>
    <Row label={t("Model cho trợ lý")} desc={t("Riêng cho bot. “Như tóm tắt”: dùng model/effort của tóm tắt, soạn nháp (Cài đặt › AI). Model nhanh trả lời gọn hơn.")} stack>
      <ModelEffortPicker kind="guide" variant="full" />
    </Row>
    </Card>
  </>;
}
