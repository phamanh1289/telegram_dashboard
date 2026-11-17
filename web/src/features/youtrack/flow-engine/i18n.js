
// ------------------------------------------------------------------ i18n
const T = {
  vi: {
    map: "Toàn cục", play: "Prototype", edit: "Sửa", fit: "Vừa màn hình",
    zeplin: "Mở trên Zeplin", canvas: "Sơ đồ luồng màn hình",
    bad: "Không đọc được dữ liệu UI flow trong file này.",
    back: "Quay lại", restart: "Bắt đầu lại", pick: "Chọn trường hợp", trail: "Đường đã đi",
    noItems: "Màn này chưa có nút",
    offShot: "Nút chưa thấy trên thiết kế",
    addItem: "+ Nút", del: "Xoá", newScreen: "Màn mới", newItem: "Nút mới",
    acField: "AC", whenField: "Điều kiện", zeplinField: "Zeplin", nameField: "Tên màn", dotHint: "Kéo để nối",
    arrow: "Mũi tên", button: "Nút", lastScreen: "Sơ đồ cần ít nhất một màn",
    maxScreens: "Tối đa {n} màn", maxMemos: "Tối đa {n} ghi chú trên sơ đồ", memo: "Ghi chú", addMemo: "+ Ghi chú", memoDel: "Xoá ghi chú", memoHint: "Lưu ý, ý tưởng cải thiện…", memoFold: "Thu gọn ghi chú", memoOpen: "Mở rộng ghi chú", memoDraw: "Kéo trên sơ đồ để vẽ khung ghi chú (bấm một lần: khung cỡ mặc định) · Esc để huỷ", maxItems: "Tối đa {n} nút mỗi màn", maxLinks: "Tối đa {n} liên kết",
    dragging: "Thả chuột xong rồi hãy sửa",
    badZeplin: "Link Zeplin không đúng (zpl.io, app.zeplin.io)",
    act_navigate: "Đi tới", act_open: "Mở", act_back: "Quay lại", act_close: "Đóng",
    routesField: "Đường đi ({n})", routesNone: "Chưa có: kéo chấm tròn ở mép phải vùng bấm sang màn đích", routeDel: "Bỏ đường đi tới “{s}”", routeMore: "Điều kiện, AC…",
    kind_screen: "Màn", kind_popup: "Popup", kind_sheet: "Sheet", kind_toast: "Toast",
    search: "Tìm màn: tên, nút, link Zeplin, id", found: "{n} màn", noFound: "Không thấy màn nào",
    fromZeplin: "+ Từ Zeplin", zUrl: "Link màn Zeplin", zTitle: "Thêm màn từ Zeplin", zPlaceholder: "Dán link màn Zeplin. Nhiều màn: cách nhau bằng dấu phẩy, khoảng trắng hoặc xuống dòng", zCount: "{n} link", zAddN: "Thêm {n} màn", zReadingN: "Đang đọc {i}/{n} màn từ Zeplin…", zAdded: "Đã thêm {n} màn.", zAddValid: "Thêm {n} màn hình", zCheck: "{n} link lỗi, kiểm tra lại (sửa trong ô rồi bấm Thử lại):", zNone: "Chưa có link nào", zAdd: "Thêm", zReading: "Đang đọc màn từ Zeplin…",
    zDup: "Đã có màn này: “{s}”", zRetry: "Thử lại",
    zMissing: "Không đọc được màn này trên Zeplin: chưa chia sẻ với tài khoản hoặc đã bị xoá",
    zFail: "Không đọc được Zeplin", close: "Đóng",
    drawHot: "+ Vùng bấm", redraw: "Vẽ lại vùng", byText: "Khớp theo chữ", itemName: "Tên nút", fold: "Thu gọn", unfold: "Mở rộng", fold_full: "Đầy đủ", fold_fold: "Thu gọn", foldH: "Cao (px)", byTextNeed: "Cần tên nút trùng một chữ trên thiết kế", byTextUnnamed: "Vùng bấm chưa có tên: đặt tên trùng chữ trên thiết kế (vd. “Tiếp tục”) rồi bấm lại", byTextNone: "Không thấy chữ “{s}” trên thiết kế: sửa tên cho trùng chữ trên màn rồi bấm lại", byTextHint: "Bỏ vùng vẽ tay, dùng chỗ có chữ “{s}” trên thiết kế (tự theo khi designer dời nút)", drawHint: "Bấm vào một chữ trên thiết kế để lấy làm nút, hoặc kéo để vẽ vùng bấm · Enter đặt vùng giữa màn · Esc để huỷ",
    itemsField: "Nút", noteField: "Ghi chú", noteBadge: "Có ghi chú", relayout: "Sắp xếp lại",
    moreHidden: "+{n} nút ở phần ẩn",
    noStartNote: "Chưa đặt màn bắt đầu", startHere: "Đặt màn đang xem làm màn bắt đầu (bấm lại để bỏ)",
    startBadge: "Màn bắt đầu", setStart: "Màn bắt đầu", undo: "↶ Hoàn tác", redo: "↷ Làm lại", unpick: "Bỏ chọn (Esc)", backTo: "Về màn “{s}”", drawOne: "Vẽ vùng bấm", hotsField: "Vùng bấm",
    tap: "bấm “{i}”", goBack: "quay lại", goClose: "đóng", goOn: "tiếp", when: "khi {s}",
    askHead: "{s}: các bước sau chưa có thiết kế trên Zeplin, nhờ bổ sung link màn:"
  },
  en: {
    map: "Map", play: "Prototype", edit: "Edit", fit: "Fit to screen",
    zeplin: "Open in Zeplin", canvas: "Screen flow map",
    bad: "Could not read the UI flow data in this file.",
    back: "Back", restart: "Start over", pick: "Pick a case", trail: "Path taken",
    noItems: "No buttons on this screen yet",
    offShot: "Buttons not found on the design",
    addItem: "+ Button", del: "Delete", newScreen: "New screen", newItem: "New button",
    acField: "AC", whenField: "Condition", zeplinField: "Zeplin", nameField: "Screen name", dotHint: "Drag to link",
    arrow: "Arrow", button: "Button", lastScreen: "The flow needs at least one screen",
    maxScreens: "At most {n} screens", maxMemos: "At most {n} notes on the map", memo: "Note", addMemo: "+ Note", memoDel: "Delete note", memoHint: "A caution, an idea to improve…", memoFold: "Fold note", memoOpen: "Expand note", memoDraw: "Drag on the map to draw the note (one click: the default size) · Esc to cancel", maxItems: "At most {n} buttons per screen", maxLinks: "At most {n} links",
    dragging: "Drop what you are dragging first",
    badZeplin: "Not a Zeplin link (zpl.io, app.zeplin.io)",
    act_navigate: "Navigate", act_open: "Open", act_back: "Back", act_close: "Close",
    routesField: "Ways out ({n})", routesNone: "None yet: drag the dot on the area's right edge to the target screen", routeDel: "Remove the way to “{s}”", routeMore: "Condition, AC…",
    kind_screen: "Screen", kind_popup: "Popup", kind_sheet: "Sheet", kind_toast: "Toast",
    search: "Find a screen: name, button, Zeplin link, id", found: "{n} screens", noFound: "No screen found",
    fromZeplin: "+ From Zeplin", zUrl: "Zeplin screen link", zTitle: "Add screens from Zeplin", zPlaceholder: "Paste a Zeplin screen link. Several: separate them with commas, spaces or new lines", zCount: "{n} links", zAddN: "Add {n} screens", zReadingN: "Reading {i}/{n} screens from Zeplin…", zAdded: "Added {n} screens.", zAddValid: "Add {n} screens", zCheck: "{n} links failed, check them (fix them in the box and press Retry):", zNone: "No link yet", zAdd: "Add", zReading: "Reading the screen from Zeplin…",
    zDup: "This screen is already here: “{s}”", zRetry: "Retry",
    zMissing: "Could not read this screen on Zeplin: not shared with this account, or deleted",
    zFail: "Could not read Zeplin", close: "Close",
    drawHot: "+ Tap area", redraw: "Redraw area", byText: "Match by text", itemName: "Button name", fold: "Fold", unfold: "Expand", fold_full: "Whole", fold_fold: "Folded", foldH: "Height (px)", byTextNeed: "Needs a button name that is a text on the design", byTextUnnamed: "This tap area has no name: name it after a text on the design (e.g. “Continue”) and press again", byTextNone: "No “{s}” on the design: rename it to a text on the screen and press again", byTextHint: "Drop the drawn area and use where “{s}” is on the design (it follows the button when the designer moves it)", drawHint: "Click a text on the design to make it the button, or drag to draw a tap area · Enter puts one mid-screen · Esc to cancel",
    itemsField: "Buttons", noteField: "Note", noteBadge: "Has a note", relayout: "Re-arrange",
    moreHidden: "+{n} buttons in the hidden part",
    noStartNote: "No start screen set", startHere: "Make the screen shown the start screen (press again to unset)",
    startBadge: "Start screen", setStart: "Start screen", undo: "↶ Undo", redo: "↷ Redo", unpick: "Deselect (Esc)", backTo: "Back to “{s}”", drawOne: "Draw tap area", hotsField: "Tap areas",
    tap: "tap “{i}”", goBack: "go back", goClose: "close", goOn: "go on", when: "when {s}",
    askHead: "{s}: these steps have no Zeplin design yet, please add the screen links:"
  }
};
/** t(key, {n, s, i}) for one language; values are inserted as plain text by the caller. */
function tr(lang) {
  const d = T[lang] || T.vi;
  return (key, vars) => (d[key] ?? key).replace(/\{(\w)\}/g, (_, k) => String(vars?.[k] ?? ""));
}
export { T, tr };
