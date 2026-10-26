/** Wordmark: a pickleball (perforated ball) beside the club name. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
        <circle cx="13" cy="13" r="12" fill="#d7e54b" stroke="#13221c" strokeWidth="1.5" />
        {[[13, 6.5], [7.5, 11], [18.5, 11], [9.5, 17.5], [16.5, 17.5], [13, 13]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="1.6" fill="#13221c" opacity="0.85" />
        ))}
      </svg>
      <span className="font-[family-name:var(--font-display)] text-[1.05rem] font-bold leading-none tracking-tight">
        Copenhagen Pickleball Collective
      </span>
    </span>
  );
}
