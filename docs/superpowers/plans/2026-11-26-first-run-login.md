# Đăng nhập ngay trong tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tab Telegram / YouTrack chưa đăng nhập hiện một thẻ đăng nhập ở giữa màn (linh vật phản ứng, ô OTP chia ô), thay cho redirect sang Cài đặt.

**Architecture:** Form đăng nhập chuyển về feature sở hữu (`features/telegram/components/login.tsx`, `features/youtrack/components/connect.tsx`), Cài đặt import lại. Khung thẻ trung lập `LoginStage` ở `shared/`, nhận `mood` để điều khiển linh vật bằng CSS trên nhóm mắt `m-blink` / `ai-blink` có sẵn. Backend `/api/telegram/code` trả kênh và độ dài mã.

**Tech Stack:** FastAPI + Telethon, Next.js 16 static, React 19, TanStack Query 5, Tailwind 4, motion, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-26-first-run-login-design.md`

## Global Constraints
- Không redirect sang `/settings/` khi chưa đăng nhập; thẻ trong Cài đặt vẫn dùng chung component để đổi tài khoản.
- Chuỗi UI mới: key tiếng Việt qua `useT()`, bản en trong `lib/i18n/en/<khu>.ts` (thiếu là typecheck lỗi).
- Mọi đóng/mở có animation; tôn trọng `prefers-reduced-motion`. Giải thích khi hover dùng `Hint`, không `title`.
- Cỡ chữ chỉ token (`text-xs/sm/base/lg`…), không `text-[Npx]`.
- `shared/` không import `features/` hay `app/`.
- Mutation frontend có `onError` + `errorText`; lỗi không hiện như "không có dữ liệu".
- Không build đè `web/out`, không đụng `:8765`; e2e chạy bản copy ở scratchpad.
- Người dùng đang có WIP chưa commit ở `features/settings/components/youtrack.tsx`, `guide/{vi,en}/settings.json`, `i18n/en/settings.ts`: sửa đúng dòng, không `git checkout` / ghi đè cả file. Không commit trừ khi người dùng bảo.
- **Bỏ khỏi spec (mục 9):** cảnh `FetchKind "connect"` không làm — khi thẻ hiện thì status/config đã nạp xong nên cảnh không bao giờ được thấy; thay skeleton lúc mở app bằng nó sẽ thêm ≥800ms mỗi lần mở. Lúc chờ mutation do `mood="busy"` đảm nhận.

## Review Focus
1. Telegram trả `length` khác 5 (vd. 6) hoặc `null` → `CodeInput` vẽ đúng số ô (null → 5) và chỉ tự gửi khi đủ đúng độ dài. *(test Task 2: `CodeInput` length 6)*
2. Dán mã có khoảng trắng / chữ ("12 345", "Code: 12345") → chỉ giữ số. *(test Task 2)*
3. Đăng nhập xong khi đang ở thẻ trong tab → linh vật vẫy, rồi tab hiện màn chọn vai trò (Telegram) / nội dung (YouTrack); thẻ trong Cài đặt vẫn đổi trạng thái ngay, không đợi. *(e2e Task 5)*
4. Lỗi `flood_wait` / mạng hiện dòng lỗi + lắc; không bị nuốt thành trạng thái bình thường. *(e2e Task 5: route trả 429)*
5. Đổi số / quay lại bước số điện thoại sau khi đã ở bước mã → mắt mở lại (`mood` về `idle`), bước ✓ đúng. *(e2e Task 5)*

---

### Task 1: Backend — `/api/telegram/code` trả kênh và độ dài mã

**Files:**
- Modify: `backend/telegram_dashboard/models.py:477` (thêm model cạnh `TelegramPhone`)
- Modify: `backend/telegram_dashboard/telegram/transport.py:218` (`send_code`)
- Modify: `backend/telegram_dashboard/telegram/routes.py:427`
- Modify: `tests/conftest.py:38` (`FakeTransport`)
- Test: `tests/test_send.py` (test có sẵn `test_send_code_retries_once_after_phone_migrate`) + test route mới cùng file
- Regenerate: `web/src/shared/lib/api.generated.d.ts` (`npm run api:types` ở root)

**Interfaces:**
- Produces: `class TelegramCodeSent(BaseModel): via: Literal["app", "sms", "other"]; length: int | None`
- Produces: `TelethonTransport.send_code(self, phone: str) -> TelegramCodeSent`
- Produces: `POST /api/telegram/code` → 200 `{"via": ..., "length": ...}` (bỏ `status_code=204`, `response_model` là `TelegramCodeSent`)

- [ ] **Step 1: Sửa test có sẵn + viết test route**

```python
# test_send_code_retries_once_after_phone_migrate: thay dòng cuối
    sent = await t.send_code("+84900000000")
    assert t._code_hash == "h" and len(calls) == 2
    assert (sent.via, sent.length) == ("app", 5)


def test_telegram_code_route_returns_channel(client):
    r = client.post("/api/telegram/code", json={"phone": "+84 900 000 000"})
    assert r.status_code == 200 and r.json() == {"via": "app", "length": 5}
```
`FakeTransport` thêm `async def send_code(self, phone) -> TelegramCodeSent` trả `TelegramCodeSent(via="app", length=5)` và `async def sign_in(self, code, password) -> bool: return True` (route kiểm `hasattr(t, "sign_in")`).

- [ ] **Step 2:** `uv run pytest -q tests/test_send.py -k "send_code or telegram_code"` → FAIL (`send_code` trả None / 204).
- [ ] **Step 3: Implement.** Ánh xạ `sent.type`: `SentCodeTypeApp` → `"app"`; `SentCodeTypeSms`, `SentCodeTypeSmsWord`, `SentCodeTypeSmsPhrase` → `"sms"`; còn lại `"other"`. `length = getattr(sent.type, "length", None)` (kiểu `int` hoặc None). Route `return await _login_transport(request).send_code(...)`.
- [ ] **Step 4:** Chạy lại Step 2 → PASS; `uv run ruff check backend tests` sạch.
- [ ] **Step 5:** `npm run api:types` (root); `git diff --stat web/src/shared/lib/api.generated.d.ts` chỉ đổi phần `/api/telegram/code`.

---

### Task 2: Shared primitives — `SecretInput`, `CodeInput`, `LoginStage`, CSS mood

**Files:**
- Modify: `web/src/shared/components/ui/input.tsx` (thêm `SecretInput`)
- Create: `web/src/shared/components/ui/code-input.tsx`
- Create: `web/src/shared/components/login-stage.tsx`
- Modify: `web/src/app/globals.css:351-365` (luật mood cạnh `.m-blink` / `.m-wave`, thêm vào dòng reduced-motion)
- Modify: `web/src/shared/lib/i18n/en/common.ts` (chuỗi mới)
- Test: `web/tests/first-run.spec.ts` (tạo ở Task 5; test của task này chạy qua màn Telegram ở Task 5) — riêng `CodeInput` kiểm bằng e2e Task 5 mục OTP.

**Interfaces:**
- Produces: `function SecretInput(props: React.ComponentProps<"input"> & { onReveal?: (shown: boolean) => void }): JSX.Element` — `Input` + nút Eye/EyeOff (lucide) ở mép phải, bọc `Hint` (text vi: "Hiện / ẩn nội dung"), `aria-pressed`; đổi `type` giữa `password` / `text`.
- Produces: `function CodeInput({ value, onChange, length, onComplete, label, autoFocus }: { value: string; onChange: (v: string) => void; length?: number | null; onComplete?: (v: string) => void; label: string; autoFocus?: boolean }): JSX.Element` — một `<input>` thật (`inputMode="numeric"`, `autoComplete="one-time-code"`, `maxLength=n`), trong suốt phủ lên `n` ô vẽ bằng `span` (ô đang nhập có viền `hl`); `n = length ?? 5`; `onChange` nhận chỉ chữ số (`replace(/\D/g, "")`, cắt `n`); gọi `onComplete` khi độ dài đạt `n`.
- Produces: `export type Mood = "idle" | "shy" | "peek" | "busy" | "no" | "happy"`
- Produces: `function LoginStage({ mood, title, sub, children }: { mood: Mood; title: ReactNode; sub?: ReactNode; children: ReactNode }): JSX.Element` — bố cục căn giữa giống `RolePicker` (`main grid place-items-center px-4 py-10`, thẻ `max-w-md rounded-[var(--radius-card)] border bg-cotton shadow-stock p-5`), trên cùng `BotStage` (từ `ui/empty.tsx`) chứa `AiBot className="ai-float relative size-20"`; wrapper có `data-mood={mood}`; `busy` → thêm vòng `animate-ping` như `Bot ring` trong `ai/fetching.tsx`; `no` → thẻ lắc ngang một lần (`motion` `x: [0,-6,6,-4,4,0]`, 0.35s, bỏ khi `useReducedMotion()`), chạy lại mỗi lần chuyển sang `no`; `happy` → remount `AiBot` (đổi `key`) để `.m-wave` chạy lại.
- CSS (globals.css):
  - `[data-mood="shy"] :is(.m-blink, .ai-blink) { animation: none; scale: 1 0.1; transition: scale var(--dur-short) var(--ease-out); }`
  - `[data-mood="peek"] :is(.m-blink, .ai-blink) { animation: none; scale: 1 0.45; }`
  - `[data-mood="no"] .ai-float { animation: m-no 0.4s ease-in-out 2; }` với `@keyframes m-no { 25% { rotate: -10deg } 75% { rotate: 10deg } }`
  - thêm `[data-mood] .ai-float` vào khối reduced-motion (giữ khép mắt — là trạng thái, không phải chuyển động).

- [ ] **Step 1:** Implement ba component + CSS theo Interfaces.
- [ ] **Step 2:** `npm run typecheck && npm run lint` (root) → PASS.

---

### Task 3: `TelegramLogin` về feature Telegram + mood + OTP + thanh bước

**Files:**
- Create: `web/src/features/telegram/components/login.tsx` (chuyển `TelegramSection` + `TG_ERRORS` từ `features/settings/components/telegram.tsx:206-282`)
- Modify: `web/src/features/settings/components/telegram.tsx` (xóa phần đã chuyển, import `TelegramLogin`, bỏ import thừa)
- Modify: `web/src/shared/lib/i18n/en/inbox.ts` (chuỗi mới)

**Interfaces:**
- Consumes: `SecretInput`, `CodeInput`, `Mood` (Task 2); `TelegramCodeSent` qua `api.generated.d.ts` (Task 1).
- Produces: `export function TelegramLogin({ onMood }: { onMood?: (m: Mood) => void }): JSX.Element`
- Hành vi mới (giữ nguyên mọi nhánh cũ: degraded, connected, lỗi status, "Đổi API ID/Hash"):
  - API Hash, 2FA → `SecretInput`; focus → `onMood("shy")`, blur → `"idle"`, `onReveal(true)` → `"peek"`, `onReveal(false)` khi đang focus → `"shy"`.
  - Mutation pending → `"busy"`; `onError` → `"no"` (dòng lỗi giữ `errorText(err, tMap(t, TG_ERRORS), …)`).
  - Bước mã: `CodeInput length={sent?.length} onComplete={() => signIn.mutate()}`; dòng phụ theo `sent.via`: `"app"` → t("Mã gửi vào app Telegram trên điện thoại / máy khác (không phải SMS)"), `"sms"` → t("Mã gửi qua SMS"), `"other"` → không dòng.
  - Thanh bước 4 mục: "API" · "Số điện thoại" · "Mã" · "2FA"; bước xong có `Check` (lucide), bước hiện tại `bg-hl-wash text-hl-2`; "2FA" chỉ hiện khi `step === "password"`, hiện bằng `AnimatePresence` + `width/opacity`.
  - Đổi bước: thân form bọc `AnimatePresence mode="wait"` (fade + `y: 6`), key = step.
  - Thành công khi có `onMood`: `onMood("happy")`, `setTimeout(refresh, 1200)`; không có `onMood` (Cài đặt): `refresh()` ngay như cũ.
  - "Đổi số / gửi lại mã" → `onMood?.("idle")`.

- [ ] **Step 1:** Chuyển code + thêm hành vi; Cài đặt render `<TelegramLogin />` trong thẻ "Tài khoản Telegram".
- [ ] **Step 2:** `npm run typecheck && npm run lint` → PASS; `grep -rn "TelegramSection" web/src` → không còn.

---

### Task 4: `YtConnect` về feature YouTrack + mood

**Files:**
- Create: `web/src/features/youtrack/components/connect.tsx` (chuyển `YouTrackSection` + `YT_ERRORS` từ `features/settings/components/youtrack.tsx:76-~140`, **sửa tại chỗ, giữ WIP của người dùng**)
- Modify: `web/src/features/settings/components/youtrack.tsx` (import `YtConnect`)
- Modify: `web/src/features/youtrack/lib/yt.ts:41` (`Config` thêm `hint: string | null`)
- Modify: `web/src/shared/lib/i18n/en/yt.ts` (chuỗi mới)

**Interfaces:**
- Consumes: `SecretInput`, `Mood` (Task 2); `yt.config` (`features/youtrack/lib/yt.ts:177`).
- Produces: `export function YtConnect({ onMood }: { onMood?: (m: Mood) => void }): JSX.Element`
- Hành vi:
  - Query đổi sang `useQuery({ queryKey: ["yt", "config"], queryFn: yt.config, staleTime: Infinity })` (cùng key `state.tsx:89`, bỏ key `"yt-config"`); `onSuccess` giữ `qc.removeQueries({ queryKey: ["yt"] })` + invalidate `["status"]`.
  - Token → `SecretInput` (mood shy/peek như Task 3); pending → `"busy"`; lỗi → `"no"`.
  - Thành công khi có `onMood`: `onMood("happy")`, chữ t("Xin chào {name}", { name }) trong `StatusLine ok`, gỡ cache sau 1200ms; không có `onMood`: như cũ.

- [ ] **Step 1:** Chuyển code + hành vi; Cài đặt render `<YtConnect />`.
- [ ] **Step 2:** `npm run typecheck && npm run lint` → PASS; `grep -rn "yt-config\|YouTrackSection" web/src` → không còn.

---

### Task 5: Gắn thẻ vào tab, bỏ redirect, guide, e2e

**Files:**
- Modify: `web/src/features/telegram/components/inbox.tsx:128-133,189-192` (bỏ `firstRun` + `router.replace`; nhánh gate)
- Modify: `web/src/features/youtrack/components/app.tsx:99-118` (bỏ effect redirect `mock`; nhánh gate trước `RolePicker`)
- Modify: `web/src/shared/lib/guide/{vi,en}/settings.json` (mục `settings-telegram-account` + mục kết nối YouTrack: thêm câu "Chưa đăng nhập thì tab Telegram / YouTrack hiện thẻ đăng nhập này ngay trong tab"; sửa đúng dòng `what`, không đụng WIP)
- Modify: `web/src/shared/lib/i18n/en/inbox.ts`, `yt.ts` (tiêu đề thẻ)
- Create: `web/tests/first-run.spec.ts`

**Interfaces:**
- Consumes: `LoginStage`, `Mood` (Task 2), `TelegramLogin` (Task 3), `YtConnect` (Task 4).
- Telegram: trong component bao ngoài `Inbox` (chỗ đang render `RolePicker`, `inbox.tsx:128`), khi `status.data.state` là `setup_required` / `login_required` → `TopBar module="telegram"` + `LoginStage mood={mood} title={t("Kết nối Telegram")} sub={t("Đăng nhập một lần, phiên chỉ lưu trên máy này.")}` chứa `<TelegramLogin onMood={setMood} />`. Thứ tự giữ: đăng nhập → `RolePicker` → `Inbox`.
- YouTrack: `if (y.config?.mock)` → `TopBar module="youtrack"` + `LoginStage title={t("Kết nối YouTrack")} sub={t("Dán token cá nhân, chỉ lưu trên máy này.")}` chứa `<YtConnect onMood={setMood} />`, đặt **trước** nhánh `!y.role` (đăng nhập → vai trò, giống Telegram).

- [ ] **Step 1: Viết e2e** `web/tests/first-run.spec.ts` (mock bằng `page.route` như `setup-hints.spec.ts`):

```ts
test("telegram login_required: the tab shows the login card, no redirect", async ({ page }) => {
  await page.route("**/api/status", async (r) => r.fulfill({ json: { ...(await (await r.fetch()).json()), state: "login_required", telegram_api_id: 1 } }));
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Kết nối Telegram" })).toBeVisible();
});

test("code step: boxes follow length, paste keeps digits, eyes close on 2FA", async ({ page }) => {
  // status login_required như trên; /api/telegram/code → { via: "app", length: 6 }; /api/telegram/sign-in → { password_required: true }
  // điền số → "Gửi mã" → thấy "Mã gửi vào app Telegram"; 6 ô (locator ô theo data-slot="code-cell") có count 6
  // fill "Code: 12 3456" → input value "123456" → tự gọi sign-in → bước 2FA hiện
  // focus ô "Mật khẩu 2FA" → expect(page.locator("[data-mood]")).toHaveAttribute("data-mood", "shy")
  // bấm "Đổi số / gửi lại mã" → data-mood "idle"
});

test("flood_wait shows the error and shakes, not a normal state", async ({ page }) => {
  // /api/telegram/code → 429 { code: "flood_wait" } → alert chứa "Telegram tạm chặn" và data-mood "no"
});

test("youtrack mock: the tab shows the token card, no redirect", async ({ page }) => {
  // /api/yt/config → { base: "", mock: true, hint: null, t: {...}, hist: 0, ai: false }; goto /youtrack/ → URL giữ /youtrack/, heading "Kết nối YouTrack"
});
```
`CodeInput` cần `data-slot="code-cell"` trên mỗi ô.

- [ ] **Step 2:** Chạy e2e trên bản copy scratch (theo `AGENTS.md`: copy repo, build ở copy, `npx playwright test tests/first-run.spec.ts`) → FAIL (đang redirect).
- [ ] **Step 3:** Implement hai nhánh gate + bỏ redirect + guide/i18n.
- [ ] **Step 4:** Chạy lại e2e trên copy → PASS. Chạy thêm `setup-hints.spec.ts`, `inbox.spec.ts`, `guide-po.spec.ts` → PASS (đỏ thì chạy lại trên code gốc trước khi kết luận).
- [ ] **Step 5:** Chụp màn (Playwright `page.screenshot`) 4 trạng thái: thẻ Telegram bước API, bước mã 5 ô, 2FA mắt nhắm, thẻ YouTrack — gửi người dùng.
- [ ] **Step 6:** Kiểm cuối ở root: `uv run pytest -q tests/test_repo_guards.py`, `uv run ruff check .`, `npm run typecheck`, `npm run lint`; `codegraph sync`.
