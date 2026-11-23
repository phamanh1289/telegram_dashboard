import { expect, type Page, test } from "@playwright/test";

// Chờ bổ sung, "đã xử lý" and Cập nhật story end to end: the follow-ups and ticks go to the fixture backend for real
// (data/), the Briefing digest, YouTrack and the AI are faked per test (page.route).

const CHAT = "-1001";
const ask = { text: "Hoàn tiền khi hủy gói giữa kỳ?", who: "PO", why: "Dev hỏi", message_ids: ["1"], tickets: ["VA-1"], due: "", be: false, topic: "" };
const todo = { text: "Tích hợp API hoàn tiền", who: "Dev", why: "", message_ids: ["7"], tickets: [], due: "", be: true, topic: "" };
const KEY = `${CHAT}:confirmations:1`;

async function setup(page: Page, origin: string, role: "po" | "dev", yt = false) {
  // a clean slate on the fixture server: no waits, no story marks, nothing ticked (writes need the app's Origin)
  const headers = { origin: new URL(origin).origin };
  const had: { waits: { key: string }[] } = await (await page.request.get("/api/briefing/follow")).json();
  expect((await page.request.post("/api/briefing/follow", { data: { drop: had.waits.map((w) => w.key) }, headers })).ok()).toBe(true);
  expect((await page.request.post("/api/briefing/done", { data: { keys: [KEY, `${CHAT}:actions:7`], on: false }, headers })).ok()).toBe(true);
  await page.addInitScript((r) => localStorage.setItem("ytMode", r), role);
  const digest = { topics: [], impacts: [], changes: [], decisions: [], confirmations: [ask], actions: [todo] };
  await page.route("**/api/briefing", (r) => r.fulfill({ json: [{ chat_id: CHAT, title: "Nhóm A", consent: true, latest_id: "10",
    saved: { created_at: new Date().toISOString(), last_message_id: "10", result: digest } }] }));
  await page.route(/\/api\/briefing\/(answered|be-replies)$/, (r) => r.fulfill({ json: {} }));
  await page.route("**/api/briefing/follow/replies", (r) => r.fulfill({ json: { replies: {}, failed: [] } }));
  if (!yt) return;
  await page.route("**/api/status", async (r) => r.fulfill({ json: { ...(await (await r.fetch()).json()), youtrack_configured: true } }));
  await page.route("**/api/yt/projects", (r) => r.fulfill({ json: [{ shortName: "VA", name: "VA" }] }));
  await page.route("**/api/yt/me", (r) => r.fulfill({ json: { login: "anh", name: "Anh" } }));
  await page.route(/\/api\/yt\/issue\?id=VA-1/, (r) => r.fulfill({ json: { id: "VA-1", summary: "Gia hạn gói", description: "**Mục tiêu**\nGia hạn gói.",
    comments: [], attachments: [], links: [], sprints: [], assignee: "Bình", assigneeLogin: "binh", qc: null, state: "Open" } }));
  await page.route(/\/api\/yt\/people\?/, (r) => r.fulfill({ json: [{ login: "anh", name: "Anh" }, { login: "binh", name: "Bình" }] }));
}

const follow = async (page: Page) => (await page.request.get("/api/briefing/follow")).json();
const done = async (page: Page) => (await page.request.get("/api/briefing/done")).json() as Promise<string[]>;

test("PO: Chờ BU parks the item on the server, survives a reload, Bỏ chờ puts it back", async ({ page, baseURL }) => {
  await setup(page, baseURL!, "po");
  await page.goto(`/?brief=${CHAT}`);
  await page.getByRole("button", { name: "Chờ…" }).first().click();
  await expect(page.getByRole("menuitem")).toHaveText(["Chờ design", "Chờ BU"]); // the PO's reasons
  await page.getByRole("menuitem", { name: "Chờ BU" }).click();
  const list = page.getByRole("list", { name: "Chờ bổ sung" });
  await expect(list).toContainText(ask.text);
  await expect.poll(async () => (await follow(page)).waits.map((w: { on: string }) => w.on)).toEqual(["bu"]);
  await expect.poll(() => done(page)).toContain(KEY); // left the open list, on every machine

  await page.reload(); // kept on the server, not in this page
  await page.getByRole("button", { name: /^Chờ bổ sung/ }).click();
  await list.getByRole("button", { name: "Bỏ chờ" }).click();
  await expect.poll(async () => (await follow(page)).waits).toEqual([]);
  await expect.poll(() => done(page)).not.toContain(KEY);
});

test("Dev: Chờ… offers BE / PO, and no Cập nhật story", async ({ page, baseURL }) => {
  await setup(page, baseURL!, "dev", true);
  await page.goto(`/?brief=${CHAT}`);
  await page.getByRole("button", { name: /^Việc cần làm/ }).click();
  await expect(page.getByRole("button", { name: "Chờ…" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cập nhật story" })).toHaveCount(0); // a PO tool
  await page.getByRole("button", { name: "Chờ…" }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["Chờ BE", "Chờ PO"]);
});

test("PO: Cập nhật story shows the change, refuses to overwrite a newer description, then saves and marks the item", async ({ page, baseURL }) => {
  await setup(page, baseURL!, "po", true);
  const amended = "**Mục tiêu**\nGia hạn gói.\n\n**Tiêu chí nghiệm thu**\n- [ ] Hủy giữa kỳ: không hoàn tiền";
  await page.route("**/api/yt/ai/ticket", (r) => r.fulfill({ contentType: "application/x-ndjson",
    body: `${JSON.stringify({ done: { text: amended, draft: "VA-1 cập nhật story", base: "**Mục tiêu**\nGia hạn gói." } })}\n` }));
  const saves: { base?: string }[] = [];
  await page.route("**/api/yt/issue/description", (r) => {
    saves.push(r.request().postDataJSON());
    return saves.length === 1
      ? r.fulfill({ status: 409, json: { error: "Mô tả trên YouTrack vừa đổi sau khi bạn mở bản này: Soạn lại (hoặc lấy bản mới để tự sửa)" } })
      : r.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/yt/issue/comment", (r) => r.fulfill({ json: { ok: true } }));
  await page.goto(`/?brief=${CHAT}`);
  await page.getByRole("button", { name: "Cập nhật story" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "AI soạn giúp" }).click(); // AI is a chip away: its prompt opens on the item as the change
  await dialog.getByRole("button", { name: "Soạn", exact: true }).click();
  await expect(dialog.getByLabel("So sánh", { exact: true })).toContainText("Hủy giữa kỳ: không hoàn tiền"); // the diff view
  await dialog.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("vừa đổi"); // not overwritten
  expect(saves[0].base).toBe("**Mục tiêu**\nGia hạn gói."); // saved only over the text the AI was given (sent back with its answer)
  await dialog.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(dialog.getByText("Đã lưu lên YouTrack")).toBeVisible(); // saved; the dialog stays for the comment / Telegram
  await expect.poll(async () => (await follow(page)).storied[KEY]?.id).toBe("VA-1"); // its own mark (other specs share the server)
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Cần confirm/ }).click(); // the page moved on to a tab with work left
  await page.getByRole("button", { name: /^Đã xử lý/ }).click(); // saved into the story: ticked done too
  await expect(page.getByText("Đã vào story VA-1").first()).toBeVisible();
});

test("PO: Cập nhật story opens the description to edit by hand, no AI run; the comment is sent on its own, tagged the YouTrack way", async ({ page, baseURL }) => {
  await setup(page, baseURL!, "po", true);
  let ai = 0;
  await page.route("**/api/yt/ai/ticket", (r) => { ai++; return r.abort(); });
  const saves: { text: string; base?: string }[] = [];
  await page.route("**/api/yt/issue/description", (r) => { saves.push(r.request().postDataJSON()); return r.fulfill({ json: { ok: true } }); });
  const comments: { text: string }[] = [];
  await page.route("**/api/yt/issue/comment", (r) => { comments.push(r.request().postDataJSON()); return r.fulfill({ json: { ok: true } }); });
  await page.goto(`/?brief=${CHAT}`);
  // the story spec above may have saved this item already (the server is shared): its button then reads "Đã vào story"
  await page.getByRole("button", { name: /^(Cập nhật story|Đã vào story VA-1)$/ }).first().click();
  const dialog = page.getByRole("dialog");
  const box = dialog.getByRole("textbox", { name: "Mô tả", exact: true });
  await expect(box).toHaveValue("**Mục tiêu**\nGia hạn gói."); // the description as YouTrack has it
  // the comment box: a ready line, the Assignee tagged by login; sent by its own button, before (and without) Lưu
  const note = dialog.getByRole("textbox", { name: "Bình luận trên YouTrack" });
  await expect(note).toHaveValue(/^@binh Đã cập nhật story VA-1/);
  await dialog.getByRole("button", { name: "Gửi bình luận" }).click();
  await expect(dialog.getByRole("button", { name: "Đã gửi bình luận" })).toBeVisible();
  expect(comments[0].text).toMatch(/^@binh Đã cập nhật story VA-1/);
  expect(saves).toEqual([]); // the description was not touched
  await box.fill("**Mục tiêu**\nGia hạn gói.\n\n- [ ] Hủy giữa kỳ: không hoàn tiền");
  await dialog.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(dialog.getByText("Đã lưu lên YouTrack")).toBeVisible();
  expect(saves).toEqual([{ id: "VA-1", text: "**Mục tiêu**\nGia hạn gói.\n\n- [ ] Hủy giữa kỳ: không hoàn tiền", base: "**Mục tiêu**\nGia hạn gói." }]);
  expect(comments).toHaveLength(1); // Lưu sends no comment
  expect(ai).toBe(0);
});

test("PO: the Telegram box tags the group's own members (@ and a quick group) and sends on its own", async ({ page, baseURL }) => {
  await setup(page, baseURL!, "po", true);
  const saves: unknown[] = [], comments: unknown[] = [];
  await page.route("**/api/yt/issue/description", (r) => { saves.push(r.request().postDataJSON()); return r.fulfill({ json: { ok: true } }); });
  await page.route("**/api/yt/issue/comment", (r) => { comments.push(r.request().postDataJSON()); return r.fulfill({ json: { ok: true } }); });
  // Telegram names people its own way: the Assignee "Bình" is @binh_tg there, Cường has no username (tagged by name)
  await page.route(`**/api/chats/${CHAT}/members`, (r) => r.fulfill({ json: [{ user_id: "11", name: "Trần Bình", username: "binh_tg" }, { user_id: "12", name: "Cường", username: null }] }));
  const sent: { chat_id: string; reply_to_message_id: string; text: string; request_id: string }[] = [];
  await page.route("**/api/messages/reply", (r) => {
    const b = r.request().postDataJSON();
    sent.push(b);
    return r.fulfill({ json: { request_id: b.request_id, chat_id: b.chat_id, reply_to_message_id: b.reply_to_message_id, status: "sent", message_id: "99" } });
  });
  await page.goto(`/?brief=${CHAT}`);
  await page.getByRole("button", { name: /^(Cập nhật story|Đã vào story VA-1)$/ }).first().click();
  const dialog = page.getByRole("dialog");
  const tg = dialog.getByRole("region", { name: "Tin nhắn Telegram" });
  const box = tg.getByRole("textbox", { name: "Tin nhắn Telegram" });
  await expect(box).toHaveValue(/^@binh_tg Đã cập nhật story VA-1/); // the ready line: the Assignee as the group names them
  // typed freely; "@" lists this group's members
  await box.fill("VA-1 đã cập nhật ");
  await box.pressSequentially("@Cư");
  await page.getByRole("option", { name: /Cường/ }).click();
  await expect(box).toHaveValue("VA-1 đã cập nhật @Cường ");
  // a quick group: put Bình in "BE", then one click tags the group
  await tg.getByRole("button", { name: "Sửa nhóm tag nhanh" }).click();
  await tg.getByRole("group", { name: "Người trong nhóm BE" }).getByRole("button", { name: "Thêm người" }).click();
  await page.getByRole("option", { name: /Trần Bình/ }).click();
  await tg.getByRole("group", { name: "Tag nhanh theo nhóm" }).getByRole("button", { name: /^BE/ }).click();
  await expect(box).toHaveValue("@binh_tg VA-1 đã cập nhật @Cường ");
  // Xem trước: a tab of the description box (rendered as YouTrack will show it); the message boxes stay as written
  await dialog.getByRole("button", { name: "Xem trước", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Mô tả", exact: true })).toHaveCount(0);
  await expect(dialog.locator("strong", { hasText: "Mục tiêu" })).toBeVisible(); // the description, rendered
  await expect(box).toHaveValue("@binh_tg VA-1 đã cập nhật @Cường ");
  await dialog.getByRole("button", { name: "Viết", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Mô tả", exact: true })).toBeVisible();
  // its own send: straight to the group, a reply to the message that settled it; nothing else goes out
  await tg.getByRole("button", { name: "Gửi Telegram" }).click();
  await expect(tg.getByRole("button", { name: "Đã gửi vào nhóm" })).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ chat_id: CHAT, reply_to_message_id: "1", text: "@binh_tg VA-1 đã cập nhật [Cường](tg://user?id=12)" }); // a tag by name goes out as Telegram's mention
  expect(saves).toEqual([]);
  expect(comments).toEqual([]);
});

for (const role of ["dev", "po"] as const) {
  test(`Đã chốt (${role}): ${role === "po" ? "only Cập nhật story records the decision" : "\"ghi vào\" records it as a comment"}`, async ({ page, baseURL }) => {
    await setup(page, baseURL!, role, true);
    const decided = { ...ask, text: "Hủy giữa kỳ không hoàn tiền", message_ids: ["3"] };
    await page.route("**/api/briefing", (r) => r.fulfill({ json: [{ chat_id: CHAT, title: "Nhóm A", consent: true, latest_id: "10",
      saved: { created_at: new Date().toISOString(), last_message_id: "10", result: { topics: [], impacts: [], changes: [], decisions: [decided], confirmations: [], actions: [] } } }] }));
    await page.goto(`/?brief=${CHAT}`);
    await expect(page.getByText(decided.text)).toBeVisible();
    // one way per role: a PO's story update already leaves the comment
    await expect(page.getByRole("button", { name: "ghi vào VA-1" })).toHaveCount(role === "po" ? 0 : 1);
    await expect(page.getByRole("button", { name: "Cập nhật story" })).toHaveCount(role === "po" ? 1 : 0);
  });
}
