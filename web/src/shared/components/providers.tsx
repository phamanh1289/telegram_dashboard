"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { useEffect, useState } from "react";
import { AuthGate } from "@/shared/components/auth-gate";
import { readLang, useLang } from "@/shared/lib/i18n";
import { useMascotWatch } from "@/shared/lib/mascot";
import { makeQueryClient } from "@/shared/lib/query-client";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(makeQueryClient);
  const [locked, setLocked] = useState(false); // the API said auth_required (lib/api): no token cookie in this browser
  useEffect(() => {
    const lock = () => setLocked(true);
    addEventListener("auth-required", lock);
    return () => removeEventListener("auth-required", lock);
  }, []);
  const lang = useLang();
  useEffect(() => { // hydration renders the prerendered Vietnamese first; show the page once it is in the chosen language
    if (lang !== readLang()) return;
    document.documentElement.lang = lang;
    delete document.documentElement.dataset.i18nWait;
  }, [lang]);
  return (
    <QueryClientProvider client={client}>
      <MotionConfig reducedMotion="user">{children}{locked && <AuthGate />}<MascotWatch /></MotionConfig>
    </QueryClientProvider>
  );
}

/** A mascot drawing started on any page says when it is done (lib/mascot); inside the query client. */
function MascotWatch() {
  useMascotWatch();
  return null;
}
