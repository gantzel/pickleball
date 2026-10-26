/**
 * 16:9 cover for a programme ("hold"): the uploaded photo, or a drawn court
 * in the programme's colour (no stock photos of people).
 */
export function ProgrammeCover({ imageKey, color, className = "" }: { imageKey: string | null; color: string | null; className?: string }) {
  if (imageKey) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`/api/avatars/${imageKey}`} alt="" className={`aspect-video w-full object-cover ${className}`} loading="lazy" />;
  }
  const c = color ?? "#1f5c4a";
  return (
    <svg viewBox="0 0 320 180" className={`aspect-video w-full ${className}`} aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <rect width="320" height="180" fill={c} />
      <rect width="320" height="180" fill="url(#shade)" />
      <defs>
        <linearGradient id="shade" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.12" />
          <stop offset="1" stopColor="#000" stopOpacity="0.22" />
        </linearGradient>
      </defs>
      {/* Court seen from above, slightly rotated */}
      <g transform="rotate(-8 160 90)" stroke="#fff" strokeOpacity="0.75" strokeWidth="2.5" fill="none">
        <rect x="40" y="38" width="240" height="104" rx="2" />
        <line x1="160" y1="30" x2="160" y2="150" strokeWidth="4" strokeOpacity="0.9" />
        <line x1="124" y1="38" x2="124" y2="142" />
        <line x1="196" y1="38" x2="196" y2="142" />
        <line x1="40" y1="90" x2="124" y2="90" />
        <line x1="196" y1="90" x2="280" y2="90" />
      </g>
      <circle cx="226" cy="64" r="9" fill="#dce84a" />
      <circle cx="223" cy="61" r="1.4" fill="#1b2a24" fillOpacity="0.55" />
      <circle cx="229" cy="66" r="1.4" fill="#1b2a24" fillOpacity="0.55" />
      <circle cx="223" cy="68" r="1.4" fill="#1b2a24" fillOpacity="0.55" />
    </svg>
  );
}
