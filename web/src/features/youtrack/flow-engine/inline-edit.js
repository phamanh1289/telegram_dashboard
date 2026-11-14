

// ------------------------------------------------------------------ editing (Sửa)
/** Edit one label in place: plain text, Enter / blur keeps it, Esc drops it, cut to `max`. done(value | null).
 *  `start` is what to put in the box when the element shows something else (an arrow shows "when · ac"). */
function inlineEdit(el, max, done, start) {
  if (el.isContentEditable) return;
  // Known limitation: Firefox < 136 ignores contenteditable="plaintext-only", so renaming does nothing there.
  const shown = el.textContent;
  if (start != null) el.textContent = start;
  el.setAttribute("contenteditable", "plaintext-only");
  el.classList.add("uf-edit-on");
  el.focus();
  const r = document.createRange();
  r.selectNodeContents(el);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  let over = false;
  const end = (keep) => {
    if (over) return;
    over = true;
    const val = el.textContent.replace(/\s+/g, " ").trim().slice(0, max);
    el.removeEventListener("keydown", onKey);
    el.removeEventListener("blur", onBlur); // a cancelled edit keeps its node: leave nothing on it
    el.removeAttribute("contenteditable");
    el.classList.remove("uf-edit-on");
    el.textContent = shown; // a commit re-renders with the real value; a cancel keeps what was drawn
    done(keep && val ? val : null);
  };
  const onKey = (e) => {
    e.stopPropagation(); // Delete / ⌘Z belong to the text while it is being edited
    if (e.key === "Enter") { e.preventDefault(); end(true); }
    else if (e.key === "Escape") { e.preventDefault(); end(false); }
  };
  const onBlur = () => end(true);
  el.addEventListener("keydown", onKey);
  el.addEventListener("blur", onBlur);
}

export { inlineEdit };
