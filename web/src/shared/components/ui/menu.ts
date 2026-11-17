// Shared look of the row menus (base-ui Menu): ⋯, Hoãn, Nhắc lại, Đính kèm.
// `grid-cols-1` (minmax(0,1fr)): without it the implicit `auto` column grows to the widest nowrap line and items spill
// out of the popup's width (keys / separators drawn outside it).
export const MENU_POPUP = "grid grid-cols-1 origin-(--transform-origin) gap-0.5 rounded-lg bg-cotton p-1 shadow-pop outline-none transition-[transform,opacity] duration-(--dur-short) ease-(--ease-out) data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0";
export const MENU_ITEM = "cursor-default rounded-md px-2.5 py-1.5 outline-none select-none data-highlighted:bg-paper-2";
/** An action row: icon · label · optional key, highlighted in ink. */
export const MENU_ACTION = "flex items-center gap-2.5 text-ink-2 data-highlighted:text-ink data-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ink-3 data-highlighted:[&_svg]:text-ink-2";
export const MENU_SEP = "-mx-1 my-1 h-px bg-rule";
