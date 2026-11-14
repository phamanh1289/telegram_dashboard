

// ------------------------------------------------------------------ constants
const SCREEN = Object.freeze({ w: 390, h: 844 });
const W = SCREEN.w, H = SCREEN.h;
const COL = W + 220, ROW = H + 120, SHIFT = 60;
// column / row step; overlay offset from its parent
const GROUP_GAP = 200;
// extra space between the main flow, each separate group and the loose screens
const LABEL_HIDE = 0.6;
// from this zoom up the in-frame title (17px) reads at 10px+: the frame labels step aside
const STATUS = 44, HEAD = 56, TOP = 120, BOTTOM = 40;
// phone: status bar, nav bar, first row, home bar
const CARD_HEAD = 60, CARD_PAD = 20, STEP = 64;
// overlay card header, bottom padding; max row step
const ZMIN = 0.1, ZMAX = 2, PAD = 32, ANIM_MS = 220;
const SLIDE_MS = 200, TOAST_MS = 2000, FLASH_MS = 600, BEZEL = 11, GAP = 16;
// prototype: motion, phone bezel, margin
const NOTE_MS = 2600;
// edit: how long a refusal note stays up
const MERGE_MS = 1000;
// arrow-key steps closer than this make one undo step
const CAP = 80, UNDO = 50, DRAG_PX = 4;
// edit: schema cap for a title / label / condition, undo depth, tap slop
const CAP_AC = 40, CAP_URL = 300;
// the backend model's caps: it truncates silently, so never store more
const MAX_SCREENS = 60, MAX_ITEMS = 20, MAX_LINKS = 300;
// past these the backend refuses the whole file
const VERSION = 2, CAP_NOTE = 4000;
// = uiflow.VERSION / MAX_NOTE: v1 is read as v2, a newer file is refused
const KINDS = ["screen", "popup", "sheet", "toast"];
const ACTS = ["navigate", "open", "back", "close"];
const ZEPLIN = /^https?:\/\/(?:zpl\.io|app\.zeplin\.io|scene\.zeplin\.io)\/\S+$/;
// = providers.ZEPLIN
const SVGNS = "http://www.w3.org/2000/svg";

export { SCREEN, W, H, COL, ROW, SHIFT, GROUP_GAP, LABEL_HIDE, STATUS, HEAD, TOP, BOTTOM, CARD_HEAD, CARD_PAD, STEP, ZMIN, ZMAX, PAD, ANIM_MS, SLIDE_MS, TOAST_MS, FLASH_MS, BEZEL, GAP, NOTE_MS, MERGE_MS, CAP, UNDO, DRAG_PX, CAP_AC, CAP_URL, MAX_SCREENS, MAX_ITEMS, MAX_LINKS, VERSION, CAP_NOTE, KINDS, ACTS, ZEPLIN, SVGNS };
