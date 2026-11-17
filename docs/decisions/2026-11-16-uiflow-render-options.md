# UI flow: bỏ Nhanh/Kỹ + bỏ hard limit, thêm chế độ render

Trạng thái: **đã triển khai bảng Cần/Đã có** (16/11/2026), gồm cả "Phân tích bằng AI" trong hộp cảnh báo. Next step: (2) chỉ vẽ lại phần đổi và (3) chi phí theo model đã làm; (4) test case đã có sẵn trong engine (`testPaths` / `checklist`); (1) render theo phần đã làm ("Chia {n} phần" trong hộp cảnh báo, 12 màn/phần, 3 lượt song song).

## Hôm nay đang làm thế nào

- Ô prompt UI flow (`web/src/features/youtrack/components/flow.tsx`) có Segmented **Nhanh / Kỹ**, lưu pref `uiflowDeep`.
  Nhanh dùng model/effort `yt`; Kỹ dùng `yt_task` (`heavy=body.deep` trong `youtrack/api_flow.py`).
- Giới hạn: `BUDGETS = {Nhanh: 12k, Kỹ: 24k}` cùng `CONTEXT_FLOOR = 32 768` (`youtrack/flow_prompt.py`).
  Vượt thì cắt chữ Zeplin. Riêng AC/mô tả vượt, > 60 màn hoặc cây nguồn quá lớn thì **413, không gọi AI**.
  `MAX_SCREENS / ITEMS / LINKS = 60 / 20 / 300` còn nằm trong schema `Flow` (`youtrack/flow.py`) và engine JS.
- **Skeleton đã do code dựng** từ link Zeplin (ID màn, tên, URL, nút đọc từ thiết kế), không cần AI.
  AI chỉ bổ sung kind/parent/ac, nút thiếu và **link**.
- Đã có `YtPicks` / `ModelEffortPicker` (`features/youtrack/components/bits.tsx`) để chọn model + effort ngay trong ô
  prompt, dùng ở YouTrack AI.

## Bảng Cần / Đã có / Ở đâu

| Cần | Đã có | Ở đâu / việc phải làm |
|---|---|---|
| User tự chọn model + effort | `YtPicks` (`kind` `yt` / `yt_task`) | Thay Segmented Nhanh/Kỹ bằng `YtPicks` trong `tools` của `AiPromptBox`. Bỏ `deep` khỏi `AiFlow`, đổi sang `kind` của picker. Bỏ pref `uiflowDeep` |
| Bỏ limit token | `BUDGETS`, cắt chữ Zeplin, 413 | Bỏ `BUDGETS` / cắt chữ / 413 ngân sách. **Giữ một chặn cứng duy nhất**: prompt lớn hơn context của model đã chọn thì CLI chắc chắn lỗi, nên báo trước thay vì đốt token rồi fail |
| Bỏ giới hạn số màn | `MAX_SCREENS=60` ở schema + engine | Nâng trần (vd. 300) chứ không bỏ hẳn. Schema là chặn an toàn cho file HTML và engine vẽ; 300 màn đã lag canvas. Cần đo engine trước khi nâng |
| Vi phạm rule thì cảnh báo, không chặn | Rule chạy trong `flow_prompt.build` (raise) | Đổi raise thành danh sách `risks`. Endpoint mới `POST /api/yt/flow/precheck` (chỉ code, không AI) trả token ước lượng theo nguồn, số màn và risks |
| Popup cảnh báo + lý do + hướng xử lý | Chưa có | `Dialog` khi bấm Render mà có risk: bảng nguồn chiếm bao nhiêu token, ước lượng chi phí, gợi ý (tách theo sub-ticket, chỉ render màn…). Nút "Vẫn render" chạy đúng 100% nguồn với model/effort đã chọn |
| AI nhẹ phân tích lý do | — | **Đề xuất làm sau.** Precheck bằng code đã có đủ số liệu (nguồn nào to, bao nhiêu màn) và tức thì, miễn phí. Gọi AI để giải thích con số lại tốn token đúng lúc đang cảnh báo tốn token. Chỉ thêm nếu số liệu code chưa đủ để quyết |
| Chế độ "Chỉ màn hình" | Skeleton code-only | **Không cần AI**: dựng flow từ skeleton (màn + ảnh Zeplin + nút đọc từ thiết kế), không link. 0 token, vài giây, không bao giờ vượt limit |
| Chế độ "Màn + liên kết" | Luồng hiện tại | Giữ nguyên luồng AI |

## UX đề xuất

Ô prompt (ghim đáy, theo `AiPromptBox`):

```
[ Ghi chú cho AI ...                                              ]
[Chỉ màn hình | Màn + liên kết]   [model · effort ▾]   ~18k token   (▶ Render)
```

- `Segmented` id riêng: **Chỉ màn hình** (badge "Code · 0 token") / **Màn + liên kết** (badge "AI"). Dùng lại nhãn
  AI/Code của màn progress cho thống nhất.
- Khi chọn "Chỉ màn hình": ẩn picker model và ô ghi chú (không có AI), nút đổi thành "Dựng màn".
- Ước lượng token hiện ngay cạnh nút từ `precheck`, chạy khi mở dialog, có cache. Vượt ngưỡng thì chữ đổi màu warn.
- Bấm Render mà có risk thì mở popup cảnh báo (mục trên). Không có risk thì chạy luôn.
- Đã có sơ đồ "Chỉ màn hình": bấm "Màn + liên kết" chỉ bổ sung link, **giữ** vị trí/ghi chú/vùng bấm tay qua
  `keep_manual` (đã có).

## Feature mới / next step (để chọn, không tự làm)

1. **Render theo phần**: ticket quá lớn thì chia theo sub-ticket hoặc nhóm AC, render từng phần rồi ghép (ID màn ổn
   định theo URL Zeplin). Đây là cách thật sự bỏ được giới hạn context, thay vì chỉ cảnh báo.
2. **Chỉ vẽ lại phần đổi**: ticket/Zeplin đổi sau lần cập nhật (đã phát hiện được) thì chỉ gửi AI các màn đổi và hàng
   xóm của chúng, ít token hơn nhiều.
3. **Ước lượng chi phí theo model**: hiện $ hoặc % quota (`claude_runs.jsonl` có cost/quota thật) cạnh số token.
4. **Sinh test case từ flow**: đã có màn bắt đầu + đường đi, xuất checklist QA theo từng nhánh AC.

## Rủi ro

- Bỏ limit với model nhẹ + ticket rất lớn: output dễ bị cắt hoặc sai định dạng (như VA-12584 với Haiku). Popup nên
  gợi ý effort/model mạnh hơn khi số màn lớn.
- Đổi `AiFlow` (`deep` → model kind / `mode`) phải chạy `npm run api:types`. Job cũ có `request.deep` cần map khi resume.
- Cập nhật guide vi/en (`youtrack-details.json`): mục Nhanh/Kỹ và giới hạn 12k/24k đang ghi trong đó.
