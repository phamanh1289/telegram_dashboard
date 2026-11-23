import type { MentionSource } from "@/shared/components/mention";
import { type Person, ytPeopleQuery } from "./yt";

const asMembers = (l: Person[]) => l.map((p) => ({ user_id: p.login, name: p.name, username: p.login }));
/** The YouTrack project's team (comments, ticket description): same key as the Assignee picker's list. */
export const ytPeople = (project: string): MentionSource<Person[]> => ({
  ...ytPeopleQuery(project), select: asMembers,
});

