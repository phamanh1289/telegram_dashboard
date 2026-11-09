"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { makeQueryClient } from "@/lib/query-client";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(makeQueryClient);
  const [locked, setLocked] = useState(false); // the API said auth_required (lib/api): no token cookie in this browser
  useEffect(() => {
    const lock = () => setLocked(true);
    addEventListener("auth-required", lock);
    return () => removeEventListener("auth-required", lock);
  }, []);
  return (
    <QueryClientProvider client={client}>
      <MotionConfig reducedMotion="user">{children}{locked && <AuthGate />}</MotionConfig>
    </QueryClientProvider>
  );
}
