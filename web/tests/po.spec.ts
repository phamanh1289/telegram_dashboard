import { expect, test } from "@playwright/test";
import { samePerson } from "../src/features/telegram/lib/mentions";
import { lineDiff } from "../src/shared/lib/utils";

// Cập nhật story › Thay đổi: what the AI kept, dropped and added.
test("lineDiff: kept, removed and added lines in order", () => {
  expect(lineDiff("a\nb\nc", "a\nB\nc\nd")).toEqual([[" ", "a"], ["+", "B"], ["-", "b"], [" ", "c"], ["+", "d"]]);
  expect(lineDiff("x\r\ny", "x\ny").every(([op]) => op === " ")).toBe(true);
});

// Cập nhật story › Báo nhóm: a YouTrack name found among the group's Telegram members.
test("samePerson: words in any order, accents and case ignored, or the last two words", () => {
  expect(samePerson("Anh Phạm", "Phạm Anh")).toBe(true);
  expect(samePerson("pham tuan anh", "Phạm Tuấn Anh")).toBe(true);
  expect(samePerson("Tuấn Anh (BE)", "Phạm Tuấn Anh")).toBe(true);
  expect(samePerson("Anh", "Phạm Tuấn Anh")).toBe(false); // one word is too loose to tag someone
  expect(samePerson("Đức Anh", "Phạm Tuấn Anh")).toBe(false);
});
