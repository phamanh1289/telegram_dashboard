import { useEffect, useState } from "react";

/** `value`, kept a little longer once it turns falsy (null after `ms`): a popup mounted only while asked for (so its
 *  state starts fresh each time) still plays its close animation before it goes. Draw from the result, open from
 *  `value`. `ms`: past the popups' close time (--dur-short, 280ms at its slowest). */
export function useLinger<T>(value: T | null | undefined | false, ms = 300): T | null {
  const [kept, setKept] = useState<T | null>(value || null);
  if (value && value !== kept) setKept(value);
  useEffect(() => {
    if (value || kept === null) return;
    const t = setTimeout(() => setKept(null), ms);
    return () => clearTimeout(t);
  }, [value, kept, ms]);
  return value || kept;
}
