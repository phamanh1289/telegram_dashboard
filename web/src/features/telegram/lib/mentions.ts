import type { QueryClient } from "@tanstack/react-query";
import type { MentionSource } from "@/shared/components/mention";
import { api, ApiError, errorText, type Member } from "@/shared/lib/api";
import { t } from "@/shared/lib/i18n";
import { toast } from "@/shared/lib/notifications";
import { nameTag } from "./inbox";

const same = (m: Member[]) => m;
/** The Telegram group's members (inbox reply, Q&A). */
export const groupMembers = (chatId: string): MentionSource<Member[]> => ({
  queryKey: ["members", chatId], queryFn: () => api<Member[]>(`/chats/${encodeURIComponent(chatId)}/members`), select: same, formatMention: nameTag,
  errors: { members_hidden: "Nhóm ẩn danh sách thành viên, gõ @username để tag." },
});
/** Several groups read as one list (Cập nhật story: one message to each): everyone in any of them, once. A group that
 *  hides its members is left out (every one hidden: that error); any other failure fails the list. */
export const groupsMembers = (chatIds: string[]): MentionSource<Member[]> => (chatIds.length < 2 ? groupMembers(chatIds[0] ?? "") : {
  ...groupMembers(""), queryKey: ["members", ...chatIds],
  queryFn: async () => {
    const got = await Promise.allSettled(chatIds.map((c) => groupMembers(c).queryFn()));
    const bad = got.flatMap((r) => (r.status === "rejected" ? [r.reason as unknown] : []));
    const hard = bad.find((e) => !(e instanceof ApiError && e.code === "members_hidden"));
    if (hard || bad.length === got.length) throw hard ?? bad[0];
    const seen = new Map<string, Member>();
    for (const r of got) for (const m of r.status === "fulfilled" ? r.value : []) if (!seen.has(m.user_id)) seen.set(m.user_id, m);
    return [...seen.values()];
  },
});

const words = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").replace(/[đĐ]/g, "d").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? ([] as string[]);
/** Does a Telegram member look like this person? Same words in any order ("Phạm Anh" ~ "Anh Phạm"), or a member name
 *  holding their last two words. Accents and case ignored. */
export function samePerson(member: string, person: string) {
  const m = words(member), p = words(person);
  if (!m.length || !p.length) return false;
  if ([...m].sort().join(" ") === [...p].sort().join(" ")) return true;
  return p.length >= 2 && m.length >= 2 && p.slice(-2).every((w) => m.includes(w));
}

/** The group member a YouTrack name points at. A given name alone ("Tùng"): the one member whose name ends with it; two
 *  of them: nobody (a wrong tag is worse than none). */
export function findMember(members: Member[], person: string) {
  const w = words(person), hit = w.length === 1 ? members.filter((x) => words(x.name).at(-1) === w[0]) : [];
  return members.find((x) => samePerson(x.name, person)) ?? (hit.length === 1 ? hit[0] : undefined);
}
/** How a message tags a member: "@username", else Telegram's tag by name. */
export const memberTag = (m: Member) => (m.username ? `@${m.username}` : nameTag(m.name, m.user_id));

/** "@user …" for the people (YouTrack names: Assignee, QC) found in the group, as a reply tags them; the user reviews it
 *  in the reply box. Members hidden by the group: none (the box's @ still works); another failure is said, not hidden. */
export async function tagsFor(qc: QueryClient, chatId: string, people: string[]) {
  if (!people.length) return "";
  const src = groupMembers(chatId);
  let members: Member[];
  try {
    members = await qc.fetchQuery({ queryKey: src.queryKey, queryFn: src.queryFn, staleTime: 5 * 60_000 }) as Member[];
  } catch (e) {
    if (!(e instanceof ApiError && e.code === "members_hidden")) toast({ text: errorText(e, {}, t("Không đọc được thành viên nhóm: tự @tag người cần check")) });
    return "";
  }
  return [...new Set(people.flatMap((p) => { const m = findMember(members, p); return m ? [memberTag(m)] : []; }))].join(" ");
}
