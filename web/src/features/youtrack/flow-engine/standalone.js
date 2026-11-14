import { h } from './dom.js';
import { str } from './values.js';

// ------------------------------------------------------------------ standalone helpers
function readHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  return { s: q.get("s"), m: q.get("m") };
}
/** Download the page as captured before mount, with the data block replaced by `flow`. */
function saveFile(src, flow) {
  const json = JSON.stringify(flow).replace(/</g, "\\u003c");
  const html = "<!doctype html>\n" +
    src.replace(/(<script[^>]*\bid=["']?uiflow-data["']?[^>]*>)[\s\S]*?(<\/script>)/i, (_, a, b) => a + json + b);
  const a = h("a");
  a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  a.download = `uiflow-${str(flow.ticket, "flow").replace(/[^\w.-]/g, "_")}.html`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
}

export { readHash, saveFile };
