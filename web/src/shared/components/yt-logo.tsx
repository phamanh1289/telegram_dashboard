/** YouTrack's mark: the pink / blue X behind the black "YT" tile (brand colours, not theme tokens). */
export function YtLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={className}>
      <g strokeWidth="9" strokeLinecap="round">
        <path d="M5.5 5.5 16 16" stroke="#FF318C" />
        <path d="M26.5 5.5 5.5 26.5M16 16l10.5 10.5" stroke="#0BB0F0" />
      </g>
      <rect x="7.5" y="7.5" width="17" height="17" fill="#000" />
      <text x="9" y="17.2" fill="#fff" fontSize="9" fontWeight="700" fontFamily="Quicksand, system-ui, sans-serif" letterSpacing="-0.4">YT</text>
      <rect x="9.5" y="20.6" width="6" height="1.5" fill="#fff" />
    </svg>
  );
}
