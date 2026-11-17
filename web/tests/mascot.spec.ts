import { expect, test } from "@playwright/test";

// An AI drawing readied to move (app.py ai_mascot_rig) is drawn into the page, not as an <image>, so globals.css can
// move its parts. The mascot pref may be any SVG the member uploaded, so Mascot (components/ai/chat.tsx) rebuilds it
// from shapes only: this one carries every way an SVG can run code, and none may survive.
const SVG = '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" onload="window.pwn=1">'
  + '<defs><linearGradient id="g"><stop offset="0" stop-color="#60A5FA"/></linearGradient></defs>'
  + '<circle cx="16" cy="11" r="7.5" fill="url(#g)"/>'
  + '<g class="m-blink" onmouseover="window.pwn=2" style="opacity:0"><circle cx="12" cy="10" r="2"/><circle cx="20" cy="10" r="2"/>'
  + '<script>window.pwn=3</script><image href="x" onerror="window.pwn=4"/><circle r="1" class="evil" fill="url(javascript:window.pwn=5)"/>'
  + '<a href="javascript:window.pwn=6"><rect width="9" height="9"/></a><foreignObject><img src="x" onerror="window.pwn=7"/></foreignObject></g>'
  + '<g class="m-wave" transform-origin="21 15"><path d="M21 15 L30 5"/></g></svg>';

test("a rigged AI mascot moves its parts like the robot, and nothing in the SVG runs", async ({ page }) => {
  await page.addInitScript((m) => localStorage.setItem("mascot", m), `data:image/svg+xml,${encodeURIComponent(SVG)}`);
  await page.goto("/settings#look");
  const live = page.locator("svg:has(> g.m-blink)");
  await expect(live.first()).toBeVisible();
  const one = live.first();
  await expect(one.locator("g.m-blink")).toHaveCSS("animation-name", "m-blink");
  await expect(one.locator("g.m-wave")).toHaveCSS("animation-name", "m-wave");
  await expect(one.locator("g.m-wave")).toHaveCSS("transform-origin", "21px 15px");

  const html = await one.innerHTML();
  for (const bad of ["script", "image", "foreignObject", "<a ", "style=", "evil", "javascript"]) expect(html).not.toContain(bad);
  expect(html).not.toMatch(/\son\w+=/);
  await one.locator("g.m-blink").hover({ force: true });
  expect(await page.evaluate(() => (window as unknown as { pwn?: number }).pwn)).toBeUndefined();

  // each mascot on the page keeps its own gradient: ids prefixed per instance, url(#…) follows
  // role mascots drawn without a gradient have nothing to collide
  const refs = (await live.evaluateAll((els) => els.map((e) => [e.querySelector("linearGradient")?.id, e.querySelector("circle")?.getAttribute("fill")])))
    .filter(([id]) => id);
  expect(refs.length).toBeGreaterThan(1);
  expect(new Set(refs.map(([id]) => id)).size).toBe(refs.length);
  for (const [id, fill] of refs) expect(fill).toBe(`url(#${id})`);
});
