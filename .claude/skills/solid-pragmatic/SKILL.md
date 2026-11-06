---
name: solid-pragmatic
description: Use when designing, refactoring or reviewing Python (FastAPI) or TypeScript (React) code in this repo and deciding on classes, modules, interfaces, abstractions, dependency injection, or splitting a large function/file (god class, long function, high cyclomatic complexity, "should I add an interface/base class").
---

# SOLID, kiểu thực dụng

## Nguyên tắc cốt lõi
SOLID là **lăng kính để phát hiện chỗ đau**, không phải checklist để thêm lớp. Ở repo này YAGNI thắng: chỉ tách / trừu tượng khi đã có **≥ 2 lý do thay đổi thật** hoặc **≥ 2 implementation thật**. Một interface cho một implementation = bloat.

## Quick reference

| Nguyên tắc | Dấu hiệu vi phạm thật | Cách sửa nhỏ nhất | Đừng làm |
|---|---|---|---|
| **S** — Single responsibility | Một hàm vừa gọi Telegram, vừa ghi DB, vừa format JSON; sửa UI kéo theo sửa storage | Tách hàm thuần (parse/format) khỏi I/O; giữ trong cùng file nếu chỉ một nơi dùng | Mỗi hàm một file, class `XxxManager` |
| **O** — Open/closed | `if provider == "a" … elif "b" …` lặp ở nhiều chỗ | Dict `{kind: handler}` hoặc `Literal` + `match`, một chỗ duy nhất | Plugin registry, metaclass |
| **L** — Liskov | Subclass ném lỗi / bỏ qua method của cha; fake test hành xử khác bản thật | Dùng composition; fake cùng chữ ký và cùng ngữ nghĩa lỗi | Kế thừa để tái dùng code |
| **I** — Interface segregation | Component nhận cả object `Message` chỉ để đọc 2 field; Protocol 10 method nhưng caller dùng 1 | Truyền đúng field cần; `Protocol` nhỏ ngay tại nơi dùng | Chia interface "phòng khi" |
| **D** — Dependency inversion | Hàm tự tạo `httpx.AsyncClient()` / đọc `Settings()` bên trong → không test được | Nhận dependency qua tham số / `create_app(settings, …)` (đã có mẫu trong `tests/conftest.py`) | DI container, service locator |

## Áp dụng ở repo này
- **Python:** wiring ở `create_app()` trong `telegram_dashboard/app.py`; service (`AiService`, `DigestService`, `Store`, `TelegramBridge`) nhận dependency qua constructor. Giữ kiểu đó, không thêm framework DI.
- **Duck typing > ABC:** cần thay bản fake trong test thì dùng `typing.Protocol` khai báo ngay cạnh nơi dùng, chỉ khi có ≥ 2 implementation.
- **React:** S = component lo hiển thị, hook (`web/src/hooks/`) lo dữ liệu; D = component nhận props/callback, không tự `fetch` (dùng `api()` + TanStack Query).
- **Hàm quá dài** (vd `agent.py:_pump`, `ai.py:_run`, `providers.py:items` — cc > 50): tách theo **giai đoạn** (parse → quyết định → I/O), mỗi giai đoạn một hàm private cùng file. Đổi hành vi = không phải refactor; làm riêng.

## Trước khi thêm abstraction, hỏi
1. Hôm nay có ≥ 2 caller / implementation thật không? Không → đừng thêm.
2. Một hàm hoặc một dict có đủ không? Có → dùng nó.
3. Test có cần thay dependency này không? Có → nhận qua tham số, xong.

## Lỗi hay gặp
- Gọi lý do "cho đúng SOLID" để thêm base class / factory → xóa, quay lại hàm.
- Tách file khiến phải nhảy 4 file mới đọc hết một luồng → gộp lại.
- Refactor kèm đổi hành vi trong cùng diff → tách 2 bước, chạy `uv run pytest` giữa hai bước.

Xác minh: `uv run ruff check .` + `uv run pytest` (Python), `npm run typecheck && npm run lint` trong `web/`.
