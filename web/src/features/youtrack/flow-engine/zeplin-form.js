import { btn, h, ibtn } from './dom.js';
import { SHOTS, setShots } from './shots.js';
import { CAP, CAP_URL, MAX_SCREENS, ZEPLIN } from './constants.js';
import { canon, str } from './values.js';

const READERS = 3; // links read at once (the dashboard's server reads Zeplin 4 at a time and caches)

/** "+ Từ Zeplin": a popover under its button. One or many links (comma, space or new line between them), each
 *  checked, read (ctx.lookup, the dashboard's) and added as a screen, all in one undo step. When some go wrong,
 *  nothing is added yet: only those are listed, with why; "Thử lại" reads the box again once fixed, "Thêm x màn
 *  hình" adds the x that were fine and leaves the wrong ones in the box.
 *  ctx: {t, zform, view, anchor(), lookup?, get(), addScreens(list), show(id), goto(id), opened(open)}. */
export function zeplinForm(ctx) {
  const { t, zform } = ctx;
  let zTry = 0;
  function place() { // beside the toolbar button that opens it, level with it, inside the map
    const a = ctx.anchor?.(), p = zform.offsetParent;
    if (!a || !p) return;
    const pr = p.getBoundingClientRect(), ar = a.getBoundingClientRect();
    zform.style.top = Math.max(8, Math.min(ar.top - pr.top, pr.height - zform.offsetHeight - 8)) + "px";
  }
  function form(open) {
    zTry++; // a read still in flight answers a form that is gone
    ctx.opened(open);
    zform.hidden = !open;
    if (!open) return;
    const box = h("textarea", "uf-input uf-zurls");
    box.rows = 3;
    box.placeholder = t("zPlaceholder");
    box.setAttribute("aria-label", t("zUrl"));
    const count = h("span", "uf-zcount");
    const msg = h("p", "uf-zmsg");
    msg.setAttribute("role", "status");
    const report = h("div", "uf-zreport");
    report.setAttribute("role", "alert");
    report.hidden = true;
    const acts = h("div", "uf-acts uf-chips");
    const add = btn(t("zAdd"), "uf-btn uf-zadd", () => run());
    const close = ibtn("x", t("close"), "uf-btn uf-zclose", () => form(false)); // in the header: the row below is for actions
    const links = () => [...new Set(box.value.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean))];
    const recount = () => {
      const n = links().length;
      count.textContent = n > 1 ? t("zCount", { n }) : "";
      add.textContent = n > 1 ? t("zAddN", { n }) : t("zAdd");
    };
    const say = (text, err) => { msg.textContent = text; msg.classList.toggle("uf-err", !!err); };
    /** Only the links that went wrong, each with why; the box keeps every link to fix and send again. */
    function tell(bad, good) {
      report.replaceChildren(h("p", "uf-zhead", t("zCheck", { n: bad.length })));
      const ul = h("ul", "uf-zlist");
      for (const b of bad) {
        const li = h("li"), u = h("span", "uf-zurl", b.url);
        u.title = b.url;
        li.append(u, h("span", "uf-zwhy", b.why));
        ul.append(li);
      }
      report.append(ul);
      report.hidden = false;
      say("", false);
      add.textContent = t("zRetry");
      // the good ones are read already: added as they are, the wrong ones stay in the box
      acts.replaceChildren(add, ...(good.length ? [btn(t("zAddValid", { n: good.length }), "uf-btn", () => put(good, bad))] : []));
    }
    /** Add the screens read for `good` (one undo step); `bad` stays in the box and the list. -> false when refused. */
    function put(good, bad = []) {
      const shots = good.filter((g) => g.shot);
      if (shots.length) setShots({ ...SHOTS, ...Object.fromEntries(shots.map((g) => [g.url, g.shot])) }); // drawn at once
      const list = good.map(({ url, shot }) => {
        const title = str(shot?.title).replace(/\s+/g, " ").trim().slice(0, CAP);
        return { zeplin: url, ...(title ? { title } : {}), ...(shot?.cut > 0 && shot.cut < 1 ? { fold: shot.cut } : {}) }; // a long list: folded
      });
      const ids = ctx.addScreens(list);
      if (ids === null) { say(t("dragging"), true); return false; } // refused mid-gesture: nothing added, the links stay
      if (!bad.length) form(false);
      else { // what is left: the wrong ones only, still listed
        box.value = bad.map((b) => b.url).join("\n");
        recount();
        add.textContent = t("zRetry"); // they still need fixing first
        say(t("zAdded", { n: ids.length }), false);
        acts.replaceChildren(add);
      }
      ctx.show(ids[0]); // the camera only: a screen just made is not where Prototype was
      return true;
    }
    async function run() {
      const me = ++zTry, urls = links();
      if (!urls.length) return say(t("zNone"), true);
      report.hidden = true;
      const cur = ctx.get(), bad = [], todo = [];
      for (const url of urls) {
        const dup = cur.screens.find((s) => s.zeplin && canon(s.zeplin) === canon(url));
        if (!ZEPLIN.test(url) || url.length > CAP_URL) bad.push({ url, why: t("badZeplin") });
        else if (dup) {
          bad.push({ url, why: t("zDup", { s: dup.title }) });
          if (urls.length === 1) ctx.goto(dup.id); // the one asked for is already here: show it
        } else todo.push(url);
      }
      if (cur.screens.length + todo.length > MAX_SCREENS) return say(t("maxScreens", { n: MAX_SCREENS }), true);
      const good = [];
      if (ctx.lookup && todo.length) { // read them, a few at a time; none of it touches the flow
        say(t("zReadingN", { i: 0, n: todo.length }));
        add.disabled = true;
        let next = 0, done = 0;
        const reader = async () => {
          while (next < todo.length) {
            const url = todo[next++];
            try {
              const shot = await ctx.lookup(url);
              if (shot) good.push({ url, shot });
              else bad.push({ url, why: t("zMissing") });
            } catch (e) {
              bad.push({ url, why: `${t("zFail")}: ${e instanceof Error ? e.message : String(e)}` });
            }
            if (me === zTry) say(t("zReadingN", { i: ++done, n: todo.length }));
          }
        };
        await Promise.all(Array.from({ length: Math.min(READERS, todo.length) }, reader));
        if (me !== zTry) return;
        add.disabled = false;
      } else good.push(...todo.map((url) => ({ url, shot: null })));
      const order = (a, b) => urls.indexOf(a.url) - urls.indexOf(b.url); // as the user wrote them
      good.sort(order);
      bad.sort(order);
      if (!bad.length) return void put(good); // all of them: added, closed
      say("", false);
      tell(bad, good); // something went wrong: nothing added yet, the user checks first
    }
    box.addEventListener("input", () => { recount(); say("", false); acts.replaceChildren(add); }); // edited: Thử lại reads it all again
    box.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run(); } // Shift+Enter: a new line
      else if (e.key === "Escape") { e.preventDefault(); form(false); ctx.view.focus({ preventScroll: true }); }
    });
    const head = h("div", "uf-zhead-row");
    head.append(h("h2", "uf-ztitle", t("zTitle")), count, close);
    acts.replaceChildren(add);
    zform.replaceChildren(head, box, msg, report, acts);
    place();
    box.focus();
  }
  return form;
}
