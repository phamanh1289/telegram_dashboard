import type { Dict } from "..";

// English for this area's UI strings (keys: the Vietnamese source; shared ones such as "Đóng", "Hỏi AI" come from the other
// areas). The guide's content itself: lib/guide.en.json.
export default {
  // components/guide
  "Cách dùng:": "How to use:",
  "AI không chạy được.": "The AI could not run.",
  "Câu hỏi quá dài.": "The question is too long.",
  "Hướng dẫn": "Guide",
  "Tìm cách dùng mọi tính năng Telegram / YouTrack, hỏi AI, hoặc để app chỉ trực tiếp trên màn hình (F1).": "Find how to use every Telegram / YouTrack feature, ask the AI, or let the app show you right on screen (F1).",
  "Hướng dẫn sử dụng": "User guide",
  "Tìm tính năng": "Search features",
  "Tìm tính năng hoặc hỏi: làm sao tóm tắt nhóm?": "Search features or ask: how do I summarize a group?",
  "AI đọc toàn bộ hướng dẫn và trả lời câu hỏi của bạn (Enter).": "The AI reads the whole guide and answers your question (Enter).",
  "Khu vực": "Area",
  "Tính năng phù hợp": "Matching features",
  "Mọi tính năng": "All features",
  "Không tải được hướng dẫn, thử mở lại.": "Could not load the guide, try opening it again.",
  "Không tìm thấy tính năng khớp. Bấm {ask} để hỏi bằng câu tự nhiên.": "No matching feature. Click {ask} to ask in your own words.",
  "Đang đọc hướng dẫn": "Reading the guide",
  "Chỉ cho tôi": "Show me",
  "Mở đúng trang và làm sáng từng nút cần bấm.": "Opens the right page and lights up each button to click.",
  "Chỉ cho tôi: {title}": "Show me: {title}",
  "Chỉ cho tôi trên màn hình": "Show me on screen",
  // components/guide-tour
  "Bấm \"Telegram\" trên thanh trên cùng để mở Telegram.": "Click \"Telegram\" in the top bar to open Telegram.",
  "Bấm \"YouTrack\" trên thanh trên cùng để mở YouTrack.": "Click \"YouTrack\" in the top bar to open YouTrack.",
  "Bấm biểu tượng bánh răng \"Cài đặt\" ở góc phải thanh trên cùng.": "Click the \"Settings\" gear at the right of the top bar.",
  "Nhập / chọn ở ô đang sáng rồi bấm Tiếp.": "Type / choose in the lit field, then click Next.",
  "Bấm vào chỗ đang sáng để làm bước này.": "Click the lit spot to do this step.",
  "Làm theo mô tả rồi bấm Tiếp.": "Follow the description, then click Next.",
  "Đang tìm trên trang…": "Looking on the page…",
  "Chưa thấy chỗ này. Tính năng dành cho vai trò {role}: đổi ở Cài đặt › Chung › Vai trò nếu bạn đang ở vai trò khác.": "Can't find this yet. The feature is for the {role} role: change it in Settings › General › Role if you are in another role.",
  "Chưa thấy chỗ này trên màn hình: có thể cần dữ liệu phù hợp, hoặc làm bước trước. Bấm Tiếp để bỏ qua.": "Can't find this on screen: it may need matching data, or the previous step first. Click Next to skip.",
  "Hướng dẫn: {title}": "Guide: {title}",
  "Bước {i}/{n}": "Step {i}/{n}",
  "Thoát hướng dẫn (Esc)": "Exit guide (Esc)",
  "Bước trước": "Back",
  "Tiếp": "Next",
  // components/settings › WaitTips
  "Trong lúc chờ, bạn có biết": "While you wait, did you know",
} satisfies Dict;
