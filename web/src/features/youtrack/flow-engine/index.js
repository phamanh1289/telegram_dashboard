import { SCREEN } from './constants.js';
import { layout } from './layout.js';
import { check } from './checks.js';
import { h } from './dom.js';
import { tr } from './i18n.js';
import { mount } from './mount.js';
import { checklist } from './checks.js';
import { normalize } from './model.js';

// ------------------------------------------------------------------ standalone auto-run
function auto() {
  const data = document.getElementById("uiflow-data");
  if (!data) return; // the dashboard mounts the engine itself
  const src = document.documentElement.outerHTML; // before mount: what "Lưu file" writes back
  // the host fills the page (styles above). Added after `src`, so a saved file stays as built and gets it again
  // when it is opened; the dashboard mounts through UIFlow.mount and sizes its own container.
  document.documentElement.classList.add("uf-file");
  let host = document.getElementById("uiflow");
  if (!host) {
    host = h("div");
    host.id = "uiflow";
    document.body.append(host);
  }
  let flow;
  try {
    flow = JSON.parse(data.textContent);
  } catch {
    host.textContent = tr(/^vi/i.test(navigator.language || "") ? "vi" : "en")("bad");
    return;
  }
  let shots = {};
  try {
    shots = JSON.parse(document.getElementById("uiflow-shots")?.textContent || "{}");
  } catch { /* a file without images: plain frames */ }
  host.uiflow = mount(host, flow, { edit: true, shots }, src); // the only handle an exported file has on its engine
}
window.UIFlow = Object.freeze({ SCREEN, layout, check, paths: (f, lang) => checklist(normalize(f), tr(lang)), mount: (el, flow, opts) => mount(el, flow, opts, null) });
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", auto, { once: true });
else auto();

export { auto };
