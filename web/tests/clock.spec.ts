import { expect, test } from "@playwright/test";
import { subscribeNow } from "../src/shared/lib/clock";

test("views share one clock, preferences refresh together, and the last unmount stops it", () => {
  const timers = new Set<() => void>();
  const prefs = new Set<() => void>();
  let now = 1;
  const originalGlobals = Object.getOwnPropertyDescriptors(globalThis);
  const originalNow = Date.now;
  Date.now = () => now;
  const globals = {
    setInterval: (tick: () => void, ms: number) => { expect(ms).toBe(60_000); timers.add(tick); return tick; },
    clearInterval: (tick: () => void) => timers.delete(tick),
    addEventListener: (event: string, tick: () => void) => { expect(event).toBe("prefs"); prefs.add(tick); },
    removeEventListener: (event: string, tick: () => void) => { expect(event).toBe("prefs"); prefs.delete(tick); },
  };
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const cleanup: (() => void)[] = [];
  const subscribe = (listener: (value: number) => void) => {
    const stop = subscribeNow(listener);
    cleanup.push(stop);
    return stop;
  };
  try {
    const first: number[] = [], second: number[] = [];
    const stopFirst = subscribe((value) => first.push(value));
    const stopSecond = subscribe((value) => second.push(value));
    expect(timers.size).toBe(1);
    expect(prefs.size).toBe(1);
    now = 2;
    timers.forEach((tick) => tick());
    expect(first).toEqual([2]);
    expect(second).toEqual([2]);
    stopFirst();
    now = 3;
    prefs.forEach((tick) => tick());
    expect(first).toEqual([2]);
    expect(second).toEqual([2, 3]);
    expect(timers.size).toBe(1);
    stopSecond();
    expect(timers.size).toBe(0);
    expect(prefs.size).toBe(0);
    const stopRestarted = subscribe((value) => first.push(value));
    expect(timers.size).toBe(1);
    expect(prefs.size).toBe(1);
    now = 4;
    timers.forEach((tick) => tick());
    expect(first).toEqual([2, 4]);
    stopRestarted();
    expect(timers.size).toBe(0);
    expect(prefs.size).toBe(0);
  } finally {
    cleanup.forEach((stop) => stop());
    Date.now = originalNow;
    for (const name of Object.keys(globals)) {
      const descriptor = originalGlobals[name];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
