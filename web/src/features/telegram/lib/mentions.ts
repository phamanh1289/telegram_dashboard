import type { MentionSource } from "@/shared/components/mention";
import { api, type Member } from "@/shared/lib/api";
import { nameTag } from "./inbox";

const same = (m: Member[]) => m;
/** The Telegram group's members (inbox reply, Q&A). */
export const groupMembers = (chatId: string): MentionSource<Member[]> => ({
  queryKey: ["members", chatId], queryFn: () => api<Member[]>(`/chats/${encodeURIComponent(chatId)}/members`), select: same, formatMention: nameTag,
  errors: { members_hidden: "Nhóm ẩn danh sách thành viên, gõ @username để tag." },
});
