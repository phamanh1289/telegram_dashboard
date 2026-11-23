import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { COMMENTED, type Ticket, ytApi } from "@/features/youtrack/lib/yt";

/** /trace: per ticket its State and last update, the start of its description, its links and its latest comment
 *  (release scope; Chờ bổ sung's "có vẻ xong"). */
export type Trace = Record<string, { state?: string | null; updated?: number; resolved?: number | null; desc?: string;
  links: { rel: string; issues: Ticket[] }[]; last: { text: string; created: number; author: string | null } | null }>;
export const ytTraceQuery = (ids: string[]) => ({
  queryKey: ["yt", "trace", ids.join(",")],
  queryFn: ({ signal }: { signal: AbortSignal }) => ytApi<Trace>(`/trace?ids=${encodeURIComponent(ids.join(","))}`, { signal }),
  enabled: ids.length > 0, staleTime: 60_000,
});

/** /asked (backend youtrack/asked.py): open tickets with a comment asking me (my @login, my name; `po`: the PO / PM),
 *  unanswered: every comment after my last one counts. Newest ask first. Shared by the YouTrack home and Hôm nay. */
export type Asked = { ticket: Ticket; ask: { text: string; created: number; author: string | null } };
export const askedQuery = (project: string, po: boolean) => ({
  // its own key, not under the ticket lists: a State / Assignee edit does not read the comments again
  queryKey: ["yt", "asked", project, po],
  queryFn: ({ signal }: { signal: AbortSignal }) => ytApi<Asked[]>(`/asked?project=${encodeURIComponent(project)}&po=${po}`, { signal }),
  staleTime: 2 * 60_000, enabled: !!project,
});

/** The asks, read again once a comment is sent from anywhere in the app (my answer takes its ask off the list). */
export function useAsked(project: string, po: boolean, on = true, poll = false) { // poll: the one reader that keeps it fresh (the top bar)
  const q = useQuery({ ...askedQuery(project, po), enabled: on && !!project, refetchInterval: poll && 5 * 60_000 });
  const { refetch } = q;
  useEffect(() => {
    const f = () => void refetch();
    addEventListener(COMMENTED, f);
    return () => removeEventListener(COMMENTED, f);
  }, [refetch]);
  return q;
}
