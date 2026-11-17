import { btn, h } from './dom.js';
import { norm } from './shots.js';
import { canon } from './values.js';

/** Search/highlighting is view state; choosing a result never changes the flow. */
export function createFinder({ t, uid, view, get, frames, goTo, selectScreen }) {
  // ---------------- find a screen: title (accents / case ignored), Zeplin link or id. No commit, no undo.
  let matches = [], active = -1;
  const findBox = h("input", "uf-input");
  const results = h("div", "uf-results");
  function finder() {
    const w = h("div", "uf-find");
    findBox.type = "search";
    findBox.placeholder = t("search");
    findBox.setAttribute("aria-label", t("search"));
    findBox.setAttribute("role", "combobox");
    findBox.setAttribute("aria-expanded", "false");
    findBox.setAttribute("aria-controls", uid + "-res");
    findBox.setAttribute("aria-autocomplete", "list");
    results.id = uid + "-res";
    results.setAttribute("role", "listbox");
    results.hidden = true;
    findBox.addEventListener("input", search);
    findBox.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (matches.length) pick((active + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length, false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (matches.length) choose(Math.max(active, 0));
      } else if (e.key === "Escape") {
        e.preventDefault();
        endSearch();
        view.focus({ preventScroll: true });
      }
    });
    findBox.addEventListener("blur", () => setTimeout(() => { if (!w.contains(document.activeElement)) results.hidden = true; findBox.setAttribute("aria-expanded", String(!results.hidden)); }, 150));
    w.append(findBox, results);
    return w;
  }
  function found(q) {
    const raw = q.trim();
    if (!raw) return [];
    const n = norm(raw), url = /^https?:\/\//i.test(raw), low = raw.toLowerCase();
    return get().screens.filter((s) => (url ? !!s.zeplin && (canon(s.zeplin) === canon(raw) || s.zeplin.includes(raw))
      : (n && (norm(s.title).includes(n) || s.items.some((it) => norm(it.label).includes(n)))) // a button's words find its screen
        || s.id.toLowerCase().includes(low) || (!!s.zeplin && s.zeplin.includes(raw))));
  }
  function search() {
    matches = found(findBox.value).map((s) => s.id);
    active = -1;
    results.replaceChildren(h("div", "uf-count", matches.length ? t("found", { n: matches.length }) : t("noFound")),
      ...matches.map((id, i) => {
        const s = get().screens.find((x) => x.id === id);
        const b = btn(s.title, "uf-res", () => choose(i));
        b.id = `${uid}-r${i}`;
        b.tabIndex = -1;
        b.setAttribute("role", "option");
        b.setAttribute("aria-selected", "false");
        b.addEventListener("mousedown", (e) => e.preventDefault()); // keep the box focused: blur would hide the list
        return b;
      }));
    results.hidden = !findBox.value.trim();
    findBox.setAttribute("aria-expanded", String(!results.hidden));
    findBox.removeAttribute("aria-activedescendant");
    applyMatch();
  }
  function pick(i, go) {
    active = i;
    for (const b of results.querySelectorAll(".uf-res")) b.setAttribute("aria-selected", String(b.id === `${uid}-r${i}`));
    const b = results.querySelector(`#${uid}-r${i}`);
    if (b) { findBox.setAttribute("aria-activedescendant", b.id); b.scrollIntoView({ block: "nearest" }); }
    if (go !== false) goTo(matches[i]);
  }
  function choose(i) {
    pick(i);
    selectScreen(matches[i]); // keyboard path to the inspector
    results.hidden = true;
    findBox.setAttribute("aria-expanded", "false");
  }
  function endSearch() {
    findBox.value = "";
    search();
  }
  function applyMatch() {
    const on = new Set(matches);
    frames().forEach((f, id) => f.classList.toggle("uf-match", on.has(id)));
  }

  return {
    element: finder(),
    sync() { matches = matches.filter((id) => frames().has(id)); applyMatch(); },
    hasMatches: () => matches.length > 0,
    clear: endSearch,
  };
}
