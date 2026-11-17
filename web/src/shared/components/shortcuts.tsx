"use client";

import { Dialog, DialogContent, DialogTitle } from "@/shared/components/ui/dialog";
import { type Key, useT } from "@/shared/lib/i18n";

// Keyboard shortcuts: the Inbox's "?" sheet and Cài đặt › Phím tắt read the same lists.

function Keycap({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-grid h-6 min-w-6 place-items-center rounded-md border border-rule-2 border-b-2 bg-cotton px-1.5 font-mono text-2xs font-medium text-ink shadow-stock">{children}</kbd>;
}
const k = (...keys: string[]) => <span className="inline-flex items-center gap-1">{keys.map((x, i) => <Keycap key={i}>{x}</Keycap>)}</span>;
const plus = (...parts: React.ReactNode[]) => <span className="inline-flex items-center gap-1">{parts.map((x, i) => <span key={i} className="inline-flex items-center gap-1">{i > 0 && <span className="text-ink-3">+</span>}{x}</span>)}</span>;
const or = (...parts: React.ReactNode[]) => <span className="inline-flex items-center gap-1">{parts.map((x, i) => <span key={i} className="inline-flex items-center gap-1">{i > 0 && <span className="text-ink-3">/</span>}{x}</span>)}</span>;
const MOD_KEY = "⌘/Ctrl";
/** A word between keys, in the live language (the lists below are module constants). */
function W({ k: key }: { k: Key }) {
  return <>{useT()(key)}</>;
}

/** Keys and what they do; the texts are i18n keys, rendered with `t`. */
export type Shortcut = [React.ReactNode, Key];
export type ShortcutGroup = [Key, Shortcut[]];

export const TG_KEYS: ShortcutGroup[] = [
  ["Di chuyển", [
    [or(k("j"), k("k")), "Chọn tin dưới / trên; khi đang trả lời: mở tag đang chờ kế / trước"],
    [plus(k("Alt"), or(k("↑"), k("↓"))), "Sang tag trước / kế khi đang gõ trả lời"],
    [k("Tab"), "Đi qua từng tin (Enter để trả lời)"],
    [<span key="g" className="inline-flex items-center gap-1">{k("g")}<span className="text-ink-3"><W k="rồi" /></span>{or(k("i"), k("q"), k("p"), k("a"), k("b"))}</span>, "Đi tới Việc cần xử lý / Q&A / Tag đã ghim / AI Agent / Briefing"],
    [k("/"), "Tìm kiếm"],
    [plus(k(MOD_KEY), k("K")), "Lệnh nhanh: nhóm, trang, ticket, phiên AI, tìm tin"],
  ]],
  ["Xử lý tin", [
    [k("x"), "Xong / mở lại tin đang chọn"],
    [plus(k("Shift"), k("x")), "Xong, không thả reaction trên Telegram"],
    [k("s"), "Hoãn tin đang chọn 1 giờ"],
    [k("p"), "Ghim / bỏ ghim tin đang chọn"],
    [k("o"), "Mở tin đang chọn trong Telegram"],
    [or(k("Space"), plus(k("Shift"), <span key="c" className="text-xs text-ink-2"><W k="bấm" /></span>)), "Chọn nhiều tin, rồi Xong / Hoãn / Ghim cả loạt"],
    [k("z"), "Hoàn tác thao tác vừa làm"],
  ]],
  ["Trả lời", [
    [or(k("Enter"), k("r")), "Trả lời tin đang chọn"],
    [k("a"), "Nhập yêu cầu cho AI (khi đang trả lời)"],
    [plus(k(MOD_KEY), k("Enter")), "Gửi trả lời"],
    [k("Esc"), "Bỏ chọn nhiều tin, rồi đóng trả lời (nháp được giữ lại)"],
  ]],
  ["Trợ giúp", [
    [k("?"), "Mở bảng phím tắt"],
    [k("F1"), "Mở hướng dẫn"],
  ]],
];

export const YT_KEYS: ShortcutGroup[] = [
  ["Di chuyển", [
    [plus(k(MOD_KEY), k("K")), "Lệnh nhanh"],
    [k("/"), "Tìm ticket"],
    [or(k("j"), k("k")), "Chọn ticket dưới / trên"],
    [k("Enter"), "Mở ticket đang chọn"],
    [<span key="g" className="inline-flex items-center gap-1">{k("g")}<span className="text-ink-3"><W k="rồi" /></span>{or(k("h"), k("t"), k("d"), k("r"), k("p"), k("a"))}</span>, "Đi tới Trang chính / Ticket / Dashboard / Release / Thành viên / Lịch sử AI"],
  ]],
  ["Chọn và trợ giúp", [
    [k("Space"), "Chọn / bỏ chọn ticket (chọn nhiều)"],
    [k("Esc"), "Xóa ô tìm, rồi bỏ chọn các ticket"],
    [k("?"), "Mở bảng phím tắt"],
    [k("F1"), "Mở hướng dẫn"],
  ]],
];

export function ShortcutList({ list }: { list: Shortcut[] }) {
  const t = useT();
  return (
    <dl className="grid">
      {list.map(([keys, what]) => (
        <div key={what} className="flex items-center justify-between gap-4 border-t border-rule py-2 first:border-0 first:pt-1">
          <dt className="text-sm text-ink-2">{t(what)}</dt>
          <dd className="shrink-0">{keys}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The Inbox's "?" sheet: the Telegram groups, two columns on a wide screen. */
export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogTitle>{t("Phím tắt")}</DialogTitle>
        <div className="grid max-h-[70vh] gap-x-8 gap-y-5 overflow-y-auto md:grid-cols-2">
          {TG_KEYS.map(([name, list]) => (
            <section key={name} aria-label={t(name)} className="grid content-start gap-1">
              <h3 className="text-xs font-bold text-ink-3">{t(name)}</h3>
              <ShortcutList list={list} />
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
