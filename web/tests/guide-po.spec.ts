import { expect, type Locator, type Page, test } from "@playwright/test";

// The live guide (guide-tour.tsx) walked on the real page for every PO feature: each step must light the control it
// names (the ring sits on it) and clicking the lit spot must move on. Telegram / YouTrack / AI are faked per test.

const CHAT = "-1001";
const NOW = Date.now();
// its own message id: po-flow.spec.ts's item (message 1) keeps no "đã vào story" mark from these walks (one server)
const ask = { text: "Hủy gói giữa kỳ có hoàn tiền không? (VA-1)", who: "PO", why: "Dev hỏi", message_ids: ["5"], tickets: ["VA-1"], due: "", be: false, topic: "" };
const ticket = { id: "VA-1", summary: "Gia hạn gói", created: NOW - 9e7, updated: NOW - 9e6, resolved: null, type: "Task", state: "CONFIRM DEFINITION",
  priority: "Normal", assignee: "Anh", assigneeLogin: "anh", qc: "Bình", qcLogin: "binh", reporter: "Bình", due: null, estimate: null, sprints: [] };
const detail = { ...ticket, description: "**Mục tiêu**\nGia hạn gói.", comments: [], links: [], attachments: [] };
const amended = "**Mục tiêu**\nGia hạn gói.\n\n**Tiêu chí nghiệm thu**\n- [ ] Hủy giữa kỳ: không hoàn tiền";
const msg = (id: string, text: string, sender: string, reply: string | null, ago: number) => ({ chat_id: CHAT, message_id: id, sender_id: sender, sender_name: sender === "me" ? "Anh" : "Bình",
  text, date: new Date(NOW - ago).toISOString(), edit_date: null, reply_to_id: reply, topic_id: null, outgoing: sender === "me", media_kind: null, deleted: false, links: [] });

async function setup(page: Page, origin: string) {
  const headers = { origin: new URL(origin).origin };
  const had: { waits: { key: string }[] } = await (await page.request.get("/api/briefing/follow")).json();
  await page.request.post("/api/briefing/follow", { data: { drop: had.waits.map((w) => w.key) }, headers });
  await page.request.post("/api/briefing/done", { data: { keys: [`${CHAT}:confirmations:5`], on: false }, headers });
  await page.addInitScript(() => localStorage.setItem("ytMode", "po"));
  const digest = { topics: [], impacts: [], changes: [], decisions: [], confirmations: [ask], actions: [] };
  await page.route("**/api/briefing", (r) => r.fulfill({ json: [{ chat_id: CHAT, title: "Nhóm A", consent: true, latest_id: "10",
    saved: { created_at: new Date().toISOString(), last_message_id: "10", result: digest } }] }));
  await page.route(/\/api\/briefing\/(answered|be-replies)$/, (r) => r.fulfill({ json: {} }));
  await page.route("**/api/briefing/follow/replies", (r) => r.fulfill({ json: { replies: {}, failed: [] } }));
  await page.route("**/api/status", async (r) => r.fulfill({ json: { ...(await (await r.fetch()).json()), youtrack_configured: true } }));
  await page.route("**/api/yt/config", (r) => r.fulfill({ json: { base: "https://yt.test", mock: false, t: { wip: 3, stale: 7, dead: 14 }, hist: 0, ai: true } }));
  await page.route("**/api/yt/projects", (r) => r.fulfill({ json: [{ shortName: "VA", name: "VA" }] }));
  await page.route("**/api/yt/me", (r) => r.fulfill({ json: { login: "anh", name: "Anh" } }));
  await page.route(/\/api\/yt\/issues\?/, (r) => r.fulfill({ json: [ticket] }));
  await page.route(/\/api\/yt\/issue\?id=VA-1/, (r) => r.fulfill({ json: detail }));
  await page.route(/\/api\/yt\/people\?/, (r) => r.fulfill({ json: [{ login: "anh", name: "Anh" }, { login: "binh", name: "Bình" }] }));
  await page.route(/\/api\/yt\/mentions\?/, (r) => r.fulfill({ json: [{ chat_id: CHAT, chat: "Nhóm A", message_id: "1", from: "Bình", text: ask.text, date: NOW - 6e6, outgoing: false }] }));
  await page.route(/\/api\/yt\/asked\?/, (r) => r.fulfill({ json: [{ ticket, ask: { text: "@anh hủy giữa kỳ có hoàn tiền?", created: NOW - 5e6, author: "Bình" } }] }));
  await page.route("**/api/yt/ai/ticket", (r) => r.fulfill({ contentType: "application/x-ndjson",
    body: `${JSON.stringify({ done: { text: amended, draft: "VA-1 cập nhật story", base: detail.description } })}\n` }));
  await page.route("**/api/yt/issue/description", (r) => r.fulfill({ json: { ok: true } }));
  await page.route("**/api/yt/issue/comment", (r) => r.fulfill({ json: { ok: true } }));
}

/** Starts the guide's walk of feature `id` (as its "Hướng dẫn" button does) at step `i`. */
async function tour(page: Page, id: string, from: "telegram" | "youtrack", i = 0) {
  await page.addInitScript((s) => sessionStorage.setItem("guide-tour", s), JSON.stringify({ id, from, i }));
}

type Want = { at?: Locator; click?: Locator; fill?: string } | null; // null: a text step (Tiếp)
/** Walks the tour: a lit step must ring `at` (its centre inside it), then is used (`click` inside it, or the ring's
 *  centre; `fill`: typed, then Tiếp); a text step says so and moves on with Tiếp. */
async function walk(page: Page, steps: Want[], first = 0) {
  const box = page.getByRole("dialog", { name: /^Hướng dẫn:/ });
  const ring = page.locator("[data-guide-tour] > div[aria-hidden]");
  const n = first + steps.length;
  for (const [k, w] of steps.entries()) {
    await expect(box.getByText(`Bước ${first + k + 1}/${n}`)).toBeVisible();
    if (!w) {
      await expect(box.getByText("Làm theo mô tả rồi bấm Tiếp.")).toBeVisible();
      await box.getByRole("button", { name: k === steps.length - 1 ? "Xong" : "Tiếp" }).click();
      continue;
    }
    await expect(box.getByText(w.fill === undefined ? "Bấm vào chỗ đang sáng để làm bước này." : "Nhập / chọn ở ô đang sáng rồi bấm Tiếp.")).toBeVisible();
    await expect.poll(async () => {
      const r = await ring.boundingBox(), t = await w.at!.boundingBox();
      if (!r || !t) return false;
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      return x >= t.x && x <= t.x + t.width && y >= t.y && y <= t.y + t.height;
    }, { message: `step ${first + k + 1} lights its control` }).toBe(true);
    await page.waitForTimeout(400); // the ring and the shade's hole move in 300 ms: a click meanwhile lands on the shade
    if (w.fill !== undefined) {
      await w.at!.fill(w.fill);
      await box.getByRole("button", { name: k === steps.length - 1 ? "Xong" : "Tiếp" }).click();
    } else if (w.click) await w.click.click();
    else {
      const r = (await ring.boundingBox())!;
      await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
    }
  }
  await expect(box).toHaveCount(0); // the last step ends the walk
}

const btn = (page: Page, name: string | RegExp, exact = true) => page.getByRole("button", { name, exact });
/** The Cập nhật story dialog's steps, the same after every way in. */
const storySteps = (page: Page): Want[] => {
  const d = page.getByRole("dialog").filter({ hasText: "Báo cho ai" });
  return [{ at: d.getByRole("textbox", { name: "Mô tả", exact: true }), fill: amended }, null, null,
    { at: d.getByRole("button", { name: "Lưu", exact: true }) }];
};

test.beforeEach(async ({ page, baseURL }) => { await setup(page, baseURL!); });

test("guide: Chờ bổ sung lights Briefing, Chờ…, the reason, the tab and Nhắc", async ({ page }) => {
  await tour(page, "briefing-wait", "telegram");
  await page.goto("/");
  const nav = page.locator("nav").getByRole("button", { name: /^Briefing/ }).or(page.locator("nav").getByRole("link", { name: /^Briefing/ }));
  await walk(page, [{ at: nav.first() }, { at: btn(page, "Chờ…") }, { at: page.getByRole("menuitem", { name: "Chờ design" }) },
    { at: page.getByRole("button", { name: /^Chờ bổ sung/ }) }, null, { at: btn(page, "Nhắc") }]);
});

test("guide: Cập nhật story from Briefing (PO) walks into the dialog and saves", async ({ page }) => {
  await tour(page, "briefing-story", "telegram");
  await page.goto("/");
  const nav = page.locator("nav").getByRole("button", { name: /^Briefing/ }).or(page.locator("nav").getByRole("link", { name: /^Briefing/ }));
  const tabs = page.getByRole("group", { name: "Lọc việc" });
  await walk(page, [{ at: nav.first() }, { at: tabs, click: tabs.getByRole("button", { name: /^Cần confirm/ }) },
    { at: btn(page, "Cập nhật story") }, ...storySteps(page)]);
});

test("guide: Cập nhật story from the ticket sheet (PO)", async ({ page }) => {
  await tour(page, "yt-cap-nhat-story", "youtrack");
  await page.goto("/youtrack/");
  await walk(page, [{ at: page.getByRole("button", { name: /^Ticket/ }).or(page.getByRole("link", { name: /^Ticket/ })).first() },
    { at: page.locator("tbody tr[data-id]").first() }, { at: btn(page, "Cập nhật story") }, ...storySteps(page)]);
});

// No group names the ticket yet: the Telegram box asks which group to tell, tags that group's own members, and sends a
// new message there (the Q&A post: the app's way to post to any group).
test("Cập nhật story › Telegram with no group yet: pick the group, then send a new message there", async ({ page }) => {
  await page.route(/\/api\/yt\/mentions\?/, (r) => r.fulfill({ json: [] }));
  await page.route(`**/api/chats/${CHAT}/members`, (r) => r.fulfill({ json: [{ user_id: "11", name: "Trần Bình", username: "binh_tg" }] }));
  const posts: { chat_id: string; text: string; reply_to: string | null }[] = [];
  await page.route("**/api/qa", (r) => {
    if (r.request().method() !== "POST") return r.fallback();
    posts.push(r.request().postDataJSON());
    return r.fulfill({ status: 201, json: { message_id: "99", code: null, joined: false } });
  });
  await page.goto("/youtrack/");
  await page.getByRole("button", { name: /^Ticket/ }).or(page.getByRole("link", { name: /^Ticket/ })).first().click();
  await page.locator("tbody tr[data-id]").first().click();
  await btn(page, "Cập nhật story").click();
  const tg = page.getByRole("dialog").filter({ hasText: "Báo cho ai" }).getByRole("region", { name: "Tin nhắn Telegram" });
  await expect(tg.getByRole("button", { name: "Gửi Telegram" })).toBeDisabled(); // nowhere to send yet
  await tg.getByRole("button", { name: "Chọn nhóm Telegram" }).click();
  await page.getByRole("option", { name: /Nhóm Dự án/ }).click(); // one of the account's groups (fixture: -1001)
  await page.keyboard.press("Escape"); // several can be picked: the list stays open until closed
  const box = tg.getByRole("textbox", { name: "Tin nhắn Telegram" });
  await expect(box).toHaveValue(/^@binh_tg Đã cập nhật story VA-1/); // QC "Bình", as that group names them
  await box.fill("@binh_tg VA-1 đã cập nhật");
  await tg.getByRole("button", { name: "Gửi Telegram" }).click();
  await expect(tg.getByRole("button", { name: "Đã gửi vào nhóm" })).toBeVisible();
  // request_id: one per send, so a double click / retry is not posted twice (Telegram drops the repeat)
  expect(posts).toEqual([{ chat_id: CHAT, text: "@binh_tg VA-1 đã cập nhật", reply_to: null, start: false, request_id: expect.any(String) }]);
});

// Several groups get the message; a quick group keeps its people (by name) when the dialog opens again with no group
// picked; with "Thêm bình luận và gửi Telegram" ticked, Lưu also sends the comment and the Telegram message.
test("Cập nhật story › several groups, a quick group remembered, Lưu sends both when ticked", async ({ page }) => {
  await page.route(/\/api\/yt\/mentions\?/, (r) => r.fulfill({ json: [] }));
  await page.route("**/api/groups", (r) => r.fulfill({ json: [{ chat_id: CHAT, title: "Nhóm Dự án", kind: "supergroup" }, { chat_id: "-1002", title: "Nhóm QC", kind: "supergroup" }] }));
  await page.route(`**/api/chats/${CHAT}/members`, (r) => r.fulfill({ json: [{ user_id: "11", name: "Trần Bình", username: "binh_tg" }] }));
  await page.route("**/api/chats/-1002/members", (r) => r.fulfill({ json: [{ user_id: "12", name: "Cường", username: null }] }));
  const posts: { chat_id: string; text: string }[] = [], comments: { text: string }[] = [];
  await page.route("**/api/qa", (r) => {
    if (r.request().method() !== "POST") return r.fallback();
    posts.push(r.request().postDataJSON());
    return r.fulfill({ status: 201, json: { message_id: "99", code: null, joined: false } });
  });
  await page.route("**/api/yt/issue/comment", (r) => { comments.push(r.request().postDataJSON()); return r.fulfill({ json: { ok: true } }); });
  await page.goto("/youtrack/");
  await page.getByRole("button", { name: /^Ticket/ }).or(page.getByRole("link", { name: /^Ticket/ })).first().click();
  await page.locator("tbody tr[data-id]").first().click();
  await btn(page, "Cập nhật story").click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Báo cho ai" });
  const tg = dialog.getByRole("region", { name: "Tin nhắn Telegram" });
  await tg.getByRole("button", { name: "Chọn nhóm Telegram" }).click();
  await page.getByRole("option", { name: /Nhóm Dự án/ }).click();
  await page.getByRole("option", { name: /Nhóm QC/ }).click();
  await page.keyboard.press("Escape");
  await expect(tg.getByRole("button", { name: "Chọn nhóm Telegram" })).toHaveText(/Nhóm Dự án, Nhóm QC/);
  // a quick group takes people of either group; its chip counts them
  await tg.getByRole("button", { name: "Sửa nhóm tag nhanh" }).click();
  const be = tg.getByRole("group", { name: "Người trong nhóm BE" });
  await be.getByRole("button", { name: "Thêm người" }).click();
  await page.getByRole("option", { name: /Cường/ }).click();
  await expect(be).toContainText("1 người");
  await expect(tg.getByRole("group", { name: "Tag nhanh theo nhóm" }).getByRole("button", { name: /^BE/ })).toHaveText("BE1");
  const box = tg.getByRole("textbox", { name: "Tin nhắn Telegram" });
  await box.fill("VA-1 đã cập nhật");
  // ticked: Lưu writes the description, then adds the comment and posts to each group
  await dialog.getByRole("textbox", { name: "Mô tả", exact: true }).fill(amended);
  await dialog.getByRole("checkbox", { name: "Thêm bình luận và gửi Telegram" }).click();
  await dialog.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(tg.getByRole("button", { name: "Đã gửi vào nhóm" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Đã gửi bình luận" })).toBeVisible();
  expect(posts.map((p) => [p.chat_id, p.text])).toEqual([[CHAT, "VA-1 đã cập nhật"], ["-1002", "VA-1 đã cập nhật"]]);
  expect(comments).toHaveLength(1);
  // opened again: no group picked yet, the quick group still shows who is in it
  await dialog.getByRole("button", { name: "Đóng", exact: true }).click();
  await btn(page, "Cập nhật story").click();
  await tg.getByRole("button", { name: "Sửa nhóm tag nhanh" }).click();
  await expect(be).toContainText("Cường");
  await expect(tg).toContainText("Chọn nhóm Telegram ở trên để thêm người");
  await expect(dialog.getByRole("checkbox", { name: "Thêm bình luận và gửi Telegram" })).not.toBeChecked(); // off on every open
});

test("guide: Chuẩn hoá mô tả, then Lưu vào mô tả (PO)", async ({ page }) => {
  await tour(page, "yt-luu-vao-mo-ta", "youtrack");
  await page.goto("/youtrack/");
  await walk(page, [{ at: page.getByRole("button", { name: /^Ticket/ }).or(page.getByRole("link", { name: /^Ticket/ })).first() },
    { at: page.locator("tbody tr[data-id]").first() }, { at: btn(page, /AI cho ticket này/, false) }, { at: btn(page, "Chuẩn hoá mô tả") }, null,
    { at: btn(page, "Lưu vào mô tả") }, null, { at: btn(page, "Lưu") }]);
});

test("guide: Hỏi bạn trong bình luận lights the home, a row and the comment box", async ({ page }) => {
  await tour(page, "yt-hoi-ban-trong-binh-luan", "youtrack");
  await page.goto("/youtrack/");
  const rows = page.getByRole("list", { name: "Hỏi bạn trong bình luận" });
  await walk(page, [{ at: page.getByRole("button", { name: /^Tổng quan/ }).or(page.getByRole("link", { name: /^Tổng quan/ })).first() },
    { at: rows.getByRole("button").first() }, { at: page.getByLabel("Bình luận mới"), fill: "Không hoàn tiền nhé" }]);
});

test("guide: Q&A conclusion into the story (PO)", async ({ page }) => {
  const q = msg("1", "Hủy giữa kỳ có hoàn tiền không? VA-1\n#QA11", "binh", null, 7e6);
  const a = msg("2", "Không hoàn tiền", "me", "1", 6e6);
  await page.route(/\/api\/qa\?/, (r) => r.fulfill({ json: { items: [{ code: "#QA11", chat_title: "Nhóm A", question: q, answers: [a], done: false, holding: [], accepted: "2" }], truncated: false } }));
  await page.route("**/api/qa/summary", (r) => r.fulfill({ contentType: "application/x-ndjson",
    body: `${JSON.stringify({ done: { text: "**Kết luận:** hủy giữa kỳ không hoàn tiền (VA-1)." } })}\n` }));
  await tour(page, "qa-ket-luan-story", "telegram", 1); // step 1 (Q&A, pick the group) is the deep link
  await page.goto(`/?qa=${CHAT}`);
  await walk(page, [{ at: page.locator("button[data-qa]").first() }, { at: page.getByRole("button", { name: "AI tóm tắt kết luận" }) }, null,
    { at: btn(page, "Cập nhật story") }, ...storySteps(page)], 1);
});
