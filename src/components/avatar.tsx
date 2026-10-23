/** Member photo or initials on court green. Photos are served only to logged-in members. */
export function Avatar({ name, avatarKey, size = 40 }: { name: string; avatarKey: string | null; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  if (avatarKey) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`/api/avatars/${avatarKey}`} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-court-soft font-semibold text-court"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials || "?"}
    </span>
  );
}
