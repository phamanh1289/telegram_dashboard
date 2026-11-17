import { SCREEN } from './constants.js';
import { layout } from './layout.js';
import { h } from './dom.js';
import { tr } from './i18n.js';
import { mount } from './mount.js';
import { APP_TOKENS } from './styles.js';

// ------------------------------------------------------------------ standalone auto-run
function auto() {
  const data = document.getElementById("uiflow-data");
  if (!data) return; // the dashboard mounts the engine itself
  // the host fills the page (styles above); the dashboard mounts through UIFlow.mount and sizes its own container.
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
  // view only: a file is edited on the dashboard (it checks the version on the ticket, the AI, the change log),
  // never offline, where a second copy would drift from the ticket's
  host.uiflow = mount(host, flow, { shots }, true); // the only handle an exported file has on its engine
}
window.UIFlow = Object.freeze({ SCREEN, tokens: APP_TOKENS, layout, mount: (el, flow, opts) => mount(el, flow, opts, null) });
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", auto, { once: true });
else auto();

export { auto };
