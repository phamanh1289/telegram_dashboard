import { expect, test } from "@playwright/test";
import { snoozeChoices, vnAt } from "../src/shared/lib/time";

// Pure Vietnam-time math (UTC+7) behind the snooze presets; no page needed.
const at = (iso: string) => new Date(iso).getTime();
const labels = (now: number) => Object.fromEntries(snoozeChoices(now).map((c) => [c.label, c.at.toISOString()]));

test("vnAt reads days and hours in Vietnam time, across the UTC date line", () => {
  expect(vnAt(0, 14, 0, at("2026-11-05T03:00:00Z")).toISOString()).toBe("2026-11-05T07:00:00.000Z"); // 10:00 VN → 14:00 VN
  expect(vnAt(1, 9, 0, at("2026-11-05T18:00:00Z")).toISOString()).toBe("2026-11-07T02:00:00.000Z"); // 01:00 VN on the 6th → 9:00 on the 7th
});

test("snooze presets: 14:00 only before 14:00, Monday is the next one", () => {
  const thu = labels(at("2026-11-05T03:00:00Z")); // Thursday 10:00 VN
  expect(thu["14:00 hôm nay"]).toBe("2026-11-05T07:00:00.000Z");
  expect(thu["Sáng mai 9:00"]).toBe("2026-11-06T02:00:00.000Z");
  expect(thu["Thứ Hai 9:00"]).toBe("2026-11-09T02:00:00.000Z");
  expect(labels(at("2026-11-05T08:00:00Z"))["14:00 hôm nay"]).toBeUndefined(); // 15:00 VN
  expect(labels(at("2026-11-08T03:00:00Z"))["Thứ Hai 9:00"]).toBe("2026-11-09T02:00:00.000Z"); // Sunday → tomorrow
  expect(labels(at("2026-11-09T03:00:00Z"))["Thứ Hai 9:00"]).toBe("2026-11-16T02:00:00.000Z"); // Monday → next week
  expect(snoozeChoices(at("2026-11-05T03:00:00Z")).filter((c) => c.clock).map((c) => c.label)).toEqual(["1 giờ", "3 giờ"]);
});
