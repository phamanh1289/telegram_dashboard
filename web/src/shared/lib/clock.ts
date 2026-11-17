// One minute timer and preference listener for all mounted views.
const nowListeners = new Set<(now: number) => void>();
let nowTimer: ReturnType<typeof setInterval> | undefined;
function tickNow() {
  const now = Date.now();
  nowListeners.forEach((listener) => listener(now));
}
export function subscribeNow(listener: (now: number) => void) {
  nowListeners.add(listener);
  if (nowListeners.size === 1) {
    nowTimer = setInterval(tickNow, 60_000);
    addEventListener("prefs", tickNow);
  }
  return () => {
    nowListeners.delete(listener);
    if (!nowListeners.size) {
      clearInterval(nowTimer);
      nowTimer = undefined;
      removeEventListener("prefs", tickNow);
    }
  };
}

