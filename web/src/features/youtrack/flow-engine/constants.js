

// ------------------------------------------------------------------ constants
const SCREEN = Object.freeze({ w: 390, h: 844 });
// the frame of each device (= Flow.device): a phone, or a browser window a web design is drawn in at its own width
const FRAMES = Object.freeze({ mobile: SCREEN, web: Object.freeze({ w: 1280, h: 800 }) });
let DEVICE = "mobile", W = SCREEN.w, H = SCREEN.h;
let COL = W + 220, ROW = H + 120;
// column / row step
const SHIFT = 60;
// overlay offset from its parent
/** The frame every screen of the flow in hand is drawn in. Importers read W / H / COL / ROW live, so geometry,
 *  layout, the editor and Prototype all follow.
 *  ponytail: one device per page, like the images (shots.js); a frame per mount if two flows ever share a page */
function setDevice(device) {
  DEVICE = device === "web" ? "web" : "mobile";
  ({ w: W, h: H } = FRAMES[DEVICE]);
  COL = W + 220;
  ROW = H + 120;
  return DEVICE;
}
const GROUP_GAP = 200;
// extra space between the main flow, each separate group and the loose screens
const LABEL_HIDE = 0.6;
// from this zoom up the in-frame title (17px) reads at 10px+: the frame labels step aside
const STATUS = 44, HEAD = 56, TOP = 120, BOTTOM = 40, FOLD_SLACK = 4;
const TALL = 1.1, FIT_TALL = 2, MIN_FOLD = 200; // MIN_FOLD: the lowest a folded design is drawn
// a design this many phones high (a page that scrolls) is drawn whole; "fit" counts at most FIT_TALL of them, so one
// eight-screen page does not shrink every other frame to a dot
// phone: status bar, nav bar, first row, home bar
const CARD_HEAD = 60, CARD_PAD = 20, STEP = 64;
// overlay card header, bottom padding; max row step
const ZMIN = 0.1, ZMAX = 2, PAD = 32, ANIM_MS = 220;
const FOCUS = 0.18; // a screen brought into view: this much of its size left round it each side
const SLIDE_MS = 200, TOAST_MS = 2000, FLASH_MS = 600, HINT_MS = 450, BEZEL = 11, GAP = 16;
// prototype: motion, phone bezel, margin
const NOTE_MS = 2600;
// edit: how long a refusal note stays up
const MERGE_MS = 1000;
// arrow-key steps closer than this make one undo step
const CAP = 80, UNDO = 50, DRAG_PX = 4;
// edit: schema cap for a title / label / condition, undo depth, tap slop
const CAP_AC = 40, CAP_URL = 300;
// the backend model's caps: it truncates silently, so never store more
const MAX_SCREENS = 200, MAX_ITEMS = 40, MAX_LINKS = 1000, MAX_MEMOS = 50; // MAX_MEMOS = uiflow.MAX_MEMOS
// past these the backend refuses the whole file
const VERSION = 2, CAP_NOTE = 4000, CAP_TITLE = 120; // CAP_TITLE: the flow's own name (= Flow.title)
// = uiflow.VERSION / MAX_NOTE: v1 is read as v2, a newer file is refused
const KINDS = ["screen", "popup", "sheet", "toast"];
const ACTS = ["navigate", "open", "back", "close"];
const ZEPLIN = /^https?:\/\/(?:zpl\.io|app\.zeplin\.io|scene\.zeplin\.io)\/\S+$/;
// = providers.ZEPLIN
const SVGNS = "http://www.w3.org/2000/svg";

export { MIN_FOLD, SCREEN, FRAMES, DEVICE, setDevice, W, H, COL, ROW, SHIFT, GROUP_GAP, LABEL_HIDE, STATUS, HEAD, TOP, BOTTOM, FOLD_SLACK, TALL, FIT_TALL, CARD_HEAD, CARD_PAD, STEP, ZMIN, ZMAX, PAD, ANIM_MS, FOCUS, SLIDE_MS, TOAST_MS, FLASH_MS, HINT_MS, BEZEL, GAP, NOTE_MS, MERGE_MS, CAP, UNDO, DRAG_PX, CAP_AC, CAP_URL, MAX_SCREENS, MAX_ITEMS, MAX_LINKS, MAX_MEMOS, VERSION, CAP_NOTE, CAP_TITLE, KINDS, ACTS, ZEPLIN, SVGNS };
