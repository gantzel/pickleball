import { formatMonthDay, formatRating } from "@/lib/format";

interface Point {
  at: Date;
  rating: number;
}

/**
 * Step chart of verified rating snapshots (a rating holds until the next
 * observed change), extended to "now". Level thresholds are drawn as
 * reference lines and attended trainings as ticks on the time axis.
 */
export function RatingChart({ points, attended, now = new Date() }: { points: Point[]; attended: Date[]; now?: Date }) {
  const W = 720;
  const H = 260;
  const pad = { l: 48, r: 16, t: 16, b: 34 };
  const t0 = points[0].at.getTime();
  const t1 = Math.max(now.getTime(), t0 + 86400_000);
  const values = points.map((p) => p.rating);
  const minV = Math.floor((Math.min(...values) - 0.15) * 4) / 4;
  const maxV = Math.ceil((Math.max(...values) + 0.15) * 4) / 4;
  const x = (t: number) => pad.l + ((t - t0) / (t1 - t0)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - minV) / (maxV - minV)) * (H - pad.t - pad.b);

  let d = `M ${x(t0)} ${y(points[0].rating)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` H ${x(points[i].at.getTime())} V ${y(points[i].rating)}`;
  }
  d += ` H ${x(t1)}`;

  const ticks: number[] = [];
  for (let v = minV; v <= maxV + 1e-9; v += 0.25) ticks.push(Math.round(v * 100) / 100);
  const xLabels = [t0, (t0 + t1) / 2, t1];
  const first = points[0].rating;
  const last = points[points.length - 1].rating;
  const change = last - first;

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Ratingudvikling fra ${formatRating(first)} til ${formatRating(last)} siden ${formatMonthDay(points[0].at)}`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="#d3ddd8" strokeWidth="1" />
            <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" fontSize="12" fill="#52625b" className="num">
              {formatRating(v).slice(0, 4)}
            </text>
          </g>
        ))}
        {attended
          .filter((a) => a.getTime() >= t0 && a.getTime() <= t1)
          .map((a, i) => (
            <line key={i} x1={x(a.getTime())} x2={x(a.getTime())} y1={H - pad.b} y2={H - pad.b + 6} stroke="#1f5c4a" strokeWidth="2" />
          ))}
        <path d={d} fill="none" stroke="#1f5c4a" strokeWidth="3" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={i} cx={x(p.at.getTime())} cy={y(p.rating)} r="4.5" fill="#d7e54b" stroke="#13221c" strokeWidth="1.5" />
        ))}
        {xLabels.map((t, i) => (
          <text key={i} x={x(t)} y={H - 8} fontSize="12" fill="#52625b" textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}>
            {i === 2 ? "I dag" : formatMonthDay(new Date(t))}
          </text>
        ))}
      </svg>
      <figcaption className="mt-2 text-sm text-muted">
        {points.length === 1
          ? "Første verificerede måling. Kurven vokser, efterhånden som din rating ændrer sig."
          : `${change >= 0 ? "+" : "−"}${formatRating(Math.abs(change))} siden ${formatMonthDay(points[0].at)}. Streger under aksen markerer træninger, du har deltaget i.`}
      </figcaption>
      <table className="sr-only">
        <caption>Verificerede ratingmålinger</caption>
        <thead>
          <tr>
            <th>Dato</th>
            <th>Rating</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={i}>
              <td>{formatMonthDay(p.at)}</td>
              <td>{formatRating(p.rating)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
