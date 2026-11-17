import { BEZEL, BOTTOM, HEAD, STATUS } from './constants.js';
import { h } from './dom.js';

// ------------------------------------------------------------------ styles (injected once)
// Palette: inside the dashboard every colour follows the app's own tokens (the member's accent, paper, ink, signal…),
// so the map reads as one more view of the app. An exported file has no such tokens: the fallbacks below apply.
// [name, app token, light fallback, dark fallback]
const TOKENS = [
  ["bg", "color-paper", "#f3f4f7", "#0d0f14"], ["screen", "color-cotton", "#fff", "#181b22"],
  ["ink", "color-ink", "#111827", "#e8eaee"], ["ink2", "color-ink-3", "#6b7280", "#9aa1ad"],
  ["line", "color-rule", "#d9dce3", "#2c313b"], ["soft", "color-paper-2", "#f1f3f6", "#22262e"],
  ["muted", "color-rule-2", "#9aa1ad", "#697282"], ["accent", "color-hl", "#4f46e5", "#8b8cf8"],
  ["on-accent", "color-hl-ink", "#fff", "#0d0f14"], ["fill", "hl-fill", "#4f46e5", "#8b8cf8"],
  ["warn", "color-signal-2", "#c2410c", "#fb923c"], ["bad", "color-error", "#b91c1c", "#f87171"],
  ["ok", "color-ok", "#059669", "#34d399"], ["hit", "color-signal", "#eab308", "#facc15"],
  ["c-popup", "color-signal-2", "#d97706", "#fbbf24"], ["c-sheet", "cat-4", "#0d9488", "#2dd4bf"],
  ["c-toast", "cat-3", "#db2777", "#f472b6"], ["c-item", "color-info", "#0284c7", "#38bdf8"],
];
const vars = (k) => TOKENS.map(([n, app, ...v]) => `--uf-${n}:var(--${app},${v[k]})`).join(";");
const DARK = vars(1) + ";--uf-bezel:#2e333c;--uf-shadow:0 1px 2px rgba(0,0,0,.4),0 18px 44px -14px rgba(0,0,0,.7);color-scheme:dark";
const CSS = `
.uf-root{${vars(0)};--uf-bezel:#1b1d22;--uf-shadow:0 1px 2px rgba(16,24,40,.06),0 18px 44px -14px rgba(16,24,40,.22);
--uf-accent-soft:color-mix(in srgb,var(--uf-accent) 14%,transparent);--uf-warn-soft:color-mix(in srgb,var(--uf-warn) 14%,transparent);
--uf-hit-soft:color-mix(in srgb,var(--uf-hit) 22%,transparent);--uf-r:var(--radius-input,8px);--uf-ease:cubic-bezier(.22,.8,.24,1);
position:relative;display:flex;height:100%;min-height:0;overflow:hidden;background:var(--uf-bg);
color:var(--uf-ink);font:15px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
font-family:var(--font-body,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif);
-webkit-font-smoothing:antialiased}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .uf-root{${DARK}}}
[data-theme=dark] .uf-root{${DARK}}
.uf-root *{box-sizing:border-box}
/* the toolbar: a rail down the left edge, over the map (.uf-main keeps its 48px clear). Icons only; the pointer
 * resting on it (or the keyboard in it) slides it open with every name, and leaving slides it shut at once. Only
 * the rail's width moves: every row stretches with it and keeps its icon where it was, the names fade in once there
 * is room. .uf-hold: a tool was just picked, shut until the pointer leaves. */
.uf-bar{position:absolute;left:0;top:0;bottom:0;z-index:5;display:flex;flex-direction:column;gap:2px;width:48px;
padding:8px 0;background:var(--uf-screen);border-right:1px solid var(--uf-line);
transition:width .3s var(--uf-ease),box-shadow .3s ease-out}
/* a tool picked shuts it at once, as a menu does: what the tool does next (a note drawn by the edge, the Zeplin box
 * beside it) is not under a rail still sliding */
.uf-bar.uf-hold,.uf-hold .uf-lbl{transition:none}
.uf-bar:hover:not(.uf-hold),.uf-bar:has(:focus-visible){width:212px;box-shadow:var(--uf-shadow);
transition:width .3s var(--uf-ease) .12s,box-shadow .3s ease-out .12s}
.uf-bar .uf-btn{flex:none;justify-content:flex-start;gap:9px;width:auto;height:34px;margin:0 7px;padding:0 0 0 8px;
border-color:transparent;border-radius:9px;background:transparent;color:var(--uf-ink2)}
.uf-bar .uf-btn:hover:not(:disabled){background:var(--uf-soft);color:var(--uf-ink)}
.uf-bar .uf-btn[aria-pressed=true],.uf-bar .uf-btn[aria-expanded=true]{background:var(--uf-accent-soft);color:var(--uf-accent)}
.uf-lbl{min-width:0;overflow:hidden;text-overflow:ellipsis;font-weight:500;opacity:0;transition:opacity .1s ease-out}
.uf-bar:hover:not(.uf-hold) .uf-lbl,.uf-bar:has(:focus-visible) .uf-lbl{opacity:1;transition:opacity .2s ease-out .22s}
.uf-btn{height:30px;padding:0 11px;border:1px solid var(--uf-line);border-radius:var(--uf-r);background:var(--uf-screen);
color:var(--uf-ink);font:inherit;font-size:13px;font-weight:600;white-space:nowrap;cursor:pointer}
.uf-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;
transition:background .15s ease-out,border-color .15s ease-out,color .15s ease-out,transform .12s ease-out}
.uf-btn svg{flex:none}
.uf-btn:hover{background:var(--uf-soft)}
.uf-btn:active{transform:scale(.96)}
.uf-btn[aria-pressed=true]{background:var(--uf-accent);border-color:var(--uf-accent);color:var(--uf-on-accent)}
.uf-icon{width:30px;padding:0}
.uf-ihead [data-tip]{position:relative}
.uf-ihead [data-tip]::after{content:attr(data-tip);position:absolute;z-index:40;
padding:5px 9px;border-radius:var(--uf-r);background:var(--uf-ink);color:var(--uf-screen);font-size:12px;font-weight:400;line-height:1.3;
white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .12s ease-out}
.uf-ihead [data-tip]:hover::after,.uf-ihead [data-tip]:focus-visible::after{opacity:1;transition-delay:.5s}
/* Sửa is the one coloured switch; its tools are one group under it that slides open while it is on (the rows
 * below glide down with it) and closed again; shut, it is out of the tab order (visibility) */
.uf-bar .uf-editbtn{color:var(--uf-accent)}
.uf-bar .uf-editbtn[aria-pressed=true]{background:var(--uf-fill);color:var(--uf-on-accent)}
.uf-tools{flex:none;display:grid;grid-template-rows:0fr;grid-template-columns:minmax(0,1fr);margin:0 5px;padding:0 3px;border-radius:12px;
background:var(--uf-accent-soft);opacity:0;visibility:hidden;
transition:grid-template-rows .3s var(--uf-ease),padding .3s var(--uf-ease),opacity .2s ease-out,visibility 0s .3s}
.uf-editing .uf-tools{grid-template-rows:1fr;padding:3px;opacity:1;visibility:visible;
transition:grid-template-rows .3s var(--uf-ease),padding .3s var(--uf-ease),opacity .25s ease-out .05s,visibility 0s}
.uf-root[data-mode=play] .uf-tools{display:none}
.uf-tin{display:flex;flex-direction:column;gap:2px;min-height:0;overflow:hidden}
.uf-bar .uf-tools .uf-btn{height:32px;margin:0;padding-left:7px;color:var(--uf-ink)}
.uf-bar .uf-tools .uf-btn:hover:not(:disabled){background:var(--uf-screen)}
.uf-div{flex:none;width:22px;height:1px;margin:5px 0;background:var(--uf-line)}
.uf-bar .uf-div{width:auto;margin:5px 13px}
.uf-bar .uf-tin .uf-div{margin:4px 6px}
.uf-root[data-mode=play] .uf-bar .uf-div{display:none}
.uf-seg{display:inline-flex;gap:2px;padding:2px;border-radius:var(--uf-r);background:var(--uf-soft);box-shadow:inset 0 0 0 1px var(--uf-line)}
/* the rail's view switch: one filled pill that slides between Toàn cục and Prototype */
.uf-bar .uf-seg{position:relative;flex:none;display:flex;flex-direction:column;margin:0 6px;border-radius:12px}
.uf-bar .uf-seg::before{content:"";position:absolute;left:2px;right:2px;top:2px;height:32px;border-radius:9px;
background:var(--uf-fill);pointer-events:none;transition:transform .34s cubic-bezier(.3,1.3,.5,1)}
.uf-bar .uf-seg:has(>:last-child[aria-pressed=true])::before{transform:translateY(34px)}
.uf-bar .uf-seg .uf-btn{position:relative;height:32px;margin:0;padding-left:8px;border-radius:9px}
.uf-bar .uf-seg .uf-btn[aria-pressed=true],.uf-bar .uf-seg .uf-btn[aria-pressed=true]:hover:not(:disabled){background:transparent;color:var(--uf-on-accent)}
.uf-seg .uf-btn{height:26px;border:0;border-radius:5px;background:transparent;color:var(--uf-ink2)}
.uf-seg .uf-btn:hover{color:var(--uf-ink)}
.uf-seg .uf-btn[aria-pressed=true]{background:var(--uf-fill);color:var(--uf-on-accent)}
.uf-main{position:relative;flex:1;min-height:0;margin-left:48px}
.uf-view{position:absolute;inset:0;overflow:hidden;touch-action:none;cursor:grab;user-select:none;-webkit-user-select:none;outline:none}
.uf-btn:focus-visible,.uf-zeplin:focus-visible{outline:2px solid var(--uf-accent);outline-offset:2px}
.uf-view:focus-visible{outline:2px solid var(--uf-accent);outline-offset:-2px}
.uf-view.uf-moving{cursor:grabbing}
.uf-layer{position:absolute;left:0;top:0;transform-origin:0 0}
.uf-moving .uf-layer{will-change:transform}
.uf-play{position:absolute;inset:0;display:none}
.uf-root[data-mode=play] .uf-view{display:none}
.uf-root[data-mode=play] .uf-play{display:flex;flex-direction:column}
.uf-root[data-mode=play] .uf-fit{display:none}
.uf-screen{position:absolute;left:0;top:0;width:var(--uf-w);height:var(--uf-h);border-radius:54px;background:var(--uf-screen);
box-shadow:0 0 0 1px var(--uf-line),var(--uf-shadow);transition:opacity .2s ease-out}
.uf-screen:not(.uf-ov)::before,.uf-phone::before{content:"";position:absolute;top:11px;left:50%;width:120px;height:33px;margin-left:-60px;
border-radius:20px;background:#000;opacity:.88}
.uf-screen:not(.uf-ov)::after,.uf-phone::after{content:"";position:absolute;bottom:9px;left:50%;width:134px;height:5px;margin-left:-67px;
border-radius:3px;background:var(--uf-ink);opacity:.45}
.uf-ov{background:none;box-shadow:none;pointer-events:none}
.uf-card{position:absolute}
.uf-ov .uf-card{pointer-events:auto;border-radius:22px;background:var(--uf-screen);box-shadow:var(--uf-shadow);
outline:1.5px dashed var(--uf-accent);outline-offset:0}
.uf-sheet .uf-card{border-radius:28px 28px 14px 14px}
.uf-popup,.uf-k-popup{--uf-kind:var(--uf-c-popup)}
.uf-sheet,.uf-k-sheet{--uf-kind:var(--uf-c-sheet)}
.uf-toast,.uf-k-toast{--uf-kind:var(--uf-c-toast)}
.uf-k-item{--uf-kind:var(--uf-c-item)}
.uf-k-link{--uf-kind:var(--uf-ink2)}
.uf-ov:not(.uf-sel) .uf-card{outline-color:var(--uf-kind,var(--uf-accent))}
.uf-popup .uf-empty::after,.uf-sheet .uf-empty::after{content:"";position:absolute;left:20px;right:72px;top:72px;height:10px;
border-radius:5px;background:var(--uf-soft);box-shadow:0 22px 0 var(--uf-soft)}
.uf-head{position:absolute;display:flex;align-items:center;gap:8px;padding:0 18px 0 20px}
.uf-screen:not(.uf-ov) .uf-head{border-bottom:1px solid var(--uf-soft)}
.uf-title{flex:1;min-width:0;font-size:17px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uf-ac,.uf-lac{flex:none;max-width:120px;padding:2px 8px;border-radius:999px;background:var(--uf-accent-soft);color:var(--uf-accent);
font-size:12px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uf-zeplin{flex:none;display:grid;place-items:center;width:30px;height:30px;border-radius:9px;color:var(--uf-ink2)}
.uf-zeplin[href]{color:var(--uf-accent)}
.uf-zeplin[href]:hover{background:var(--uf-accent-soft)}
.uf-zeplin:not([href]){opacity:.4}
/* frame label: --zk is the camera zoom. Laid out at k·(card width) and scaled by 1/k, so on screen it is exactly the
 frame's width and its text a constant 12px, whatever the zoom. Its layout width is its on-screen width, so a
 container query can drop the AC chip where it would only push the name out. */
.uf-flabel{position:absolute;left:0;bottom:100%;display:flex;align-items:center;gap:6px;width:calc(var(--zk,1) * 100%);
padding-bottom:6px;transform:scale(calc(1 / var(--zk,1)));transform-origin:0 100%;font-size:12px;line-height:16px;
font-weight:600;color:var(--uf-ink);white-space:nowrap;pointer-events:none;transition:opacity .15s ease-out;
container-type:inline-size}
.uf-ltitle{min-width:0;overflow:hidden;text-overflow:ellipsis}
.uf-lac{max-width:45%;padding:1px 7px;font-size:11px}
.uf-root:not(.uf-editing) .uf-ac,.uf-root:not(.uf-editing) .uf-lac{pointer-events:auto;cursor:pointer}
.uf-lstart{flex:none;color:var(--uf-accent);font-size:10px}
@container (max-width:180px){.uf-lac{display:none}}
.uf-near .uf-flabel{opacity:0}
.uf-item{position:absolute;padding:0 30px 0 14px;border:1px solid var(--uf-line);border-radius:12px;background:var(--uf-soft);
font-size:15px;font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uf-item.uf-linked::after{content:"›";position:absolute;right:12px;top:0;color:var(--uf-ink2);font-size:20px}
.uf-root .uf-dead{border-style:dashed;background:transparent;color:var(--uf-ink2)}
/* a frame drawn from its Zeplin image: buttons are boxes over the design, the title rides on its status bar */
.uf-shot .uf-card{border-radius:54px}
.uf-shot::before,.uf-shot::after{display:none}
.uf-imgbox{position:absolute;inset:0;overflow:hidden;border-radius:inherit;background:var(--uf-screen)}
.uf-folded .uf-imgbox::after{content:"";position:absolute;left:0;right:0;bottom:0;height:72px;pointer-events:none;
background:linear-gradient(to bottom,transparent,color-mix(in srgb,var(--uf-screen) 92%,transparent))}
.uf-fold{position:absolute;left:50%;z-index:61;height:28px;translate:-50% -50%;border-radius:999px;font-size:12px;
box-shadow:var(--uf-shadow);opacity:0;transition:opacity .15s ease-out}
.uf-foldh{position:absolute;left:25%;width:50%;height:14px;z-index:61;cursor:ns-resize}
.uf-foldh::after{content:"";position:absolute;left:50%;top:5px;width:56px;height:4px;margin-left:-28px;border-radius:2px;
background:var(--uf-accent);opacity:0;transition:opacity .15s ease-out}
.uf-screen:hover .uf-foldh::after,.uf-screen.uf-sel .uf-foldh::after{opacity:.7}
.uf-screen:hover .uf-fold,.uf-screen.uf-sel .uf-fold,.uf-folded .uf-fold,.uf-fold:focus-visible{opacity:1}
/* a Zeplin image still loading: a small spinner at the top of its box (the image paints over it) */
.uf-ld::before{content:"";position:absolute;left:50%;top:120px;width:28px;height:28px;margin-left:-14px;border-radius:50%;
border:3px solid var(--uf-line);border-top-color:var(--uf-accent);animation:uf-spin .8s linear infinite;z-index:0}
@keyframes uf-spin{to{transform:rotate(1turn)}}
.uf-img{position:relative;display:block;width:100%;max-width:none;user-select:none;-webkit-user-select:none;-webkit-user-drag:none}
.uf-shot .uf-head{border-radius:54px 54px 0 0;padding-left:44px;background:color-mix(in srgb,var(--uf-screen) 88%,transparent);
border-bottom:1px solid var(--uf-line)}
.uf-shot .uf-head{transition:opacity .15s ease-out}
.uf-view:not(.uf-near) .uf-shot:not(:hover):not(.uf-sel):not(.uf-on) .uf-head{opacity:0}
.uf-item.uf-hot{padding:0 6px;border:1.5px solid color-mix(in srgb,var(--uf-accent) 55%,transparent);border-radius:10px;
background:transparent;color:transparent;font-size:13px;transition:background .15s ease-out,border-color .15s ease-out}
.uf-screen:hover .uf-hot,.uf-on .uf-hot,.uf-sel .uf-hot,.uf-hot.uf-sel{border-color:var(--uf-accent);background:var(--uf-accent-soft)}
.uf-item.uf-hot::after{content:none}
.uf-root .uf-hot.uf-dead{border-color:var(--uf-warn);background:transparent;color:transparent}
.uf-hot.uf-edit-on{color:var(--uf-ink)}
.uf-editing .uf-rect{cursor:move}
.uf-rsz{display:none;position:absolute;right:0;bottom:0;width:14px;height:14px;border:2px solid var(--uf-screen);
border-radius:4px;background:var(--uf-accent);cursor:nwse-resize;touch-action:none}
.uf-editing .uf-rect.uf-sel .uf-rsz{display:block}
.uf-drawing .uf-screen.uf-drawon{cursor:crosshair}
.uf-zl{position:absolute;inset:0;pointer-events:none}
.uf-zl i{position:absolute;border:1px dashed color-mix(in srgb,var(--uf-accent) 70%,transparent);border-radius:6px}
.uf-drawing .uf-screen.uf-drawon .uf-imgbox{outline:3px dashed var(--uf-accent);outline-offset:-3px}
.uf-startb{flex:none;display:grid;place-items:center;width:24px;height:24px;border-radius:7px;background:var(--uf-accent);
color:var(--uf-on-accent);font-size:11px}
.uf-memo{flex:none;display:grid;place-items:center;width:24px;height:24px;border-radius:7px;background:var(--uf-hit-soft);
color:var(--uf-ink);font-size:14px;cursor:help}
.uf-screen.uf-match{box-shadow:0 0 0 5px var(--uf-hit),var(--uf-shadow)}
.uf-ov.uf-match .uf-card{box-shadow:0 0 0 5px var(--uf-hit),var(--uf-shadow)}
/* find a screen: over the map's top left corner */
.uf-find{position:absolute;top:10px;left:10px;z-index:3;width:min(280px,calc(100% - 20px))}
.uf-find .uf-input{width:100%;height:34px;border-radius:10px;padding:0 12px;background:var(--uf-screen);
box-shadow:0 0 0 1px var(--uf-line),var(--uf-shadow)}
.uf-results{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:4;max-height:320px;overflow:auto;padding:4px;
border-radius:12px;background:var(--uf-screen);box-shadow:0 0 0 1px var(--uf-line),var(--uf-shadow)}
.uf-res{display:block;width:100%;padding:7px 10px;border:0;border-radius:8px;background:none;color:inherit;font:inherit;
font-size:13px;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}
.uf-res[aria-selected=true],.uf-res:hover{background:var(--uf-accent-soft)}
.uf-count{padding:4px 10px;color:var(--uf-ink2);font-size:12px}
.uf-zform{right:auto;left:8px;width:min(400px,calc(100% - 16px));max-height:calc(100% - 16px);padding:12px;border-radius:12px}
.uf-zhead-row{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.uf-zclose{width:26px;height:26px;border-color:transparent;background:transparent;color:var(--uf-ink2)}
.uf-zform .uf-zadd{background:var(--uf-accent);border-color:var(--uf-accent);color:var(--uf-on-accent)}
.uf-zform .uf-zadd:hover{background:var(--uf-accent);opacity:.9}
.uf-zform h2{flex:1;min-width:0;margin:0;font-size:14px;font-weight:700}
.uf-zcount{flex:none;font-size:12px;color:var(--uf-ink2)}
.uf-zform .uf-zurls{display:block;width:100%;height:auto;min-height:64px;max-height:160px;resize:vertical;font:inherit;font-size:13px;line-height:1.4;padding:8px}
.uf-zreport{margin-top:8px;padding:8px 10px;border-radius:var(--uf-r);background:var(--uf-warn-soft)}
.uf-zhead{margin:0 0 4px;font-size:12px;font-weight:650;color:var(--uf-warn)}
.uf-zlist{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px;max-height:140px;overflow:auto}
.uf-zlist li{display:flex;flex-direction:column;min-width:0;font-size:12px}
.uf-zurl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,monospace;color:var(--uf-ink)}
.uf-zwhy{color:var(--uf-ink2)}
.uf-zmsg{margin:8px 2px 0;font-size:13px;color:var(--uf-ink2)}
.uf-zmsg.uf-err{color:var(--uf-warn)}
.uf-area{min-width:0;height:34px;min-height:34px;padding:6px 10px;border:1px solid var(--uf-line);border-radius:var(--uf-r);
background:var(--uf-bg);color:var(--uf-ink);font:inherit;font-size:13px;resize:vertical}
.uf-area:focus{height:72px}
.uf-area:focus-visible{outline:2px solid var(--uf-accent);outline-offset:-1px}
.uf-num{flex:1 1 0;width:0;min-width:44px}
.uf-focus .uf-screen:not(.uf-on){opacity:.2}
.uf-editing.uf-focus .uf-screen:not(.uf-on){opacity:.45}
.uf-links{position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none}
.uf-link{fill:none;stroke:var(--uf-accent);stroke-width:2;stroke-linecap:round;opacity:.55;transition:opacity .2s ease-out}
.uf-open{stroke-width:1.5}
.uf-link.uf-on{stroke-width:3;opacity:1}
.uf-back{stroke:var(--uf-muted);stroke-width:2;stroke-dasharray:8 7}
.uf-mk-a{fill:var(--uf-accent)}
.uf-mk-b{fill:var(--uf-muted)}
.uf-labels{position:absolute;left:0;top:0;width:1px;height:1px}
/* notes on the map (memos.js): a sticky note beside the screens, above the arrows */
.uf-pins{position:absolute;left:0;top:0;width:1px;height:1px}
.uf-pin{position:absolute;left:0;top:0;border-radius:12px;color:var(--uf-ink);box-shadow:var(--uf-shadow);
background:color-mix(in srgb,var(--uf-hit) 18%,var(--uf-screen));border:1px solid color-mix(in srgb,var(--uf-hit) 55%,var(--uf-line))}
.uf-pin:focus-within{outline:2px solid var(--uf-accent);outline-offset:2px}
.uf-pinbar{display:flex;align-items:center;user-select:none;-webkit-user-select:none;gap:6px;height:34px;padding:0 6px 0 14px;font-size:13px;font-weight:600;color:var(--uf-ink2)}
.uf-editing .uf-pinbar{cursor:grab;touch-action:none}
.uf-btn.uf-pindel{width:26px;height:26px;padding:0;border:0;background:transparent;color:var(--uf-ink2)}
.uf-pintext{display:block;box-sizing:border-box;width:100%;min-height:64px;margin:0;padding:2px 14px 14px;border:0;outline:0;
background:transparent;color:inherit;font:inherit;font-size:16px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere;resize:none}
.uf-pintext::placeholder{color:var(--uf-ink2)}
.uf-pinname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uf-pinfold .uf-pinname{color:var(--uf-ink)}
.uf-btn.uf-pintog{width:26px;height:26px;padding:0;border:0;background:transparent;color:var(--uf-ink2)}
.uf-pinfold .uf-pintext,.uf-pinfold .uf-pinrsz{display:none}
.uf-pinrsz{position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;touch-action:none;
background:linear-gradient(135deg,transparent 55%,var(--uf-ink2) 55% 62%,transparent 62% 72%,var(--uf-ink2) 72% 79%,transparent 79%);opacity:.6}
.uf-pin:hover .uf-pinrsz{opacity:1}
.uf-pinning .uf-view{cursor:crosshair}
.uf-pinpad{position:absolute;inset:0;z-index:2;cursor:crosshair;touch-action:none}
.uf-pinghost{position:absolute;border:2px dashed var(--uf-accent);border-radius:12px;background:color-mix(in srgb,var(--uf-hit) 14%,transparent)}
.uf-label{position:absolute;left:0;top:0;padding:1px 7px;border-radius:8px;background:var(--uf-bg);color:var(--uf-ink2);
font-size:14px;font-weight:650;white-space:nowrap;pointer-events:none;transition:opacity .2s ease-out}
/* arrow labels: read them zoomed in, or on the flow in hand; zoomed out with nothing picked they are only noise */
.uf-view:not(.uf-near) .uf-label:not(.uf-on){visibility:hidden}
.uf-label.uf-on{color:var(--uf-ink);box-shadow:0 0 0 1px var(--uf-line)}
.uf-focus .uf-link:not(.uf-on),.uf-focus .uf-label:not(.uf-on),.uf-focus .uf-handle:not(.uf-on){opacity:.08}
.uf-panel{position:absolute;top:8px;right:8px;z-index:2;width:min(380px,calc(100% - 16px));max-height:min(60%,520px);
overflow:auto;padding:6px;border-radius:12px;background:var(--uf-screen);box-shadow:0 0 0 1px var(--uf-line),var(--uf-shadow);
animation:uf-in .18s ease-out}
@keyframes uf-in{from{opacity:0;transform:translateY(-6px)}}
.uf-none{margin:0;padding:14px;color:var(--uf-ink2);font-size:13px}
/* prototype: one phone, scaled to fit (--k), centred in the stage; the path walked below it */
.uf-stage{position:relative;flex:1;min-height:0;overflow:hidden}
.uf-phone{position:absolute;left:50%;top:50%;width:var(--uf-w);height:var(--uf-h);margin:calc(var(--uf-h) / -2) 0 0 calc(var(--uf-w) / -2);
transform:scale(var(--k,1));display:flex;flex-direction:column;overflow:hidden;border-radius:54px;background:var(--uf-screen);
box-shadow:0 0 0 ${BEZEL - 1}px var(--uf-bezel),0 0 0 ${BEZEL}px var(--uf-line),var(--uf-shadow);outline:none}
.uf-phone::before,.uf-phone::after{z-index:3;pointer-events:none}
/* a web flow (data-device=web): each frame is a browser window, not a phone: square corners, no notch, no home bar,
 no clock; the same in Prototype, where a long page scrolls inside the window */
.uf-root[data-device=web] .uf-screen,.uf-root[data-device=web] .uf-phone,.uf-root[data-device=web] .uf-shot .uf-card{border-radius:12px}
.uf-root[data-device=web] .uf-shot .uf-head{border-radius:12px 12px 0 0;padding-left:20px}
.uf-root[data-device=web] .uf-screen::before,.uf-root[data-device=web] .uf-screen::after,
.uf-root[data-device=web] .uf-phone::before,.uf-root[data-device=web] .uf-phone::after,.uf-root[data-device=web] .uf-status{display:none}
.uf-status{flex:none;height:${STATUS}px;padding:14px 0 0 40px;font-size:15px;font-weight:650}
.uf-nav{flex:none;display:flex;align-items:center;gap:2px;height:${HEAD}px;padding:0 20px 0 6px;border-bottom:1px solid var(--uf-soft)}
.uf-pback{flex:none;display:grid;place-items:center;width:44px;height:44px;border:0;border-radius:12px;background:none;
color:var(--uf-accent);cursor:pointer}
.uf-pback:active{opacity:.5}
.uf-off{visibility:hidden}
.uf-pbody{position:relative;flex:1;min-height:0;overflow:hidden}
.uf-pscreen{position:absolute;inset:0;overflow-y:auto;overscroll-behavior:contain;padding-bottom:${BOTTOM}px;background:var(--uf-screen)}
.uf-rows{display:flex;flex-direction:column;gap:10px;padding:16px}
.uf-row{position:relative;flex:none;display:block;width:100%;height:52px;padding:0 34px 0 16px;border:1px solid var(--uf-line);
border-radius:14px;background:var(--uf-soft);color:var(--uf-ink);font:inherit;font-size:16px;font-weight:550;line-height:50px;
text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;-webkit-tap-highlight-color:transparent;
transition:transform .1s ease-out,opacity .1s ease-out}
.uf-row:active{transform:scale(.98);opacity:.75}
.uf-row.uf-linked::after{content:"";position:absolute;right:16px;top:50%;width:8px;height:8px;margin-top:-4px;
border-top:2px solid var(--uf-ink2);border-right:2px solid var(--uf-ink2);transform:rotate(45deg)}
.uf-row::before{content:"";position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 0 0 2px var(--uf-warn);opacity:0;
pointer-events:none}
.uf-flash::before{opacity:1}
.uf-row:focus-visible,.uf-pback:focus-visible,.uf-crumb:focus-visible{outline:2px solid var(--uf-accent);outline-offset:2px}
/* prototype on a Zeplin image: the phone's own bars step aside; tap areas show on hover / focus, all of them after a tap on none */
.uf-full .uf-status,.uf-full .uf-nav,.uf-phone.uf-full::before,.uf-phone.uf-full::after{display:none}
.uf-pshot{position:relative}
.uf-phot{position:absolute;padding:0;border:0;border-radius:10px;background:transparent;cursor:pointer;
-webkit-tap-highlight-color:transparent}
.uf-phot{transition:background .15s ease-out,box-shadow .15s ease-out}
.uf-phot:hover,.uf-hints .uf-phot{background:var(--uf-accent-soft);box-shadow:inset 0 0 0 2px var(--uf-accent)}
.uf-phot:active{opacity:.6}
.uf-phot:focus-visible{outline:2px solid var(--uf-accent);outline-offset:2px}
.uf-phot::before{content:"";position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 0 0 2px var(--uf-warn);opacity:0;
pointer-events:none}
.uf-fullov .uf-pscreen{position:absolute;inset:0}
.uf-phone:focus-visible{outline:2px solid var(--uf-accent);outline-offset:${BEZEL + 4}px}
.uf-overlay{position:absolute;inset:0;z-index:2}
.uf-overlay.uf-toast,.uf-leaving{pointer-events:none}
.uf-backdrop{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:0 35px}
.uf-sheet .uf-backdrop{align-items:flex-end;padding:0}
.uf-scrim{position:absolute;inset:0;background:rgba(10,12,16,.45)}
.uf-pcard{position:relative;width:100%;max-height:80%;overflow-y:auto;border-radius:22px;background:var(--uf-screen);
box-shadow:var(--uf-shadow);outline:none}
.uf-overlay:not(.uf-toast) .uf-pcard.uf-empty{min-height:130px}
.uf-pcard>.uf-title{padding:20px 20px 0}
.uf-pcard .uf-rows{padding:14px 16px 18px}
.uf-sheet .uf-pcard{border-radius:28px 28px 0 0;padding-bottom:${BOTTOM - 16}px}
.uf-toast .uf-pcard{position:absolute;left:24px;right:24px;bottom:56px;width:auto;border-radius:16px;pointer-events:auto;
background:var(--uf-ink);color:var(--uf-screen)}
.uf-toast .uf-pcard>.uf-title{padding:14px 18px;font-size:15px}
.uf-root[data-device=web] .uf-popup .uf-pcard{max-width:480px}
.uf-root[data-device=web] .uf-toast .uf-pcard{left:auto;right:24px;width:360px}
.uf-trail{flex:none;display:flex;align-items:center;gap:8px;padding:8px 10px;border-top:1px solid var(--uf-line);
background:var(--uf-screen)}
.uf-nostart{flex:none;color:var(--uf-warn);font-size:12px}
.uf-crumbs{flex:1;min-width:0;display:flex;align-items:center;overflow-x:auto;white-space:nowrap;scrollbar-width:none}
.uf-crumb{flex:none;padding:4px 8px;border:0;border-radius:8px;background:none;color:var(--uf-ink2);font:inherit;font-size:13px;
cursor:pointer}
.uf-crumb:hover:not(:disabled){background:var(--uf-soft);color:var(--uf-ink)}
.uf-crumb:disabled{color:var(--uf-ink);font-weight:650;cursor:default}
.uf-sep{flex:none;color:var(--uf-muted)}
/* edit mode (Sửa): drag handles, dots, selection, the properties panel */
.uf-root:not(.uf-editing) .uf-add,.uf-root[data-mode=play] .uf-add,.uf-root[data-mode=play] .uf-editbtn,
.uf-root[data-mode=play] .uf-insp{display:none}
.uf-dot{position:absolute;z-index:60;width:14px;height:14px;margin:-7px 0 0 -7px;padding:0;border:2px solid var(--uf-screen);
border-radius:50%;background:var(--uf-accent);box-shadow:0 1px 3px rgba(16,24,40,.3);cursor:crosshair;touch-action:none}
.uf-dot:hover{transform:scale(1.25)}
/* link dots: on the frame under the pointer or in hand, not on all of them at once */
.uf-dot{opacity:0;transition:opacity .15s ease-out}
.uf-screen:hover .uf-dot,.uf-screen.uf-sel .uf-dot,.uf-screen.uf-on .uf-dot,.uf-dot:focus-visible{opacity:1}
.uf-handle{fill:var(--uf-screen);stroke:var(--uf-accent);stroke-width:3;pointer-events:auto;cursor:grab;touch-action:none}
.uf-handle:hover{fill:var(--uf-accent-soft)}
.uf-editing .uf-label{pointer-events:auto;cursor:text}
.uf-editing .uf-head{cursor:move}
.uf-temp{fill:none;stroke:var(--uf-accent);stroke-width:2.5;stroke-dasharray:7 6;stroke-linecap:round;pointer-events:none}
.uf-screen.uf-sel{box-shadow:0 0 0 3px var(--uf-accent),var(--uf-shadow)}
/* an overlay's frame is the whole phone under it: the ring goes on its card */
.uf-ov.uf-sel,.uf-ov.uf-match{box-shadow:none}
.uf-ov.uf-sel .uf-card{outline:3px solid var(--uf-accent)}
/* the button / tap area in hand (or pointed at in the panel's list): filled, ringed, above its neighbours */
.uf-root .uf-item.uf-sel,.uf-root .uf-item.uf-peek{z-index:1;border:2px solid var(--uf-accent);background:color-mix(in srgb,var(--uf-accent) 26%,transparent);box-shadow:0 0 0 4px color-mix(in srgb,var(--uf-accent) 30%,transparent),0 6px 18px -6px var(--uf-accent)}
.uf-screen:has(.uf-item.uf-sel) .uf-item:not(.uf-sel){opacity:.45}
.uf-link.uf-sel{stroke-width:5;opacity:1}
.uf-edit-on{background:var(--uf-screen);box-shadow:0 0 0 2px var(--uf-accent);cursor:text;text-overflow:clip;
user-select:text;-webkit-user-select:text}
.uf-insp{position:absolute;left:10px;bottom:10px;z-index:2;display:flex;flex-direction:column;width:min(320px,calc(100% - 20px));
max-height:calc(100% - 64px);overflow:hidden;border-radius:14px;background:var(--uf-screen);
box-shadow:0 0 0 1px var(--uf-line),var(--uf-shadow);animation:uf-in .18s ease-out}
.uf-insp[hidden]{display:none}
.uf-ihead{flex:none;display:flex;align-items:center;gap:2px;padding:10px 8px;border-bottom:1px solid var(--uf-line);
background:linear-gradient(180deg,color-mix(in srgb,var(--uf-kind,var(--uf-accent)) 12%,transparent),transparent)}
.uf-ititle{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;padding:0 6px}
.uf-ieye{display:flex;align-items:center;gap:6px;min-width:0;font-size:12px;color:var(--uf-ink2)}
.uf-ihome{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uf-ihead [data-tip]::after{top:calc(100% + 6px);left:auto;right:0;transform:none;max-width:240px;white-space:normal;width:max-content}
.uf-ihead [data-tip]:first-child::after{left:0;right:auto}
.uf-ihead h2{margin:0;font-size:15px;font-weight:700;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uf-ihead .uf-btn{flex:none;width:28px;height:28px;border-color:transparent;background:transparent;color:var(--uf-ink2)}
.uf-ihead .uf-btn:hover{color:var(--uf-ink)}
.uf-ihead .uf-btn:hover{background:var(--uf-soft)}
.uf-ihead .uf-danger:hover{background:color-mix(in srgb,var(--uf-bad) 14%,transparent)}
.uf-itag{flex:none;padding:1px 8px;border-radius:999px;background:color-mix(in srgb,var(--uf-kind,var(--uf-accent)) 18%,transparent);
color:var(--uf-kind,var(--uf-accent));font-size:11px;font-weight:700;line-height:18px}
.uf-ibody{display:flex;flex-direction:column;gap:12px;min-height:0;overflow:auto;padding:12px}
.uf-pick{position:relative;display:flex;gap:0}
.uf-pick .uf-btn{position:relative;flex:1;min-width:0;padding:0 6px;font-size:12px;transition:color .2s ease-out}
.uf-pick .uf-btn[aria-pressed=true]{background:transparent}
/* the selected segment's fill: one pill that slides (and takes the new kind's colour) instead of jumping */
.uf-pill{position:absolute;left:2px;top:2px;bottom:2px;border-radius:5px;background:var(--uf-kind,var(--uf-fill));
pointer-events:none;transition:transform .32s cubic-bezier(.3,1.35,.5,1),background-color .32s ease-out}
/* a frame whose kind was just changed settles into its new shape */
.uf-morph .uf-card{animation:uf-morph .32s cubic-bezier(.3,1.35,.5,1)}
@keyframes uf-morph{from{opacity:.25;transform:scale(.92)}}
.uf-ihead .uf-start{font-size:11px;color:var(--uf-ink2)}
.uf-ihead .uf-start[aria-pressed=true]{background:var(--uf-accent);color:var(--uf-on-accent)}
.uf-chips{display:flex;flex-wrap:wrap;gap:4px}
/* a button's ways out: one card each (the act's icon in its colour, where it goes, how); open: its act and the rest */
.uf-routes{display:flex;flex-direction:column;gap:6px;min-width:0}
.uf-route{--uf-act:var(--uf-accent);border:1px solid var(--uf-line);border-radius:10px;background:var(--uf-screen);
transition:border-color .15s ease-out,box-shadow .15s ease-out}
.uf-route:hover{border-color:var(--uf-muted)}
.uf-route.uf-open{border-color:color-mix(in srgb,var(--uf-accent) 60%,var(--uf-line));box-shadow:0 0 0 3px var(--uf-accent-soft)}
.uf-a-open{--uf-act:var(--uf-c-popup)}
.uf-a-back,.uf-a-close{--uf-act:var(--uf-ink2)}
.uf-rhead{display:flex;align-items:center;gap:2px;min-width:0;padding:4px}
.uf-rgo{flex:1;min-width:0;display:flex;align-items:center;gap:10px;height:auto;padding:2px 6px 2px 2px;border:0;background:transparent;text-align:left}
.uf-rgo:hover{background:transparent}
.uf-rgo>svg{flex:none;color:var(--uf-ink2);transition:transform .2s ease-out}
.uf-open .uf-rgo>svg{transform:rotate(180deg)}
.uf-ract{flex:none;display:grid;place-items:center;width:32px;height:32px;border-radius:8px;
background:color-mix(in srgb,var(--uf-act) 14%,transparent);color:var(--uf-act)}
.uf-rtxt{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.uf-rto,.uf-rsub{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uf-rto{font-size:13px;font-weight:600;color:var(--uf-ink)}
.uf-rsub{font-size:12px;font-weight:400;color:var(--uf-ink2)}
.uf-btn.uf-rdel{flex:none;width:28px;height:28px;padding:0;border-color:transparent;background:transparent;color:var(--uf-ink2)}
.uf-btn.uf-rdel:hover{background:color-mix(in srgb,var(--uf-bad) 12%,transparent);color:var(--uf-bad)}
.uf-rbody{display:flex;flex-direction:column;gap:8px;padding:4px 10px 10px}
.uf-btn.uf-rmore{display:flex;align-items:center;justify-content:space-between;width:100%;height:32px;padding:0 8px 0 10px;
background:var(--uf-bg);font-weight:500}
.uf-rmore svg{color:var(--uf-ink2)}
.uf-rnone{margin:0;padding:12px;border:1px dashed var(--uf-line);border-radius:10px;font-size:12px;line-height:1.45;
color:var(--uf-ink2);text-align:center}
.uf-link.uf-peek{stroke-width:5;opacity:1}
.uf-chips .uf-btn{height:26px;padding:0 10px;font-size:12px;max-width:100%;overflow:hidden;text-overflow:ellipsis;display:block}
/* a field: its name beside its box, every box on one edge (the panel stays short over the map); a section
 * (.uf-sec: a button's ways out) has its name over a list as wide as the panel */
.uf-field{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;min-width:0}
.uf-flab{flex:none;width:72px;color:var(--uf-ink2);font-size:12px;font-weight:600}
.uf-field>.uf-input,.uf-field>.uf-area,.uf-field>.uf-chips,.uf-field>.uf-nums{flex:1}
.uf-field.uf-sec{flex-direction:column;align-items:stretch;flex-wrap:nowrap}
.uf-sec>.uf-flab{width:auto}
.uf-nums{min-width:0;display:flex;gap:6px}
.uf-input{min-width:0;height:32px;padding:0 10px;border:1px solid var(--uf-line);border-radius:var(--uf-r);
background:var(--uf-bg);color:var(--uf-ink);font:inherit;font-size:13px;transition:border-color .15s ease-out}
.uf-input:hover,.uf-area:hover{border-color:var(--uf-muted)}
.uf-input:focus-visible{outline:2px solid var(--uf-accent);outline-offset:-1px}
.uf-acts{display:flex;gap:6px}
.uf-chips .uf-addchip{border-style:dashed;color:var(--uf-accent)}
.uf-ifoot{flex:none;display:flex;gap:6px;padding:10px 12px;border-top:1px solid var(--uf-line);background:var(--uf-bg)}
.uf-ifoot .uf-btn{flex:1;min-width:0;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px}
.uf-ifoot .uf-btn svg{flex:none;color:var(--uf-accent)}
.uf-ifoot .uf-btn span{overflow:hidden;text-overflow:ellipsis}
.uf-zform .uf-acts{margin-top:10px}
.uf-bad{display:none;flex-basis:100%;padding-left:82px;color:var(--uf-warn);font-size:12px}
.uf-has-bad .uf-bad{display:block}
.uf-has-bad .uf-input{border-color:var(--uf-warn)}
.uf-note{position:absolute;left:50%;bottom:16px;z-index:3;max-width:calc(100% - 32px);padding:8px 14px;
border-radius:999px;background:var(--uf-ink);color:var(--uf-screen);font-size:13px;font-weight:600;
transform:translateX(-50%);animation:uf-in .18s ease-out}
.uf-btn:disabled{opacity:.45;cursor:not-allowed}
.uf-root .uf-danger{color:var(--uf-bad)}
/* an exported file: the shell carries no CSS, so the engine makes its host fill the viewport (insets kept clear) */
.uf-file,.uf-file body{height:100%;margin:0;overflow:hidden}
.uf-file #uiflow{position:fixed;inset:0;box-sizing:border-box;padding:env(safe-area-inset-top,0px)
env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)}
@media (prefers-reduced-motion:reduce){.uf-root *,.uf-root *::before,.uf-root *::after{transition:none!important;animation:none!important}}
`;
function injectStyle() {
  if (document.getElementById("uf-style")) return;
  const s = h("style", null, CSS);
  s.id = "uf-style";
  document.head.append(s);
}

/** The app tokens the palette reads: what a host resolves and sends along for an exported file to look the same. */
const APP_TOKENS = [...new Set(TOKENS.map((x) => x[1]))];

export { APP_TOKENS, DARK, CSS, injectStyle };
