---
name: web-frontend-practices
description: Use when writing or reviewing code under web/ (Next.js 16 static export, React 19, TanStack Query 5, Tailwind 4, shadcn/base-ui, motion) — components, hooks, data fetching, styling, accessibility, performance, frontend security, or Playwright e2e tests.
---

# Web frontend best practices (web/)

## Ràng buộc của dự án (đọc trước)
- **Next 16 khác dữ liệu huấn luyện:** đọc guide trong `web/node_modules/next/dist/docs/` trước khi dùng API Next (xem `web/AGENTS.md`).
- **Static export** (`output: "export"`, FastAPI serve `out/`): không Server Actions, không route handler, không `cookies()/headers()`, không ISR, không `next/image` tối ưu. Mọi thứ là client component gọi `/api`.
- **Design đã khóa:** màu / khoảng cách / radius / motion lấy từ token (`web/src/app/tokens.css`, `DESIGN.md`); không viết literal màu hay `px` lạ trong component.
- **UI primitive có sẵn:** `components/ui/` (`Button`, `Dialog`, `Input`, `Segmented`/`Pill`, `Hint`, `Skeleton`…). Tab chọn-một → `Segmented`; giải thích khi hover → `Hint`, không dùng `title`.

## Dữ liệu (TanStack Query)
- Mọi gọi backend qua `api<T>()` (`web/src/lib/api.ts`); kiểu lấy từ `api.generated.d.ts` — **không tự khai báo lại DTO**. Backend đổi model → `uv run python -m telegram_dashboard export-openapi` rồi `npm run api:types`.
- Query key là mảng ổn định bắt đầu bằng tên tài nguyên (`["messages", chatId, …]`); truyền `signal` vào `api()` để hủy request.
- Mutation: `retry: false` (gửi tin / AI không bao giờ tự gửi lại). Sau khi xong: `invalidateQueries` key liên quan, hoặc `setQueryData` khi server đã trả bản mới.
- SSE (`hooks/use-events.ts`) là nguồn cập nhật; đừng thêm polling nếu có event (polling chỉ khi không có SSE, kèm comment `ponytail:`).
- Không cache dữ liệu riêng tư vào `localStorage`; chỉ lưu preference UI (theme, look). Ngoại lệ có chủ đích: nháp trả lời theo tag (`saveDraft`, tự xóa khi tin xong / xóa dữ liệu nhóm / Cài đặt › "Xóa nháp"); hàng Báo lại chỉ lưu mã tham chiếu (`lib/report-back.ts`), nội dung tin đọc từ server khi hiển thị.

## React 19
- State dẫn xuất → tính trong render, không `useEffect` + `setState`.
- `useEffect` chỉ để đồng bộ với hệ ngoài (DOM, subscription); luôn cleanup.
- Key list = id ổn định (`message_id`), không dùng index.
- Không `useMemo`/`useCallback` theo phản xạ; chỉ khi đo thấy render tốn hoặc cần referential stability.
- Mỗi vùng dữ liệu có đủ 3 trạng thái: skeleton (đúng hình nội dung), empty (cái gì ở đây + một hành động), error (cái gì hỏng + thử lại).

## Accessibility
- Phần tử tương tác = `<button>` / `<a>` thật, không `div onClick`. Nút chỉ có icon phải có `aria-label`.
- Focus thấy được (`--color-focus`); dialog / menu dùng primitive base-ui (bẫy focus, `Esc` đóng).
- Tương phản chữ ≥ 4.5:1; trạng thái không chỉ bằng màu (kèm chữ / ô màu).
- Phím tắt (`j/k/r/x/a`) không chạy khi đang gõ trong input/textarea.
- Motion: chỉ `transform`/`opacity`, tôn trọng `prefers-reduced-motion`; không `transition: all`.

## Bảo mật frontend
- Không `dangerouslySetInnerHTML` với dữ liệu từ Telegram/AI. Markdown qua `react-markdown` (không bật `rehype-raw`).
- Link ngoài: `target="_blank" rel="noopener noreferrer"` (mẫu `Link` trong `components/markdown.tsx`); URL lấy từ dữ liệu ngoài không được là `javascript:` (`react-markdown` lọc mặc định, `href` tự gán thì phải tự kiểm).
- Không đưa nội dung tin nhắn hay token vào query string / log console.

## Hiệu năng
- List dài: phân trang `useInfiniteQuery` (đã có), không render toàn bộ lịch sử.
- Import nặng (markdown, dialog hiếm dùng) → `next/dynamic` khi đo thấy bundle lớn.

## Quyết định stack (đừng tự đổi)
- **Kiểu API:** `openapi-typescript` (chỉ type) + `api()` viết tay; không chuyển sang hey-api/kubb sinh hook.
- **State:** server state = TanStack Query; UI state = `useState`/context sẵn có (`components/yt/state.tsx`). Không thêm Zustand/Redux.
- **URL state:** chỉ khi cần link chia sẻ được; dùng `URLSearchParams` + `history.replaceState` (đã dùng ở `inbox.tsx`, `settings.tsx`, `yt/state.tsx`), không thêm `nuqs`.
- **Form:** validate bằng thuộc tính HTML + lỗi `code` từ backend (Pydantic là nguồn sự thật); không thêm zod/react-hook-form cho vài form nhỏ.
- **Tailwind 4:** đã CSS-first (`@theme` trong `globals.css`, không có `tailwind.config.js`); token mới thêm vào `tokens.css`.
- **React 19 Actions / `useActionState`:** không trộn với `useMutation` cho cùng một luồng; giữ `useMutation`.
- Cần một thư viện mới → hỏi user trước.

## Xác minh (trong `web/`)
`npm run typecheck && npm run lint`; đổi luồng UI chính → `npm run build && npm run test:e2e`.
