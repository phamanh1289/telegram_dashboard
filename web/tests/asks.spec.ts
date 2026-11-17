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
