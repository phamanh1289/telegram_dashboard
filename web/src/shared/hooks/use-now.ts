"use client";

import { useEffect, useState } from "react";
import { subscribeNow } from "@/shared/lib/clock";

/** Current time, refreshed every minute and when a preference changes (keeps render pure). */
export function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => subscribeNow(setNow), []);
  return now;
}

