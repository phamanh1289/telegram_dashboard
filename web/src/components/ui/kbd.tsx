/** A key in a shortcut hint. */
export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded-sm border border-rule bg-cotton px-1 py-px text-[0.6875rem] text-ink-2">{children}</kbd>;
}
