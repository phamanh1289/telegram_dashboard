import type { useRouter } from "next/navigation";

/** Open a page of the app without reloading it: another module mounts and reads the URL; Cài đặt follows the hash; the
 *  module you are on switches its view ("guide-go": inbox.tsx, yt/state.tsx, docs/app.tsx). */
export function goApp(router: ReturnType<typeof useRouter>, href: string) {
  const u = new URL(href, location.origin), path = (p: string) => p.replace(/\/$/, "");
  if (u.origin !== location.origin) return; // "//evil.com", "/\evil.com" in an AI answer: never leave the app
  if (path(u.pathname) !== path(location.pathname)) router.push(href);
  else if (u.hash) location.hash = u.hash;
  else dispatchEvent(new CustomEvent("guide-go", { detail: u.searchParams }));
}
