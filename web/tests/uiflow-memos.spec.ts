import { expect, test } from "@playwright/test";
import { open, box, edit, drag, flowOf } from "./uiflow.helpers";

// Notes on the map (memos.js): drawn as a box while editing, typed in, moved, folded; one undo step each.

test("+ Ghi chú arms drawing: crosshair and a hint; the box dragged is the note, Esc calls it off", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("button", { name: "+ Ghi chú" })).toBeHidden(); // an edit tool
  await edit(page);
  const tool = page.getByRole("button", { name: "+ Ghi chú" });
  await tool.click();
  await expect(tool).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".uf-note")).toContainText("Kéo trên sơ đồ để vẽ khung ghi chú");
  expect(await page.locator(".uf-pinpad").evaluate((e) => getComputedStyle(e).cursor)).toBe("crosshair");
  await page.keyboard.press("Escape"); // called off: nothing drawn, the hint goes
  await expect(tool).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".uf-pinpad")).toHaveCount(0);
  await expect(page.locator(".uf-note")).toBeHidden();

  await tool.click();
  const v = await box(page, ".uf-view"), k = await page.evaluate(() => {
    const m = /scale\(([\d.]+)\)/.exec(getComputedStyle(document.querySelector(".uf-layer")!).transform) ?? /matrix\(([\d.]+)/.exec(getComputedStyle(document.querySelector(".uf-layer")!).transform);
    return m ? +m[1] : 1;
  });
  const before = JSON.stringify((await flowOf(page)).screens);
  await page.mouse.move(v.x + 40, v.y + 600);
  await page.mouse.down();
  await page.mouse.move(v.x + 340, v.y + 700, { steps: 6 });
  await page.mouse.up();
  const memo = page.locator(".uf-pin");
  await expect(memo).toHaveCount(1);
  await expect(memo.getByRole("textbox", { name: "Ghi chú" })).toBeFocused(); // typed in at once
  const m = (await flowOf(page)).memos![0];
  expect(m.w).toBeCloseTo(300 / k, -1); // the box dragged, in map units
  expect(m.h).toBeCloseTo(100 / k, -1);
  expect(JSON.stringify((await flowOf(page)).screens)).toBe(before); // drawing never panned nor moved a screen
  await expect(tool).toHaveAttribute("aria-pressed", "false"); // one note per press
  await page.keyboard.press("ControlOrMeta+z"); // the text has the keys: leave it first
  await page.locator(".uf-view").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("ControlOrMeta+z");
  expect((await flowOf(page)).memos).toBeUndefined(); // one undo step takes the note away

  // a click without a drag: a note of the default size where it was pressed
  await tool.click();
  await page.mouse.click(v.x + 60, v.y + 620);
  expect((await flowOf(page)).memos![0]).toMatchObject({ w: 320, h: 160 });
});

test("a note: typed, moved, folded to its bar, deleted; read-only and folded for the view only outside editing", async ({ page }) => {
  await open(page);
  await edit(page);
  await page.getByRole("button", { name: "+ Ghi chú" }).click();
  const v = await box(page, ".uf-view");
  await page.mouse.click(v.x + 60, v.y + 600);
  const memo = page.locator(".uf-pin"), text = memo.getByRole("textbox", { name: "Ghi chú" });
  await text.fill("Cần thêm loading khi gửi OTP\nÝ tưởng: nhớ số điện thoại");
  await page.keyboard.press("Tab"); // leaving the text keeps it
  expect((await flowOf(page)).memos![0].text).toBe("Cần thêm loading khi gửi OTP\nÝ tưởng: nhớ số điện thoại");
  await text.click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await page.keyboard.press("Escape"); // puts back what was stored
  expect((await flowOf(page)).memos![0].text.endsWith("!")).toBe(false);

  const was = (await flowOf(page)).memos![0], bar = await box(page, ".uf-pin .uf-pinbar");
  await drag(page, ".uf-pin .uf-pinname", [bar.x + 160, bar.y + 120]);
  const now = (await flowOf(page)).memos![0];
  expect(now.x).toBeGreaterThan(was.x + 20);
  expect(now.y).toBeGreaterThan(was.y + 20);

  // fold: the bar only, named by the first line; saved with the file; expand again
  const tall = (await box(page, ".uf-pin")).height;
  await memo.getByRole("button", { name: "Thu gọn ghi chú" }).click();
  expect((await flowOf(page)).memos![0].fold).toBe(true);
  await expect(memo.locator(".uf-pinname")).toHaveText("Cần thêm loading khi gửi OTP");
  expect((await box(page, ".uf-pin")).height).toBeLessThan(tall / 2);
  await memo.getByRole("button", { name: "Mở rộng ghi chú" }).click();
  expect("fold" in (await flowOf(page)).memos![0]).toBe(false);

  // reading: no text box, no delete; folding is this view's only, the flow is not changed
  await edit(page);
  await expect(memo.getByRole("textbox")).toHaveCount(0);
  await expect(memo.getByRole("button", { name: "Xoá ghi chú" })).toHaveCount(0);
  const saved = JSON.stringify(await flowOf(page));
  await memo.getByRole("button", { name: "Thu gọn ghi chú" }).click();
  await expect(memo).toHaveClass(/uf-pinfold/);
  expect(JSON.stringify(await flowOf(page))).toBe(saved);

  await edit(page);
  await memo.getByRole("button", { name: "Xoá ghi chú" }).click();
  await expect(memo).toHaveCount(0);
  expect((await flowOf(page)).memos).toBeUndefined(); // no note left: the key goes, the file keeps its old shape
});

test("a hand-edited file's broken notes are dropped, sizes kept in range", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const f = structuredClone(window.SAMPLE);
    f.memos = [{ id: "m1", x: 10, y: 20, w: 99999, h: 160, text: "Giữ" }, { id: "m1", x: 0, y: 0, w: 320, h: 160, text: "trùng id" },
      { id: "m2", x: "a", y: 0, text: "không có chỗ" } as unknown as { id: string; x: number; y: number; w: number; h: number; text: string }];
    window.__api.set(f);
  });
  expect((await flowOf(page)).memos).toEqual([{ id: "m1", x: 10, y: 20, w: 1600, h: 160, text: "Giữ" }]);
  await expect(page.locator(".uf-pin")).toHaveCount(1);
});

test("folding or deleting a note while its text is typed: the press lands, the text goes with the fold", async ({ page }) => {
  await open(page);
  await edit(page);
  await page.getByRole("button", { name: "+ Ghi chú" }).click();
  const v = await box(page, ".uf-view");
  await page.mouse.click(v.x + 60, v.y + 600);
  await page.keyboard.type("Chưa rời ô mà đã thu gọn");
  await page.locator(".uf-pin").getByRole("button", { name: "Thu gọn ghi chú" }).click();
  expect((await flowOf(page)).memos![0]).toMatchObject({ text: "Chưa rời ô mà đã thu gọn", fold: true });
  await page.locator(".uf-pin").getByRole("button", { name: "Mở rộng ghi chú" }).click();
  await page.locator(".uf-pin").getByRole("textbox").click();
  await page.keyboard.type(" thêm");
  await page.locator(".uf-pin").getByRole("button", { name: "Xoá ghi chú" }).click();
  await expect(page.locator(".uf-pin")).toHaveCount(0);
});

test("a drawn note is sized again by its corner, one undo step; folded, it has no corner", async ({ page }) => {
  await open(page);
  await edit(page);
  await page.getByRole("button", { name: "+ Ghi chú" }).click();
  const v = await box(page, ".uf-view");
  await page.mouse.click(v.x + 60, v.y + 560); // the default box: 320 × 160
  const was = (await flowOf(page)).memos![0], before = await box(page, ".uf-pin");
  const grip = await box(page, ".uf-pin .uf-pinrsz");
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + 120, grip.y + 80, { steps: 6 });
  await page.mouse.up();
  const now = (await flowOf(page)).memos![0];
  expect(now.w).toBeGreaterThan(was.w + 50);
  expect(now.h).toBeGreaterThan(was.h + 30);
  expect([now.x, now.y]).toEqual([was.x, was.y]); // its corner sizes it, the note stays put
  expect((await box(page, ".uf-pin")).width).toBeGreaterThan(before.width + 50);
  await page.keyboard.press("ControlOrMeta+z");
  expect((await flowOf(page)).memos![0]).toMatchObject({ w: was.w, h: was.h });
  // smaller than the least: kept at it
  const g2 = await box(page, ".uf-pin .uf-pinrsz");
  await page.mouse.move(g2.x + g2.width / 2, g2.y + g2.height / 2);
  await page.mouse.down();
  await page.mouse.move(g2.x - 600, g2.y - 400, { steps: 6 });
  await page.mouse.up();
  expect((await flowOf(page)).memos![0]).toMatchObject({ w: 160, h: 80 });
  await page.locator(".uf-pin").getByRole("button", { name: "Thu gọn ghi chú" }).click();
  await expect(page.locator(".uf-pin .uf-pinrsz")).toBeHidden();
});
