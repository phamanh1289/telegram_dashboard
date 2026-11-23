import { expect, type Page, test } from "@playwright/test";

// Tài liệu over the real library: fixture_server.py `/docs` writes .md files into a temp folder source and syncs.
// Telegram hits are the fixture's stored tags ("Tin A số 111".."Tin A số 120" in "Nhóm Dự án").
const CONTROL = `http://127.0.0.1:${process.env.E2E_CONTROL ?? "8799"}`;

async function ctl(path: string, body: object) {
  const res = await fetch(`${CONTROL}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return res.json();
}

// the passage sought sits last in a long document, so opening it must scroll the reader to it
const filler = Array.from({ length: 30 }, (_, i) => `## Mục ${i + 1}\n\nNội dung mục ${i + 1} của quy trình, chưa nói tới khoản tiền.\n`).join("\n");
const FILES: Record<string, string> = {
  "quy-trinh.md": `# Quy trình vay\n\n${filler}\n## Điều kiện giải ngân\n\nKhoản vay chỉ được giải ngân khi hồ sơ đủ chữ ký, xem VA-12.\n`,
  // one long part (a big table): the word sought sits in its last row, far below the part's top
  "bang-phi.md": `# Biểu phí\n\n## Bảng phí\n\n| Mã | Phí |\n| --- | --- |\n${Array.from({ length: 80 }, (_, i) => `| P${i + 1} | phí thường ${i + 1} |`).join("\n")}\n| P81 | phí trễ hạn |\n\n${filler}`,
  // names Knowledge Base articles: VA-A-3 is read in by the branch test, VA-A-4 stays outside the library
  "lien-ket.md": "# Liên kết\n\nXem VA-A-3 và `VA-A-4` trước khi làm.\n",
  // Zeplin screen names: code spans with a digit on a line that says Zeplin (a range links both ends)
  "man-zeplin.md": "# Màn\n\nZeplin Web `Banv2-00 → 19`, kèm `id` nháp.\n\nDòng khác `Banv2-01` không nói thiết kế.\n",
  // a YouTrack table: <br> breaks the line inside a cell
  "bang-br.md": "# Ước lượng\n\n| Ticket | Ghi chú |\n| --- | --- |\n| VA-1 | CLOSED<br>24h<br/>xong |\n",
  // enough documents for the list to scroll
  ...Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`ghi-chu-${String(i + 1).padStart(2, "0")}.md`, `# Ghi chú ${i + 1}\n\nGhi chú số ${i + 1}.\n`])),
};

const results = (page: Page) => page.locator('section[aria-label="Kết quả"]');
const search = (page: Page) => page.getByRole("searchbox", { name: "Tìm trong tài liệu" });

async function open(page: Page, url = "/docs/") {
  await page.goto(url);
  await expect(results(page).locator("li button").first()).toBeVisible(); // a document row, not only the view toggle
}

test.beforeAll(async () => {
  await ctl("/docs", { files: FILES });
});

test("tìm không dấu ra đoạn có dấu và tô từ khớp", async ({ page }) => {
  await open(page);
  await search(page).fill("giai ngan");
  const hit = results(page).getByRole("button", { name: /Khoản vay chỉ được giải ngân/ });
  await expect(hit).toBeVisible();
  await expect(hit.locator("mark").first()).toHaveText(/^giải/);
  await expect(results(page).getByRole("heading", { name: "quy-trinh.md" })).toBeVisible(); // a file is named by its file name
});

test("mở đoạn khớp: chữ tìm nằm giữa khung đọc, kể cả cuối một đoạn dài", async ({ page }) => {
  await open(page, "/docs/?q=phi%20tre%20han");
  // the hit's snippet is the part's start (the table head): the words sought are 80 rows below it
  await results(page).getByRole("heading", { name: /^bang-phi\.md/ }).locator("xpath=following-sibling::ul[1]//button").first().click();
  await expect(page.locator("article header h1")).toHaveText("bang-phi.md");
  const off = () => page.evaluate(() => {
    const box = document.querySelector("article [data-doc-text]")!.parentElement!.parentElement!;
    const cell = [...box.querySelectorAll("td")].find((td) => td.textContent === "phí trễ hạn");
    if (!cell) return 9999;
    const a = cell.getBoundingClientRect(), b = box.getBoundingClientRect();
    return Math.abs(a.top + a.height / 2 - (b.top + b.height / 2));
  });
  await expect.poll(off).toBeLessThan(40);
});

test("xóa chữ tìm: danh sách tài liệu hiện lại rõ, không còn mờ", async ({ page }) => {
  await open(page);
  await search(page).fill("giai ngan");
  await expect(results(page).getByRole("button", { name: /Khoản vay chỉ được giải ngân/ })).toBeVisible();
  await search(page).fill("");
  await expect(results(page).getByRole("list", { name: "Cây tài liệu" })).toBeVisible();
  await expect(results(page).locator(".overflow-y-auto")).toHaveCSS("opacity", "1");
});

test("bấm kết quả mở reader ở đúng đoạn", async ({ page }) => {
  await open(page, "/docs/?q=giai%20ngan");
  await results(page).getByRole("button", { name: /Khoản vay chỉ được giải ngân/ }).click();
  await expect(page).toHaveURL(/[?&]doc=\d+&part=\d+/);
  const part = new URL(page.url()).searchParams.get("part");
  const section = page.locator(`article [data-part="${part}"]`);
  await expect(section).toContainText("hồ sơ đủ chữ ký");
  await expect(section).toBeInViewport();
  await expect(page.locator("article header h1")).toHaveText("quy-trinh.md");
  // a ticket ID in the text opens the YouTrack tab's ticket page over this one
  await section.getByRole("link", { name: "VA-12", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Ticket VA-12" })).toBeVisible();
  await expect(page).toHaveURL(/\/docs\//); // still here
});

test("ô prompt ghi số đoạn và số ký tự, tắt khi không có đoạn khớp", async ({ page }) => {
  await open(page);
  const box = page.getByRole("textbox", { name: "Hỏi AI trên tài liệu" });
  const ask = page.getByRole("button", { name: "Hỏi", exact: true });
  await search(page).fill("giai ngan");
  await page.getByRole("button", { name: "Mở panel hỏi AI" }).click(); // from the empty reader
  await expect(page.getByText(/^Hỏi trên \d+ đoạn đang hiện \(~[\d.,]+ ký tự\)$/)).toBeVisible();
  await box.fill("Khi nào được giải ngân?");
  await expect(ask).toBeEnabled();
  await search(page).fill("khongcotunaokhop");
  await expect(page.getByText("Chưa có đoạn nào khớp", { exact: true })).toBeVisible();
  await expect(ask).toBeDisabled();
});

test("lỗi đồng bộ hiện dải báo, danh sách cũ vẫn còn", async ({ page }) => {
  await ctl("/docs", { extra: true });
  const { errors } = await ctl("/docs", { extra: "gone" }); // the folder went away after its doc was synced
  expect(errors.map((e: { code: string }) => e.code)).toContain("folder_missing");
  try {
    await open(page);
    await expect(page.getByRole("alert").filter({ hasText: "Đồng bộ chưa trọn" })).toBeVisible();
    await expect(results(page).getByRole("button", { name: /^so-tay\.md/ })).toBeVisible();
    // the sources trigger (Thêm) is named "Thêm nguồn" with the error count, so the guide and screen readers find it
    await expect(page.getByRole("button", { name: "Thêm nguồn (1 lỗi đồng bộ)" })).toBeVisible();
  } finally {
    await ctl("/docs", {});
  }
});

test("tin Telegram mở đúng deep link", async ({ page }) => {
  await open(page);
  await search(page).fill("tin a so 115");
  const link = results(page).getByRole("link", { name: /Tin A số 115/ });
  await expect(link).toHaveAttribute("href", "/?chat=-1001&msg=115");
  await expect(link.locator("mark").first()).toBeVisible();
  await link.click();
  // the inbox opens that tag in its reply panel
  await expect(page.getByRole("article", { name: "Tin được tag" })).toContainText("Tin A số 115");
  await expect(page.getByRole("form", { name: "Soạn trả lời" })).toContainText("Nhóm Dự án");
});

test("cảnh chờ nằm giữa khung kết quả khi danh sách đã cuộn", async ({ page }) => {
  await open(page);
  const scroller = results(page).locator(".overflow-y-auto");
  const scrolled = await scroller.evaluate((el) => { el.scrollTo(0, el.scrollHeight); return el.scrollTop; });
  expect(scrolled).toBeGreaterThan(0);
  // hold the next list so its waiting scene stays up while measured (only the timing is faked)
  await page.route((u) => u.pathname === "/api/docs" && u.searchParams.get("source") === "file",
    async (r) => { await new Promise((ok) => setTimeout(ok, 2000)); await r.continue(); });
  await page.getByRole("group", { name: "Lọc theo nguồn" }).getByText("Khác", { exact: true }).click();
  const cover = results(page).locator(":scope > .absolute");
  await expect(cover).toBeVisible();
  const area = (await results(page).boundingBox())!;
  const scene = (await cover.locator(":scope > div").boundingBox())!;
  const dx = scene.x + scene.width / 2 - (area.x + area.width / 2);
  const dy = scene.y + scene.height / 2 - (area.y + area.height / 2);
  expect(Math.abs(dx)).toBeLessThanOrEqual(2);
  expect(Math.abs(dy)).toBeLessThanOrEqual(2);
});

test("bài KB ngoài nguồn: ẩn khỏi danh sách, Xem lọc ra, Xóa xóa riêng", async ({ page }) => {
  await ctl("/docs", { kb_cache: true });
  await open(page);
  const cached = results(page).getByText("Bài ngoài nguồn");
  await expect(cached).toHaveCount(0); // hidden from the list
  await page.getByRole("button", { name: "Thêm nguồn", exact: true }).click();
  await expect(page.getByText(/^1 bài AI Agent đã mở/)).toBeVisible();
  await page.getByRole("button", { name: "Xem", exact: true }).click();
  await expect(page).toHaveURL(/[?&]source=kb_cache/);
  await expect(cached).toBeVisible();
  await expect(page.getByRole("button", { name: "Bỏ lọc bài KB ngoài nguồn" })).toBeVisible();
  await page.getByRole("button", { name: "Thêm nguồn", exact: true }).click();
  await page.getByRole("button", { name: "Xóa", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Xóa", exact: true }).click();
  await expect(results(page).getByText("Không có bài KB ngoài nguồn")).toBeVisible();
  await page.getByRole("button", { name: "Bỏ lọc bài KB ngoài nguồn" }).click();
  await expect(results(page).getByText("quy-trinh.md").first()).toBeVisible(); // the files stay
});

test("Nguồn: chọn một nhánh bài KB thì chỉ đọc bài đó và các bài dưới nó", async ({ page }) => {
  await ctl("/docs", { kb: true });
  await open(page);
  await page.getByRole("button", { name: "Thêm nguồn", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nguồn tài liệu" });
  await dialog.getByRole("button", { name: "Chọn nhánh" }).click();
  await dialog.getByRole("checkbox", { name: /Bán V2 · Bàn giao/ }).click();
  await dialog.getByRole("button", { name: "Mở nhánh Bán V2 · Bàn giao" }).click();
  await expect(dialog.getByRole("checkbox", { name: /FE \/ Mobile/ })).toBeChecked(); // under a ticked one: implied
  await expect(dialog.getByText("1 nhánh")).toBeVisible();
  await page.keyboard.press("Escape"); // closing syncs once
  // the list's tree: the article under its parent, opened branch by branch
  await results(page).getByRole("button", { name: "Mở nhánh Bán V2 · Bàn giao" }).click();
  await results(page).getByRole("button", { name: "Mở nhánh FE / Mobile" }).click();
  await expect(results(page).getByText("Đợt 1a — Khảo sát")).toBeVisible();
  await expect(results(page).getByText("Bán V2 · Bàn giao")).toBeVisible();
  await expect(results(page).getByText("Sprint tuần 3")).toHaveCount(0); // outside the branch: not read
  // an article ID in a document opens that article
  await results(page).getByRole("button", { name: /^lien-ket\.md/ }).click();
  await page.locator("article [data-doc-text]").getByRole("button", { name: "VA-A-3" }).click(); // the text, not its foot
  await expect(page.locator("article header h1")).toContainText("Đợt 1a — Khảo sát"); // after the YouTrack logo
  // one it does not hold asks first: yes adds it (a branch) and opens it here
  await results(page).getByRole("button", { name: /^lien-ket\.md/ }).click();
  await page.locator("article [data-doc-text]").getByRole("button", { name: "VA-A-4" }).click(); // the text, not its foot
  const ask = page.getByRole("alertdialog", { name: "Chưa có VA-A-4 trong Tài liệu" });
  await ask.getByRole("button", { name: "Thêm và mở" }).click();
  await expect(ask).toBeHidden();
  await expect(page.locator("article header h1")).toContainText("Sprint tuần 3");
});

test("cây KB như YouTrack: tên project, thứ tự YouTrack, nhánh rời gom dưới bài cha; cuối bài là mục được nhắc", async ({ page }) => {
  await ctl("/docs", { kb: true, kb_articles: ["VA-A-3", "VA-A-4"] }); // VA-A-3's parents stay out of the library
  await open(page);
  const tree = results(page).getByRole("list", { name: "Cây tài liệu" });
  await expect(tree.getByText("Bán V2", { exact: true })).toBeVisible(); // the project's name, not "VA"
  // VA-A-3 under its parents read from the project's tree (grey, not openable), after VA-A-4 as YouTrack orders them
  await tree.getByRole("button", { name: "Mở nhánh Bán V2 · Bàn giao" }).click();
  await tree.getByRole("button", { name: "Mở nhánh FE / Mobile" }).click();
  const rows = tree.locator("li li > div");
  await expect(rows.first()).toContainText("Sprint tuần 3");
  await expect(rows.nth(1)).toContainText("Bán V2 · Bàn giao");
  await tree.getByRole("button", { name: /Đợt 1a — Khảo sát/ }).click();
  // the foot: what it names (a ticket, an article) and what names it on YouTrack
  const foot = page.locator("article").getByRole("region", { name: "Mục được nhắc" });
  await foot.scrollIntoViewIfNeeded();
  await expect(foot.getByRole("button", { name: /Được nhắc ở đây 2\s+Nhắc tới bài này 2/ })).toBeVisible();
  await expect(foot.getByText("Điều kiện giải ngân")).toBeVisible();
  await expect(foot.getByText("Màn khảo sát V2")).toBeVisible();
  await foot.getByRole("button", { name: "VA-A-4" }).first().click(); // in the library: opens here
  await expect(page.locator("article header h1")).toContainText("Sprint tuần 3");
});

test("tìm trong tài liệu đang mở: đếm đoạn khớp, Enter nhảy tới đoạn sau", async ({ page }) => {
  await open(page);
  await results(page).getByRole("button", { name: /^quy-trinh\.md/ }).click();
  await expect(page.locator("article header h1")).toHaveText("quy-trinh.md");
  await page.keyboard.press("ControlOrMeta+f"); // the page's own find would miss the parts not rendered yet
  const find = page.getByRole("searchbox", { name: "Tìm trong tài liệu này" });
  await expect(find).toBeFocused();
  await find.fill("khoan tien");
  await expect(page.getByRole("status").filter({ hasText: /^1\/\d+ đoạn$/ })).toBeVisible();
  const first = new URL(page.url()).searchParams.get("part");
  await find.press("Enter");
  await expect.poll(() => new URL(page.url()).searchParams.get("part")).not.toBe(first);
  await find.press("Escape"); // clears it; the box folds back to the magnifier
  await expect(find).toHaveValue("");
});

test("popup hỏi AI mở từ chip AI của tài liệu, Esc đóng popup rồi đóng tài liệu", async ({ page }) => {
  await open(page);
  await results(page).getByRole("button", { name: /^quy-trinh\.md/ }).click();
  await expect(page.locator("article header h1")).toHaveText("quy-trinh.md");
  await page.getByRole("button", { name: "Hỏi AI về tài liệu này" }).click();
  const panel = page.getByRole("complementary", { name: "Hỏi AI" });
  const box = panel.getByRole("textbox", { name: "Hỏi AI trên tài liệu" });
  await expect(box).toBeFocused();
  await expect(panel.getByText(/^AI đọc cả tài liệu này/)).toBeVisible(); // the whole document, said before the run
  await expect(panel.getByRole("heading")).toContainText("quy-trinh.md"); // asks over the open document, no scope switch
  await box.press("Escape");
  await expect(panel).toBeHidden();
  await page.keyboard.press("Escape"); // the next Esc closes the document
  await expect(page.locator("article header h1")).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get("doc")).toBeNull();
});

test("lịch sử hỏi AI: câu đã hỏi trên cùng bản tài liệu hiện lại không chạy AI, Lịch sử nạp lại phiên", async ({ page }) => {
  await open(page);
  await results(page).getByRole("button", { name: /^quy-trinh\.md/ }).click();
  await page.getByRole("button", { name: "Hỏi AI về tài liệu này" }).click();
  const panel = page.getByRole("complementary", { name: "Hỏi AI" });
  const box = panel.getByRole("textbox", { name: "Hỏi AI trên tài liệu" });
  await box.fill("Hồ sơ cần những gì?");
  await box.press("Enter");
  await expect(panel.getByText("Bản nháp AI: cảm ơn mọi người!")).toBeVisible();
  await panel.getByRole("button", { name: "Phiên hỏi mới" }).click();
  await box.fill("ho so can nhung gi"); // accents, case and the end mark aside: the same question
  await box.press("Enter");
  await expect(panel.getByText(/^Câu trả lời đã lưu/)).toBeVisible();
  await expect(panel.getByRole("button", { name: "Hỏi lại AI" })).toBeVisible();
  await panel.getByRole("button", { name: "Lịch sử hỏi AI" }).click();
  await panel.getByRole("button", { name: /^Hồ sơ cần những gì\?/ }).click(); // the first conversation, read back
  await expect(panel.getByText("Hồ sơ cần những gì?")).toBeVisible();
  await expect(panel.getByText("Bản nháp AI: cảm ơn mọi người!")).toBeVisible();
  await expect(panel.getByText(/^Câu trả lời đã lưu/)).toHaveCount(0);
});

test("danh sách: cây theo thư mục hoặc mới nhất trước", async ({ page }) => {
  await open(page);
  await expect(results(page).getByRole("list", { name: "Cây tài liệu" })).toBeVisible();
  await page.getByRole("button", { name: "Mới nhất", exact: true }).click();
  await expect(results(page).getByRole("list", { name: "Cây tài liệu" })).toHaveCount(0);
  await expect(results(page).getByRole("button", { name: /^quy-trinh\.md/ })).toBeVisible();
  await page.reload(); // the pick is kept
  await expect(page.getByRole("button", { name: "Mới nhất", pressed: true })).toBeVisible();
  await page.getByRole("button", { name: "Theo thư mục", exact: true }).click();
});

test("Yêu thích: bấm sao trên tài liệu thì nó nằm ở tab Yêu thích, giữ sau khi tải lại", async ({ page }) => {
  await open(page);
  await results(page).getByRole("button", { name: /^quy-trinh\.md/ }).click();
  const star = page.locator("article header").getByRole("button", { name: "Đánh dấu yêu thích" });
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "true");
  await results(page).getByRole("button", { name: "Yêu thích", exact: true }).click();
  await expect(results(page).getByRole("button", { name: /^quy-trinh\.md/ })).toBeVisible();
  await expect(results(page).getByRole("button", { name: /^ghi-chu-01\.md/ })).toHaveCount(0); // not starred
  await page.reload();
  await expect(results(page).getByRole("button", { name: /^quy-trinh\.md/ })).toBeVisible();
  await page.locator("article header").getByRole("button", { name: "Đánh dấu yêu thích" }).click(); // unstar: the tab empties
  await expect(results(page).getByText("Chưa có tài liệu yêu thích")).toBeVisible();
  await results(page).getByRole("button", { name: "Theo thư mục", exact: true }).click();
});

test("tên màn Zeplin trong tài liệu: bấm mở trang Zeplin trượt từ phải, Esc đóng mà tài liệu vẫn mở", async ({ page }) => {
  await open(page);
  await results(page).getByRole("button", { name: /^man-zeplin\.md/ }).click();
  const doc = page.locator("article");
  await expect(doc.getByRole("button", { name: "19", exact: true })).toBeVisible(); // the range's end, read as Banv2-19
  await expect(doc.getByRole("button", { name: "id", exact: true })).toHaveCount(0); // no digit: not a screen
  await expect(doc.getByRole("button", { name: "Banv2-01" })).toHaveCount(0); // its line does not say Zeplin
  await doc.getByRole("button", { name: "Banv2-00", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Banv2-00" });
  await expect(sheet.getByText("Bán Web · web")).toBeVisible();
  await expect(sheet.getByRole("link", { name: "Mở trên Zeplin" })).toHaveAttribute("href", "https://app.zeplin.io/project/p1/screen/s1");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(page.locator("article header h1")).toHaveText("man-zeplin.md"); // Esc closed the page, not the document
  await doc.getByRole("button", { name: "19", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Banv2-19" }).getByText("Không thấy màn Zeplin tên này")).toBeVisible();
});

test("<br> trong ô bảng là xuống dòng, không hiện chữ <br>", async ({ page }) => {
  await open(page);
  await results(page).getByRole("button", { name: /^bang-br\.md/ }).click();
  const cell = page.locator("article td").filter({ hasText: "CLOSED" });
  await expect(cell.locator("br")).toHaveCount(2);
  await expect(page.locator("article")).not.toContainText("<br");
});

test("rê lên ngày cập nhật hiện các dòng đã đổi ở lần cập nhật đó", async ({ page }) => {
  const doc = FILES["quy-trinh.md"];
  await ctl("/docs", { files: { "quy-trinh.md": doc.replace("đủ chữ ký,", "đủ chữ ký và CCCD,") } });
  try {
    await open(page);
    await search(page).fill("giai ngan");
    await results(page).getByRole("button", { name: /Khoản vay chỉ được giải ngân/ }).click();
    await page.getByRole("button", { name: /^cập nhật/ }).hover();
    const card = page.getByRole("tooltip");
    await expect(card).toContainText("Điều kiện giải ngân"); // the section it changed in
    // the old line and its edit read as one row, only the changed words marked (DiffRows)
    await expect(card.getByRole("button", { name: "Khoản vay chỉ được giải ngân khi hồ sơ đủ chữ ký và CCCD, xem VA-12." })).toBeVisible();
    await expect(card.getByRole("insertion")).toHaveText("và CCCD");
  } finally {
    await ctl("/docs", { files: { "quy-trinh.md": doc } });
  }
});

test("Dùng tài liệu: đính kèm file vào phiên AI thì ô nhắn của phiên có sẵn dòng #DOC", async ({ page }) => {
  await open(page);
  await search(page).fill("giai ngan");
  await results(page).getByRole("button", { name: /Khoản vay chỉ được giải ngân/ }).click();
  await page.getByRole("button", { name: "Dùng tài liệu" }).click();
  // a file on this machine has no link for the team: no Q&A / copy, only the session
  await expect(page.getByText("File trên máy không có link cho team mở")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Hỏi trong Q&A nhóm" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Đính kèm vào phiên AI" }).click();
  await page.getByRole("menuitem", { name: /Phiên plan e2e/ }).click();
  await expect(page.getByLabel("Nhắn tiếp cho AI")).toHaveValue(/^Đọc tài liệu #DOC\d+ \(quy-trinh\.md\)$/);
});

test("Dùng tài liệu: bài KB hỏi trong Q&A nhóm thì ô câu hỏi có sẵn tên và link bài", async ({ page }) => {
  // a KB article (one the AI Agent opened): with YouTrack's address it has a link for the team
  await ctl("/docs", { kb_cache: true, yt_base: "https://youtrack.example.test" });
  try {
    await open(page, "/docs/?source=kb_cache");
    await results(page).getByText("Bài ngoài nguồn").first().click();
    await page.getByRole("button", { name: "Dùng tài liệu" }).click();
    await page.getByRole("menuitem", { name: "Hỏi trong Q&A nhóm" }).click();
    await page.getByRole("menuitem", { name: "Nhóm Dự án" }).click();
    await expect(page.getByLabel("Câu hỏi mới")).toHaveValue(/^Bài ngoài nguồn\nhttps:\/\/youtrack\.example\.test\/articles\/XO-A-1\n/);
  } finally {
    await ctl("/docs", { yt_base: "" });
  }
});
