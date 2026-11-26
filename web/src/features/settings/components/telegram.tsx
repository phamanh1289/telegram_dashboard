"use client";

import { AtSign, BellOff, Clock1, Clock12, Clock2, Clock4, Clock8, Eye, MousePointerClick, Plus, Timer, Users, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";
import { AUTO_BRIEF } from "@/features/telegram/components/briefing-page";
import { BUILTIN_WAITS, ROLE_WAITS, saveWaitChoices, toChoice, useWaitChoices, WAIT_ON, waitName } from "@/features/telegram/components/briefing/waits";
import { ADD_CHIP, POP, RulesCount, RulesSection, rulesQuery } from "@/features/telegram/components/tools-menu";
import { Card, quietBtn, Row, usePrivacy } from "@/features/settings/components/parts";
import { TelegramLogin } from "@/features/telegram/components/login";
import { ScanPicker } from "@/features/telegram/components/scan-picker";
import { Switch } from "@/shared/components/ui/switch";
import { Segmented } from "@/shared/components/ui/segmented";
import { useT } from "@/shared/lib/i18n";
import { applyRowActions, getPref, onPrefs, OVERDUE_CHOICES, QA_REMIND_CHOICES, qaRemindLabel, readNotify, readOverdueHours, readQaAnswerBy, readRowActions, setPref, useQaRemind, useRole, useRoleOrDev, usesCode, YT_ROLES } from "@/shared/lib/prefs";

/** A waiting time's chip icon: off, a timer under an hour, else the clock showing its hours (24 h on 12). */
const CLOCKS: Record<number, typeof Timer> = { 1: Clock1, 2: Clock2, 4: Clock4, 8: Clock8, 24: Clock12 };
const clock = (mins: number) => (!mins ? BellOff : mins < 60 ? Timer : CLOCKS[mins / 60] ?? Clock12);

/** "Tag khi AI Agent hỏi" (card and search hit): Dev, or QA / PO while such rules are left from a Dev role (to remove
 *  them), like RulesSection's relay / agent rows. */
export function useAgentTagsShown() {
  const code = usesCode(useRole());
  const left = useQuery({ ...rulesQuery, select: (rs) => rs.some((r) => r.kind.startsWith("tag_")) }).data;
  return code || !!left;
}

/** Telegram-only preferences: the account, the queue, notifications, Q&A, Briefing, rules, local data. */
export function TelegramGroup() {
  const t = useT();
  const privacy = usePrivacy();
  const [overdue, setOverdue] = useState(readOverdueHours);
  const qaRemind = useQaRemind();
  const qaAnswerBy = useSyncExternalStore(onPrefs, readQaAnswerBy, () => "tagged" as const);
  const [rowActions, setRowActions] = useState(readRowActions);
  const [autoBrief, setAutoBrief] = useState(() => getPref(AUTO_BRIEF) !== "0");
  const [notify, setNotify] = useState(readNotify);
  const [notifyNote, setNotifyNote] = useState("");
  const code = usesCode(useRole()); // QA / PO: no AI Agent, no Đối chiếu BE
  const agentTags = useAgentTagsShown();
  const still = useReducedMotion();
  async function toggleNotify(on: boolean) {
    if (on) {
      if (typeof Notification === "undefined") return setNotifyNote(t("Trình duyệt này không hỗ trợ thông báo."));
      const p = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
      if (p !== "granted") return setNotifyNote(t("Trình duyệt đang chặn thông báo cho trang này; bật lại trong quyền của trang."));
    }
    setNotifyNote("");
    setNotify(on);
    setPref("notify", on ? "1" : "0");
  }

  return <>
    <Card title="Tài khoản Telegram" info="API ID/Hash và phiên đăng nhập chỉ lưu trên máy này (thư mục data/).">
      <TelegramLogin />
      <ScanPicker />
    </Card>

    <Card title="Hàng chờ">
      <Row label={t("Ngưỡng quá hạn")} desc={t("Tin tag chờ lâu hơn ngưỡng này hiện màu hổ phách.")} stack>
        <Segmented id="set-overdue" variant="card" label={t("Ngưỡng quá hạn")} value={overdue} onChange={(v) => { setOverdue(v); setPref("overdueHours", String(v)); }}
          items={OVERDUE_CHOICES.map((h) => { const Icon = clock(h * 60); return { value: h, label: <><Icon className="size-3.5" aria-hidden />{t("{n} giờ", { n: h })}</> }; })} />
      </Row>
      <Row label={t("Nút thao tác trên tin")} desc={code ? t("Hoãn, ngữ cảnh, Đối chiếu BE, đính kèm, chép ID và menu ⋯. Màn hình cảm ứng luôn hiện.") : t("Hoãn, ngữ cảnh, đính kèm, chép ID và menu ⋯. Màn hình cảm ứng luôn hiện.")} stack>
        <Segmented id="set-row-actions" variant="card" label={t("Nút thao tác trên tin")} value={rowActions} onChange={(v) => { setRowActions(v); applyRowActions(v); }}
          items={[{ value: "hover", label: <><MousePointerClick className="size-3.5" aria-hidden />{t("Khi rê vào nút Xong")}</> }, { value: "always", label: <><Eye className="size-3.5" aria-hidden />{t("Luôn hiện")}</> }]} />
      </Row>
    </Card>

    <Card title="Thông báo">
      <Row label={t("Thông báo khi có tag mới")} desc={notifyNote ? <span role="alert" className="text-warn">{notifyNote}</span> : t("Khi tab đang ẩn: tag mới, và câu hỏi Q&A của bạn quá ngưỡng nhắc mà chưa ai trả lời. Giữ luồng cập nhật chạy nền.")}>
        <Switch label={t("Thông báo khi có tag mới")} checked={notify} onChange={(v) => void toggleNotify(v)} />
      </Row>
      {privacy.p && (
        <Row label={t("Hiện nội dung tin trong thông báo macOS")} desc={t("Banner macOS khi có tag mới hoặc ticket YouTrack mới giao cho bạn (cả trên màn hình khóa, Notification Center). Tắt: chỉ hiện nhóm và người gửi / mã ticket.")}>
          <Switch label={t("Hiện nội dung tin trong thông báo macOS")} checked={privacy.p.notify_preview} disabled={privacy.busy} onChange={(v) => privacy.set({ notify_preview: v })} />
        </Row>
      )}
    </Card>

    <Card title="Q&A">
      <Row label={t("Nhắc câu hỏi Q&A chưa ai trả lời")} desc={t("Câu hỏi bạn đăng ở Q&A mà chưa ai trả lời sau khoảng này (tính từ tin cuối của bạn trong chuỗi): trang Q&A báo và cho nhắc lại ngay trong nhóm. Đổi nhanh được ở trang Q&A.")} stack>
        <Segmented id="set-qa-remind" variant="card" label={t("Nhắc câu hỏi Q&A chưa ai trả lời")} value={qaRemind} onChange={(v) => setPref("qaRemindMins", String(v))}
          items={QA_REMIND_CHOICES.map((m) => { const Icon = clock(m); return { value: m, label: <><Icon className="size-3.5" aria-hidden />{qaRemindLabel(m)}</> }; })} />
      </Row>
      <Row label={t("Câu hỏi Q&A tính là đã trả lời khi")} desc={t("“Người được tag”: chỉ khi chính người câu hỏi tag (@tên) trả lời; câu không tag ai thì ai trả lời cũng tính. Chốt câu trả lời thì luôn tính là xong.")} stack>
        <Segmented id="set-qa-answer-by" variant="card" label={t("Câu hỏi Q&A tính là đã trả lời khi")} value={qaAnswerBy} onChange={(v) => setPref("qaAnswerBy", v)}
          items={[{ value: "any", label: <><Users className="size-3.5" aria-hidden />{t("Bất kỳ ai khác trả lời")}</> }, { value: "tagged", label: <><AtSign className="size-3.5" aria-hidden />{t("Người được tag trả lời")}</> }]} />
      </Row>
    </Card>

    <Card title="Briefing">
      <Row label={t("Tự tóm tắt Briefing")} desc={t("Khi app đang mở, nhóm có tin mới được tóm tắt nền tối đa 2 giờ một lần, mở Briefing là có sẵn. Tắt: chỉ tóm tắt khi bạn bấm.")}>
        <Switch label={t("Tự tóm tắt Briefing")} checked={autoBrief} onChange={(v) => { setAutoBrief(v); setPref(AUTO_BRIEF, v ? null : "0"); }} />
      </Row>
      <WaitChoicesRow />
    </Card>

    <Card advanced badge={<RulesCount kinds={["sender", "keyword"]} />} title="Luôn bỏ qua" info="Tag khớp tự sang Đã xử lý, không báo; tin của người gửi trong danh sách cũng không vào tóm tắt Briefing / Digest. Thêm người gửi ở đây hoặc bằng “Luôn bỏ qua …” trong menu Hoãn của một tin. Bấm × trên chip để nhận thông báo lại; tag đã dọn trước đó không tự mở lại.">
      <RulesSection kinds={["sender", "keyword"]} />
    </Card>

    <Card advanced badge={<RulesCount kinds={["priority", "relay", "agent"]} />} title="Ưu tiên và tự động" info={code ? "Quy tắc theo người gửi. Luôn ưu tiên: gõ tên ở đây hoặc chọn “Luôn ưu tiên …” trong menu Hoãn của một tin. Tự chuyển / Tự giao AI Agent cần dự án nên thêm từ menu Hoãn (“Tự chuyển trả lời của … vào phiên AI”, “Luôn giao AI Agent cho tin của …”). Bấm × trên chip để gỡ, thông báo có nút Hoàn tác." : "Quy tắc theo người gửi. Luôn ưu tiên: gõ tên ở đây hoặc chọn “Luôn ưu tiên …” trong menu Hoãn của một tin. Bấm × trên chip để gỡ, thông báo có nút Hoàn tác."}>
      <RulesSection kinds={["priority", "relay", "agent"]} />
    </Card>

    <AnimatePresence initial={false}>{agentTags && (
      // overflow only while it moves: the card's flash outline and shadow stay whole once open
      <motion.div key="agent-tags" initial={{ height: 0, opacity: 0, overflow: "hidden" }} animate={{ height: "auto", opacity: 1, transitionEnd: { overflow: "visible" } }}
        exit={{ height: 0, opacity: 0, overflow: "hidden" }} transition={{ duration: still ? 0 : 0.2, ease: [0.2, 0, 0, 1] }}>
      <Card advanced badge={<RulesCount kinds={["tag_be", "tag_po", "tag_qc"]} />} title="Tag khi AI Agent hỏi" info="Người được tag ở đầu câu hỏi mà phiên AI Agent gửi BE / PO / QC vào nhóm: phiên mới soạn sẵn tag này, lúc gửi tự thêm tag còn thiếu.">
      <RulesSection kinds={["tag_be", "tag_po", "tag_qc"]} />
      </Card>
      </motion.div>
    )}</AnimatePresence>

  </>;
}

/** The "Chờ…" menu's reasons for the user's role: drop one (×), add another role's built-in one or words of one's own. */
function WaitChoicesRow() {
  const t = useT();
  const role = useRoleOrDev();
  const list = useWaitChoices(role);
  const [word, setWord] = useState("");
  const save = (next: string[]) => saveWaitChoices(role, next);
  const add = (s: string) => {
    const v = s.trim().slice(0, 60), low = v.toLowerCase();
    const id = BUILTIN_WAITS.find((k) => k === low || t(WAIT_ON[k].label).toLowerCase() === low) ?? v; // "Chờ BE": the built-in one
    if (v && !list.includes(id)) save([...list, id]);
    setWord("");
  };
  const roleName = t(YT_ROLES.find(([r]) => r === role)![1]);
  return (
    <Row label={t("Lý do chờ")} desc={t("Các lựa chọn của nút “Chờ…” (mục Briefing, Q&A, tin ở tab Cả nhóm) cho vai trò {role}. Lý do tự thêm hiện “Có vẻ xong” khi có người trả lời tin gốc.", { role: roleName })} stack>
      <div className="grid gap-2">
        <ul aria-label={t("Lý do chờ")} className="flex flex-wrap items-center gap-1.5">
          <AnimatePresence initial={false} mode="popLayout">
            {list.map((s) => {
              const c = toChoice(s), { Icon } = WAIT_ON[c.on], name = waitName(c);
              return (
                <motion.li key={s} layout {...POP} className="flex h-7 max-w-full min-w-0 items-center gap-1 rounded-full bg-warn-wash pr-0.5 pl-2.5 text-xs font-medium text-ink">
                  <Icon className="size-3.5 shrink-0 text-warn" aria-hidden /><span className="truncate">{name}</span>
                  <button type="button" aria-label={t("Xóa {name}", { name })} onClick={() => save(list.filter((x) => x !== s))}
                    className="grid size-6 shrink-0 place-items-center rounded-full text-warn transition-colors duration-(--dur-micro) hover:bg-cotton/70 focus-visible:outline-2 focus-visible:outline-(--color-focus)">
                    <X className="size-3.5" aria-hidden />
                  </button>
                </motion.li>
              );
            })}
            {BUILTIN_WAITS.filter((k) => !list.includes(k)).map((k) => (
              <motion.li key={`+${k}`} layout="position" {...POP} className="flex">
                <button type="button" className={ADD_CHIP} onClick={() => add(k)}><Plus className="size-3.5 shrink-0" aria-hidden />{t(WAIT_ON[k].label)}</button>
              </motion.li>
            ))}
            <motion.li key="add" layout="position" className="flex">
              <form className={ADD_CHIP} onSubmit={(e) => { e.preventDefault(); add(word); }}>
                <Plus className="size-3.5 shrink-0" aria-hidden />
                <input aria-label={t("Thêm lý do chờ riêng")} placeholder={t("Lý do riêng, vd. Chờ khách hàng")} value={word} maxLength={60}
                  onChange={(e) => setWord(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setWord("")}
                  className="w-60 max-w-full bg-transparent text-ink outline-none placeholder:text-ink-3" />
              </form>
            </motion.li>
          </AnimatePresence>
        </ul>
        {list.join() !== ROLE_WAITS[role].join() && (
          <button type="button" className={quietBtn} onClick={() => saveWaitChoices(role, null)}>{t("Về mặc định của vai trò")}</button>
        )}
      </div>
    </Row>
  );
}
