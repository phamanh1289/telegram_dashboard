import { BEZEL, BOTTOM, H, HEAD, STATUS, W } from './constants.js';
import { h } from './dom.js';

// ------------------------------------------------------------------ styles (injected once)
const DARK = "--uf-bg:#0d0f14;--uf-screen:#181b22;--uf-ink:#e8eaee;--uf-ink2:#9aa1ad;--uf-line:#2c313b;" +
  "--uf-soft:#22262e;--uf-accent:#8b8cf8;--uf-on-accent:#0d0f14;--uf-accent-soft:rgba(139,140,248,.16);" +
  "--uf-muted:#697282;--uf-bezel:#2e333c;--uf-hit:#facc15;--uf-hit-soft:rgba(250,204,21,.2);--uf-warn:#fb923c;--uf-warn-soft:rgba(251,146,60,.14);" +
  "--uf-shadow:0 1px 2px rgba(0,0,0,.4),0 18px 44px -14px rgba(0,0,0,.7);color-scheme:dark";
const CSS = `
.uf-root{--uf-bg:#f3f4f7;--uf-screen:#fff;--uf-ink:#111827;--uf-ink2:#6b7280;--uf-line:#d9dce3;--uf-soft:#f1f3f6;
--uf-accent:#4f46e5;--uf-on-accent:#fff;--uf-bezel:#1b1d22;--uf-accent-soft:rgba(79,70,229,.1);--uf-muted:#9aa1ad;--uf-warn:#c2410c;
--uf-warn-soft:rgba(234,88,12,.1);--uf-hit:#eab308;--uf-hit-soft:rgba(234,179,8,.22);--uf-shadow:0 1px 2px rgba(16,24,40,.06),0 18px 44px -14px rgba(16,24,40,.22);
position:relative;display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;background:var(--uf-bg);
color:var(--uf-ink);font:15px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
-webkit-font-smoothing:antialiased}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .uf-root{${DARK}}}
[data-theme=dark] .uf-root{${DARK}}
.uf-root *{box-sizing:border-box}
.uf-bar{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:8px 10px;background:var(--uf-screen);
border-bottom:1px solid var(--uf-line)}
.uf-sp{flex:1}
.uf-btn{height:32px;padding:0 13px;border:1px solid var(--uf-line);border-radius:999px;background:var(--uf-screen);
color:var(--uf-ink);font:inherit;font-size:13px;font-weight:600;white-space:nowrap;cursor:pointer}
.uf-btn:hover{background:var(--uf-soft)}
.uf-btn:active{transform:scale(.97)}
.uf-btn[aria-pressed=true]{background:var(--uf-accent);border-color:var(--uf-accent);color:var(--uf-on-accent)}
.uf-seg{display:inline-flex;gap:2px;padding:2px;border:1px solid var(--uf-line);border-radius:999px;background:var(--uf-soft)}
.uf-seg .uf-btn{height:26px;border:0;background:transparent;color:var(--uf-ink2)}
.uf-seg .uf-btn[aria-pressed=true]{background:var(--uf-screen);color:var(--uf-ink);box-shadow:0 1px 3px rgba(16,24,40,.18)}
.uf-main{position:relative;flex:1;min-height:0}
.uf-view{position:absolute;inset:0;overflow:hidden;touch-action:none;cursor:grab;user-select:none;-webkit-user-select:none;outline:none}
.uf-btn:focus-visible,.uf-issue:focus-visible,.uf-zeplin:focus-visible{outline:2px solid var(--uf-accent);outline-offset:2px}
.uf-view:focus-visible{outline:2px solid var(--uf-accent);outline-offset:-2px}
.uf-view.uf-moving{cursor:grabbing}
.uf-layer{position:absolute;left:0;top:0;transform-origin:0 0}
.uf-moving .uf-layer{will-change:transform}
.uf-play{position:absolute;inset:0;display:none}
.uf-root[data-mode=play] .uf-view{display:none}
.uf-root[data-mode=play] .uf-play{display:flex;flex-direction:column}
.uf-root[data-mode=play] .uf-fit{display:none}
.uf-screen{position:absolute;left:0;top:0;width:${W}px;height:${H}px;border-radius:54px;background:var(--uf-screen);
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
.uf-img{display:block;width:100%;max-width:none;user-select:none;-webkit-user-select:none;-webkit-user-drag:none}
.uf-shot .uf-head{border-radius:54px 54px 0 0;padding-left:44px;background:color-mix(in srgb,var(--uf-screen) 88%,transparent);
border-bottom:1px solid var(--uf-line)}
.uf-item.uf-hot{padding:0 6px;border:2px solid var(--uf-accent);border-radius:10px;background:var(--uf-accent-soft);
color:transparent;font-size:13px}
.uf-item.uf-hot::after{content:none}
.uf-root .uf-hot.uf-dead{border-color:var(--uf-warn);background:transparent;color:transparent}
.uf-hot.uf-edit-on{color:var(--uf-ink)}
.uf-editing .uf-rect{cursor:move}
.uf-rsz{display:none;position:absolute;right:0;bottom:0;width:14px;height:14px;border:2px solid var(--uf-screen);
border-radius:4px;background:var(--uf-accent);cursor:nwse-resize;touch-action:none}
.uf-editing .uf-rect.uf-sel .uf-rsz{display:block}
.uf-drawing .uf-screen.uf-drawon{cursor:crosshair}
.uf-drawing .uf-screen.uf-drawon .uf-imgbox{outline:3px dashed var(--uf-accent);outline-offset:-3px}
.uf-startb{flex:none;display:grid;place-items:center;width:24px;height:24px;border-radius:7px;background:var(--uf-accent);
color:var(--uf-on-accent);font-size:11px}
.uf-ptabs{display:flex;gap:4px;padding:4px 4px 6px}
.uf-pfilter{display:flex;flex-wrap:wrap;gap:4px;padding:0 4px 6px}
.uf-pfilter .uf-btn,.uf-ptabs .uf-btn{height:26px;padding:0 10px;font-size:12px}
.uf-paths{margin:0;padding:4px 10px 6px 28px;font-size:13px;line-height:1.45}
.uf-paths li{margin:4px 0;overflow-wrap:anywhere}
.uf-memo{flex:none;display:grid;place-items:center;width:24px;height:24px;border-radius:7px;background:var(--uf-hit-soft);
color:var(--uf-ink);font-size:14px;cursor:help}
.uf-screen.uf-match{box-shadow:0 0 0 5px var(--uf-hit),var(--uf-shadow)}
.uf-ov.uf-match .uf-card{box-shadow:0 0 0 5px var(--uf-hit),var(--uf-shadow)}
.uf-find{position:relative;flex:0 1 260px;min-width:140px}
.uf-find .uf-input{width:100%;height:32px;border-radius:999px;padding:0 12px}
.uf-results{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:4;max-height:320px;overflow:auto;padding:4px;
border-radius:12px;background:var(--uf-screen);box-shadow:0 0 0 1px var(--uf-line),var(--uf-shadow)}
.uf-res{display:block;width:100%;padding:7px 10px;border:0;border-radius:8px;background:none;color:inherit;font:inherit;
font-size:13px;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}
.uf-res[aria-selected=true],.uf-res:hover{background:var(--uf-accent-soft)}
.uf-count{padding:4px 10px;color:var(--uf-ink2);font-size:12px}
.uf-zform{padding:10px}
.uf-zform h2{margin:0 0 6px;font-size:13px;font-weight:700}
.uf-zform .uf-field{margin-top:4px}
.uf-zmsg{margin:8px 2px 0;font-size:13px;color:var(--uf-ink2)}
.uf-zmsg.uf-err{color:var(--uf-warn)}
.uf-area{flex:1;min-width:0;min-height:72px;padding:6px 9px;border:1px solid var(--uf-line);border-radius:9px;
background:var(--uf-bg);color:var(--uf-ink);font:inherit;font-size:13px;resize:vertical}
.uf-area:focus-visible{outline:2px solid var(--uf-accent);outline-offset:-1px}
.uf-num{flex:1 1 52px;min-width:52px}
.uf-focus .uf-screen:not(.uf-on){opacity:.2}
.uf-links{position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none}
.uf-link{fill:none;stroke:var(--uf-accent);stroke-width:3;stroke-linecap:round;transition:opacity .2s ease-out}
.uf-open{stroke-width:1.75}
.uf-back{stroke:var(--uf-muted);stroke-width:2;stroke-dasharray:8 7}
.uf-mk-a{fill:var(--uf-accent)}
.uf-mk-b{fill:var(--uf-muted)}
.uf-labels{position:absolute;left:0;top:0;width:1px;height:1px}
.uf-label{position:absolute;left:0;top:0;padding:1px 7px;border-radius:8px;background:var(--uf-bg);color:var(--uf-ink2);
font-size:14px;font-weight:650;white-space:nowrap;pointer-events:none;transition:opacity .2s ease-out}
.uf-focus .uf-link:not(.uf-on),.uf-focus .uf-label:not(.uf-on){opacity:.08}
.uf-panel{position:absolute;top:8px;right:8px;z-index:2;width:min(380px,calc(100% - 16px));max-height:min(60%,520px);
overflow:auto;padding:6px;border-radius:16px;background:var(--uf-screen);box-shadow:0 0 0 1px var(--uf-line),var(--uf-shadow);
animation:uf-in .18s ease-out}
@keyframes uf-in{from{opacity:0;transform:translateY(-6px)}}
.uf-issue{display:flex;align-items:flex-start;gap:10px;width:100%;padding:9px 10px;border:0;border-radius:10px;background:none;
color:inherit;font:inherit;font-size:13px;text-align:left;cursor:pointer}
.uf-issue:hover{background:var(--uf-soft)}
.uf-txt{min-width:0;overflow-wrap:anywhere}
.uf-tag{flex:none;padding:1px 8px;border-radius:999px;background:var(--uf-soft);color:var(--uf-ink2);font-size:11px;font-weight:700}
.uf-tag-orphan,.uf-tag-dead,.uf-tag-broken{background:var(--uf-warn-soft);color:var(--uf-warn)}
.uf-none{margin:0;padding:14px;color:var(--uf-ink2);font-size:13px}
/* prototype: one phone, scaled to fit (--k), centred in the stage; the path walked below it */
.uf-stage{position:relative;flex:1;min-height:0;overflow:hidden}
.uf-phone{position:absolute;left:50%;top:50%;width:${W}px;height:${H}px;margin:${-H / 2}px 0 0 ${-W / 2}px;
transform:scale(var(--k,1));display:flex;flex-direction:column;overflow:hidden;border-radius:54px;background:var(--uf-screen);
box-shadow:0 0 0 ${BEZEL - 1}px var(--uf-bezel),0 0 0 ${BEZEL}px var(--uf-line),var(--uf-shadow);outline:none}
.uf-phone::before,.uf-phone::after{z-index:3;pointer-events:none}
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
/* prototype on a Zeplin image: the phone's own bars step aside; tap areas show on hover / focus */
.uf-full .uf-status,.uf-full .uf-nav,.uf-phone.uf-full::before,.uf-phone.uf-full::after{display:none}
.uf-pshot{position:relative}
.uf-phot{position:absolute;padding:0;border:0;border-radius:10px;background:transparent;cursor:pointer;
-webkit-tap-highlight-color:transparent}
.uf-phot:hover{background:var(--uf-accent-soft);box-shadow:inset 0 0 0 2px var(--uf-accent)}
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
.uf-trail{flex:none;display:flex;align-items:center;gap:8px;padding:8px 10px;border-top:1px solid var(--uf-line);
background:var(--uf-screen)}
.uf-crumbs{flex:1;min-width:0;display:flex;align-items:center;overflow-x:auto;white-space:nowrap;scrollbar-width:none}
.uf-crumb{flex:none;padding:4px 8px;border:0;border-radius:8px;background:none;color:var(--uf-ink2);font:inherit;font-size:13px;
cursor:pointer}
.uf-crumb:hover:not(:disabled){background:var(--uf-soft);color:var(--uf-ink)}
.uf-crumb:disabled{color:var(--uf-ink);font-weight:650;cursor:default}
.uf-sep{flex:none;color:var(--uf-muted)}
/* edit mode (Sửa): drag handles, dots, selection, the properties panel */
.uf-root:not(.uf-editing) .uf-add,.uf-root[data-mode=play] .uf-add,.uf-root[data-mode=play] .uf-editbtn,
.uf-root[data-mode=play] .uf-insp{display:none}
.uf-dot{position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;padding:0;border:2px solid var(--uf-screen);
border-radius:50%;background:var(--uf-accent);box-shadow:0 1px 3px rgba(16,24,40,.3);cursor:crosshair;touch-action:none}
.uf-dot:hover{transform:scale(1.25)}
.uf-handle{fill:var(--uf-screen);stroke:var(--uf-accent);stroke-width:3;pointer-events:auto;cursor:grab;touch-action:none}
.uf-handle:hover{fill:var(--uf-accent-soft)}
.uf-editing .uf-label{pointer-events:auto;cursor:text}
.uf-editing .uf-head{cursor:move}
.uf-temp{fill:none;stroke:var(--uf-accent);stroke-width:2.5;stroke-dasharray:7 6;stroke-linecap:round;pointer-events:none}
.uf-screen.uf-sel{box-shadow:0 0 0 3px var(--uf-accent),var(--uf-shadow)}
.uf-item.uf-sel{border-color:var(--uf-accent);box-shadow:0 0 0 2px var(--uf-accent-soft)}
.uf-link.uf-sel{stroke-width:5}
.uf-edit-on{background:var(--uf-screen);box-shadow:0 0 0 2px var(--uf-accent);cursor:text;text-overflow:clip;
user-select:text;-webkit-user-select:text}
.uf-insp{position:absolute;left:8px;bottom:8px;z-index:2;width:min(320px,calc(100% - 16px));max-height:calc(100% - 16px);overflow:auto;padding:10px;
border-radius:16px;background:var(--uf-screen);box-shadow:0 0 0 1px var(--uf-line),var(--uf-shadow);animation:uf-in .18s ease-out}
.uf-insp h2{margin:0 0 8px;font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uf-chips{display:flex;flex-wrap:wrap;gap:4px}
.uf-chips .uf-btn{height:26px;padding:0 10px;font-size:12px}
.uf-field{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:8px}
.uf-flab{flex:none;width:62px;color:var(--uf-ink2);font-size:12px;font-weight:650}
.uf-input{flex:1;min-width:0;height:28px;padding:0 9px;border:1px solid var(--uf-line);border-radius:9px;
background:var(--uf-bg);color:var(--uf-ink);font:inherit;font-size:13px}
.uf-input:focus-visible{outline:2px solid var(--uf-accent);outline-offset:-1px}
.uf-acts{display:flex;gap:6px;margin-top:10px}
.uf-bad{display:none;flex-basis:100%;padding:4px 0 0 70px;color:var(--uf-warn);font-size:12px}
.uf-has-bad .uf-bad{display:block}
.uf-has-bad .uf-input{border-color:var(--uf-warn)}
.uf-note{position:absolute;left:50%;bottom:16px;z-index:3;max-width:calc(100% - 32px);padding:8px 14px;
border-radius:999px;background:var(--uf-ink);color:var(--uf-screen);font-size:13px;font-weight:600;
transform:translateX(-50%);animation:uf-in .18s ease-out}
.uf-btn:disabled{opacity:.45;cursor:not-allowed}
.uf-danger{border-color:var(--uf-warn);color:var(--uf-warn)}
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

export { DARK, CSS, injectStyle };
