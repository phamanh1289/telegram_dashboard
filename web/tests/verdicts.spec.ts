import { expect, test } from "@playwright/test";
import { verdictsOf } from "../src/lib/verdicts";

// Đối chiếu code's table, as a real agent answered it (rows by "#"), read back per topic title for the Với BE cards.
const items = [
  { n: 1, summary: "Endpoint be-replies\nBE chốt: trả map chat_id -> reply" },
  { n: 2, summary: "Giới hạn tin mỗi lượt\nBE chốt: 300 tin" },
  { n: 3, summary: "sender_id trong reply\nHỏi BE: có trả sender_id?" },
  { n: 4, summary: "Khoá sửa tài sản\nPATCH trả 409" },
];
const prompt = `Việc cần làm…\n<items>\n${JSON.stringify(items)}\n</items>`;
const result = `Đủ dữ liệu để trả lời.

| # | Mục | Trạng thái | Bằng chứng |
|---|-----|-----------|-----------|
| 1 | Endpoint \`be-replies\` | ✅ Đã adapt | \`app.py:685\` route trả \`BeReply\` |
| 2 | Giới hạn 300 tin | ⚠️ Lệch | \`digest.py:19\` để 250 |
| 3 | \`sender_id\` | ⏳ Chờ BE | \`models.py:656\` chưa có field |
| 4 | Khoá sửa | ❌ Chưa làm | test cũ ghi ✅ nhưng không thấy bắt 409 |

**Cần làm** #2: đổi 250 → 300 (✅ sau khi sửa).`;

test("verdictsOf reads the status column per topic", () => {
  expect([...verdictsOf({ kind: "deep", prompt, result })]).toEqual([
    ["Endpoint be-replies", "ok"],
    ["Giới hạn tin mỗi lượt", "off"],
    ["sender_id trong reply", "waiting"],
    ["Khoá sửa tài sản", "missing"], // the evidence quoting ✅ does not win over the status
  ]);
  expect(verdictsOf({ kind: "deep", prompt: "<question>…</question>", result }).size).toBe(0); // a single check: no table per topic
  expect(verdictsOf({ kind: "deep", prompt, result: "Không đọc được dự án." }).size).toBe(0);
});
