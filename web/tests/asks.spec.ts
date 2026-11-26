import { expect, test } from "@playwright/test";
import { splitAsks } from "../src/shared/components/markdown";

// The hard cap behind ASK_MSG: a quoted message to a teammate carries at most 3 points (a lone leftover joins the last).
const ask = (n: number, tag = "> @be_bot\n") => tag + Array.from({ length: n }, (_, i) => `> ${i + 1}. point ${i + 1}`).join("\n");
const sizes = (md: string) =>
  md.split(/\n(?=> @be_bot)/).map((m) => m.split("\n").filter((l) => /^> \d+\./.test(l)).length);

test("splitAsks: 4 stays one message, 7 → 3 + 4, 10 → 3 + 3 + 4", () => {
  expect(splitAsks(ask(4))).toBe(ask(4));
  expect(sizes(splitAsks(ask(7)))).toEqual([3, 4]);
  expect(sizes(splitAsks(ask(10)))).toEqual([3, 3, 4]);
});

test("splitAsks: each message is renumbered from 1 and keeps the @tag", () => {
  const second = splitAsks(ask(7)).split("\n\n")[1];
  expect(second.split("\n").slice(0, 2)).toEqual(["> @be_bot", "> 1. point 4"]);
});

test("splitAsks: a quote with no @tag is left alone", () => {
  expect(splitAsks(ask(7, ""))).toBe(ask(7, ""));
});

// "- Hỏi BE:" with the message quoted under it (label "**Còn lại / cần hỏi**" names no role): the send button posts
// only the quote, asked to BE (its "#QA_BE_…" code), not the "Hỏi BE:" line.
test("asks: a quote under a list item takes the item's role and is posted alone", async () => {
  const { createElement: h } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { AskPost, Markdown } = await import("../src/shared/components/markdown");
  const md = "**Còn lại / cần hỏi**\n- Chưa sửa: luồng V1.\n- Hỏi BE:\n  > @be_bot\n  > 1. `x` có đi thẳng được không?";
  const got: [string, string | null][] = [];
  renderToStaticMarkup(h(AskPost.Provider, { value: (text, role) => void got.push([text, role]) }, h(Markdown, { text: md, asks: true })));
  expect(got).toEqual([["Chưa sửa: luồng V1.", null], ["@be_bot\n1. `x` có đi thẳng được không?", "BE"]]);
});

// "**Cần hỏi lại**" then "**BE:**" on the next line, no blank line (one paragraph): the asks under it are still BE's,
// and the "**BE:**" line is a label, not an ask with its own send button.
test("asks: a role label right under the ask label (no blank line) still sets the role", async () => {
  const { createElement: h } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { AskPost, Markdown } = await import("../src/shared/components/markdown");
  const md = "**Cần hỏi lại**\n**BE:**\n> @be_bot\n> 1. x?\n\n**PO:**\n> @po\n> 1. y?";
  const got: [string, string | null][] = [];
  renderToStaticMarkup(h(AskPost.Provider, { value: (text, role) => void got.push([text, role]) }, h(Markdown, { text: md, asks: true })));
  expect(got).toEqual([["@be_bot\n1. x?", "BE"], ["@po\n1. y?", "PO"]]);
});
