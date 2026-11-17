"use client";

import { Menu } from "@base-ui/react/menu";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Download, FileText, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { AiFetching, useAiWait } from "@/shared/components/ai/fetching";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { Hint } from "@/shared/components/ui/hint";
import { MENU_ACTION, MENU_ITEM, MENU_POPUP } from "@/shared/components/ui/menu";
import { Textarea } from "@/shared/components/ui/textarea";
import { fmtNum, useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";
import { type UiFlow, yt } from "@/features/youtrack/lib/yt";

type Opts = { sources: boolean; paths: boolean; data: boolean };

/** The UI flow header's one download button: the HTML file (to view offline: `onHtml`, the dialog's own export) or
 *  the Markdown for an AI agent (this file's dialog). `busy`: the HTML being packed. */
export function FlowDownload({ issue, get, onHtml, busy, disabled }: { issue: string; get: () => UiFlow | undefined; onHtml: () => void; busy: boolean; disabled: boolean }) {
  const t = useT();
  const [md, setMd] = useState(false);
  return <>
    <Menu.Root>
      <Hint side="bottom" text={t("Tải sơ đồ đang xem (kể cả bản nháp chưa lưu): file HTML để xem offline, hoặc Markdown cho AI agent. Không ghi gì lên ticket.")}>
        <Menu.Trigger aria-label={t("Tải xuống")} disabled={disabled} render={<Button size="icon-sm" variant="ghost" aria-busy={busy} />}>
          {busy ? <Loader2 className="animate-spin" /> : <Download />}
        </Menu.Trigger>
      </Hint>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end" className="z-50 outline-none">
          <Menu.Popup className={cn(MENU_POPUP, "w-60 text-sm")}>
            <Menu.Item className={cn(MENU_ACTION, MENU_ITEM)} onClick={onHtml}><Download />{t("File HTML (xem offline)")}</Menu.Item>
            <Menu.Item className={cn(MENU_ACTION, MENU_ITEM)} onClick={() => setMd(true)}><FileText />{t("Markdown cho AI…")}</Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
    {md && <FlowMdDialog open={md} onOpenChange={setMd} issue={issue} get={get} />}
  </>;
}

/** "Markdown cho AI": the flow on screen (draft included) as one document an AI agent builds from: every screen with
 *  its design's texts, the AC quoted from the ticket / stories, the ways through, what is still missing. Built by the
 *  server (code, no AI) when the dialog opens and again on each changed choice, so its size shows before a copy;
 *  nothing changes on the map, the flow or the ticket. Copied or downloaded. */
function FlowMdDialog({ open, onOpenChange, issue, get }: { open: boolean; onOpenChange: (o: boolean) => void; issue: string; get: () => UiFlow | undefined }) {
  const t = useT();
  const [note, setNote] = useState("");
  const [o, setO] = useState<Opts>({ sources: true, paths: true, data: false }); // the JSON repeats the tables: asked for
  const [copied, setCopied] = useState(false);
  const bare = !get()?.links.length; // "Dựng màn hình" (or nothing linked yet): the file has no tap flow
  const [typed, setTyped] = useState(note); // the note once typing stops: what the shown size is built for
  useEffect(() => { const id = setTimeout(() => setTyped(note), 600); return () => clearTimeout(id); }, [note]);
  // the map under this dialog cannot change while it is open: one opening, one set of builds
  const [opened] = useState(() => Date.now());
  const qc = useQueryClient();
  const build = (n: string) => ({
    queryKey: ["yt", "flow-md", issue, opened, n, o] as const,
    queryFn: () => {
      const f = get();
      if (!f) throw new Error(t("Chưa có sơ đồ"));
      return yt.flowMd(issue, f, { note: n, ...o });
    },
    staleTime: Infinity, retry: false,
  });
  const doc = useQuery({ ...build(typed), placeholderData: keepPreviousData });
  const run = useMutation({
    mutationFn: async (how: "copy" | "file") => {
      const r = await qc.fetchQuery(build(note)); // the shown build when it is this one, else built now
      if (how === "copy") {
        await navigator.clipboard.writeText(r.md);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } else {
        const url = URL.createObjectURL(new Blob([r.md], { type: "text/markdown;charset=utf-8" }));
        Object.assign(document.createElement("a"), { href: url, download: r.name }).click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    },
  });
  // the first build reads the ticket, its stories and the Zeplin designs: the scene; a changed choice counts in place
  const waiting = useAiWait(!doc.data && doc.isFetching);
  const size = doc.data && !doc.isPlaceholderData && typed === note ? doc.data : null;
  const failed = run.error ?? (doc.isError && typed === note ? doc.error : null);
  const box = (k: keyof Opts, label: string, hint: string) => (
    <Hint side="bottom" text={hint}>
      <label className="flex items-center gap-2 text-sm text-ink">
        <Checkbox checked={o[k]} onCheckedChange={(v) => setO((x) => ({ ...x, [k]: !!v }))} disabled={run.isPending} />
        {label}
      </label>
    </Hint>
  );
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!run.isPending) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Markdown cho AI")}</DialogTitle>
          <DialogDescription>
            {t("Một file .md để AI agent làm theo hoặc để tra cứu: mọi màn kèm chữ trên thiết kế Zeplin, nút và màn đích, nội dung AC trích từ ticket / story, đường đi để kiểm thử và danh sách chỗ còn thiếu. Chỉ tạo lúc xuất, không đổi gì trên sơ đồ hay ticket.")}
          </DialogDescription>
        </DialogHeader>
        {waiting ? <AiFetching kind="flowDoc" project={issue.split("-")[0]} className="min-h-80 py-2" /> : <div className="grid grid-cols-1 gap-3">
          {bare && <p role="note" className="rounded-lg bg-warn-wash px-3 py-2 text-xs text-ink">{t("Sơ đồ chưa có nút / mũi tên (dựng bằng “Dựng màn hình”): file chỉ có danh sách màn, chữ thiết kế và ticket; agent phải tự đoán luồng và AC thuộc màn nào. Nối tay trong Sửa hoặc render bằng AI để file đủ.")}</p>}
          <label className="grid grid-cols-1 gap-1.5 text-sm text-ink">
            {t("Yêu cầu thêm cho AI (tuỳ chọn)")}
            <Textarea rows={4} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} disabled={run.isPending}
              placeholder={t("Ví dụ: làm bằng Jetpack Compose theo kiến trúc MVVM của repo; chỉ làm màn Đăng nhập; viết test cho luồng chính")} />
          </label>
          {box("sources", t("Kèm nguyên văn ticket và story"), t("Mô tả và bình luận của ticket cùng story cha, nguyên văn, để AI đọc thêm phần AC không gắn vào màn nào."))}
          {box("paths", t("Kèm đường đi để kiểm thử"), t("Các đường từ màn bắt đầu tới màn cuối, từng bước bấm nút: dùng để viết test hoặc tự kiểm."))}
          {box("data", t("Kèm dữ liệu sơ đồ (JSON)"), t("Toàn bộ màn, nút, liên kết dạng JSON, cho công cụ đọc bằng máy. Trùng với bảng màn / nút nên mặc định tắt (tốn thêm token)."))}
          {size ? <p className="text-xs text-ink-3">{t("Khoảng {n} token ({k} ký tự) khi dán vào AI agent; xuất file không tốn token.", { n: fmtNum(size.tokens), k: fmtNum(size.md.length) })}</p>
            : !failed && <p className="ai-text text-xs">{t("Đang đếm token…")}</p>}
          {failed && <p role="alert" className="text-xs text-error">{t("Không tạo được Markdown: {msg}", { msg: failed.message })}</p>}
        </div>}
        <DialogFooter className="items-center">
          <DialogClose disabled={run.isPending} render={<Button variant="ghost" className="sm:mr-auto" />}>{t("Đóng")}</DialogClose>
          <Button variant="outline" aria-busy={run.isPending && run.variables === "copy"} disabled={waiting} onClick={() => run.mutate("copy")}>
            {run.isPending && run.variables === "copy" ? <Loader2 className="animate-spin" aria-hidden /> : copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? t("Đã sao chép") : t("Sao chép")}
          </Button>
          <Button aria-busy={run.isPending && run.variables === "file"} disabled={waiting} onClick={() => run.mutate("file")}>
            {run.isPending && run.variables === "file" ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
            {t("Tải file .md")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
