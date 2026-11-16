import { btn, h } from './dom.js';
import { SHOTS, setShots } from './shots.js';
import { CAP, CAP_URL, MAX_LINKS, MAX_SCREENS, ZEPLIN } from './constants.js';
import { canon, scr, str } from './values.js';

/** "+ Từ Zeplin": a checked link, read once (ctx.lookup, the dashboard's), one new screen. Returns form(open, pend).
 *  `pend`: the title of the pending step this screen is for: it takes that step's kind / AC, is linked from
 *  where the step was reached, and the step leaves the list, all in the one undo step that adds the screen.
 *  ctx: {t, zform, view, lookup?, get(), addScreen(props, also), show(id), goto(id), opened(open)}. */
export function zeplinForm(ctx) {
  const { t, zform } = ctx;
  let zTry = 0;
  function form(open, pend = null) {
    zTry++; // a read still in flight answers a form that is gone
    ctx.opened(open);
    zform.hidden = !open;
    if (!open) return;
    const i = h("input", "uf-input");
    i.type = "url";
    i.placeholder = "https://app.zeplin.io/project/…/screen/…";
    const lab = h("label", "uf-field");
    lab.append(h("span", "uf-flab", t("zUrl")), i);
    const msg = h("p", "uf-zmsg");
    msg.setAttribute("role", "status");
    const acts = h("div", "uf-acts uf-chips");
    const say2 = (text, err, ...buttons) => {
      msg.textContent = text;
      msg.classList.toggle("uf-err", !!err);
      acts.replaceChildren(add, ...buttons, btn(t("close"), "uf-btn", () => form(false)));
    };
    const run = async (mode) => { // mode: undefined | "copy" (duplicate allowed) | "plain" (no image read)
      const url = i.value.trim(), me = ++zTry;
      if (!ZEPLIN.test(url) || url.length > CAP_URL) return say2(t("badZeplin"), true);
      const cur = ctx.get(), dup = cur.screens.find((s) => s.zeplin && canon(s.zeplin) === canon(url));
      if (dup && mode !== "copy") {
        ctx.goto(dup.id);
        return say2(t("zDup", { s: dup.title }), false, btn(t("zCopy"), "uf-btn", () => run("copy")));
      }
      if (cur.screens.length >= MAX_SCREENS) return say2(t("maxScreens", { n: MAX_SCREENS }), true);
      let shot = null;
      if (ctx.lookup && mode !== "plain") {
        say2(t("zReading"));
        add.disabled = true;
        const again = btn(t("zRetry"), "uf-btn", () => run(mode)), keep = btn(t("zKeep"), "uf-btn", () => run("plain"));
        try {
          shot = await ctx.lookup(url);
        } catch (e) {
          if (me !== zTry) return;
          add.disabled = false;
          return say2(`${t("zFail")}: ${e instanceof Error ? e.message : String(e)}`, true, again, keep);
        }
        if (me !== zTry) return;
        add.disabled = false;
        if (!shot) return say2(t("zMissing"), true, again, keep);
      }
      if (shot) setShots({ ...SHOTS, [url]: shot }); // drawn at once; the host's own shots replace it later
      const title = str(shot?.title).replace(/\s+/g, " ").trim().slice(0, CAP);
      const p = pend === null ? null : (ctx.get().pending || []).find((x) => x.title === pend); // read again: the flow may have changed while Zeplin answered
      const id = ctx.addScreen({ zeplin: url, ...(p ? { title: p.title, kind: p.kind, ac: p.ac, ...(p.src ? { near: scr(p.src) } : {}) } : {}),
        ...(title ? { title } : {}) },
        p && ((f, to) => {
          f.pending = f.pending.filter((x) => x.title !== p.title);
          if (p.src && f.links.length < MAX_LINKS)
            f.links.push({ src: p.src, to, act: p.kind === "screen" ? "navigate" : "open", when: p.when, ac: p.ac });
        }));
      if (id === null) return say2(t("dragging"), true);
      form(false);
      ctx.show(id); // the camera only: a screen just made is not where Prototype was
    };
    const add = btn(t("zAdd"), "uf-btn", () => run());
    i.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); run(); }
      else if (e.key === "Escape") { e.preventDefault(); form(false); ctx.view.focus({ preventScroll: true }); }
    });
    say2("", false);
    zform.replaceChildren(h("h2", "uf-ztitle", pend === null ? t("fromZeplin").replace(/^\+ /, "") : t("pendingAdd", { s: pend })), lab, msg, acts);
    i.focus();
  }
  return form;
}
