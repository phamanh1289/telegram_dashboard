/** UI faces a member can pick (Cài đặt chung › Font chữ); all cover Vietnamese. No "use client": app/layout.tsx builds its boot
 *  script from this list. `css` = the Google Fonts family spec, loaded only when picked; "" = the system face, nothing to load.
 *  `w` = [regular, medium] for this face (font-normal / font-medium; bold is always 700): rounded faces have hairline 400s, so
 *  their reading weight is 500 to look as solid as a 400 of the others. */
export const FONTS = [
  { id: "quicksand", label: "Quicksand", hint: "Mặc định: tròn, mềm mại", family: '"Quicksand"', css: "Quicksand:wght@400..700", w: [500, 600] },
  { id: "be-vietnam", label: "Be Vietnam Pro", hint: "Làm cho tiếng Việt, nét rõ", family: '"Be Vietnam Pro"', css: "Be+Vietnam+Pro:wght@400;500;700", w: [400, 500] },
  { id: "inter", label: "Inter", hint: "Gọn, trung tính, dễ đọc ở cỡ nhỏ", family: '"Inter"', css: "Inter:wght@400..700", w: [400, 500] },
  { id: "nunito", label: "Nunito", hint: "Tròn như Quicksand, nét dày hơn", family: '"Nunito"', css: "Nunito:wght@400..700", w: [500, 600] },
  { id: "system", label: "Font của máy", hint: "Font hệ thống, không tải thêm", family: "", css: "", w: [400, 500] },
] as const;
export type FontId = (typeof FONTS)[number]["id"];
export const DEFAULT_FONT: FontId = "quicksand";
