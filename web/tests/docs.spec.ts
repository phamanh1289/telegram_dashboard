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
  // enough documents for the list to scroll
  ...Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`ghi-chu-${String(i + 1).padStart(2, "0")}.md`, `# Ghi chú ${i + 1}\n\nGhi chú số ${i + 1}.\n`])),
};

const results = (page: Page) => page.locator('section[aria-label="Kết quả"]');
const search = (page: Page) => page.getByRole("searchbox", { name: "Tìm trong tài liệu" });

async function open(page: Page, url = "/docs/") {
  await page.goto(url);
  await expect(results(page).getByRole("button").first()).toBeVisible();
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

test("bấm kết quả mở reader ở đúng đoạn", async ({ page }) => {
  await open(page, "/docs/?q=giai%20ngan");
  await results(page).getByRole("button", { name: /Khoản vay chỉ được giải ngân/ }).click();
  await expect(page).toHaveURL(/[?&]doc=\d+&part=\d+/);
  const part = new URL(page.url()).searchParams.get("part");
  const section = page.locator(`article [data-part="${part}"]`);
  await expect(section).toContainText("hồ sơ đủ chữ ký");
  await expect(section).toBeInViewport();
  await expect(page.locator("article header h1")).toHaveText("quy-trinh.md");
});

test("ô prompt ghi số đoạn và số ký tự, tắt khi không có đoạn khớp", async ({ page }) => {
  await open(page);
  const box = page.getByRole("textbox", { name: "Hỏi AI trên tài liệu" });
  const ask = page.getByRole("button", { name: "Hỏi", exact: true });
  await search(page).fill("giai ngan");
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
    // the sources trigger is named "Nguồn" (with the error count), so the guide and screen readers find it
    await expect(page.getByRole("button", { name: "Nguồn (1 lỗi đồng bộ)" })).toBeVisible();
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
  await page.getByRole("group", { name: "Lọc theo nguồn" }).getByText("File", { exact: true }).click();
  const cover = results(page).locator(":scope > .absolute");
  await expect(cover).toBeVisible();
  const area = (await results(page).boundingBox())!;
  const scene = (await cover.locator(":scope > div").boundingBox())!;
  const dx = scene.x + scene.width / 2 - (area.x + area.width / 2);
  const dy = scene.y + scene.height / 2 - (area.y + area.height / 2);
  expect(Math.abs(dx)).toBeLessThanOrEqual(2);
  expect(Math.abs(dy)).toBeLessThanOrEqual(2);
});
