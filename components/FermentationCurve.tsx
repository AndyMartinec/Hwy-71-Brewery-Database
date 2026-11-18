/** Gravity (°Plato) over time as a simple SVG line chart. */

export default function FermentationCurve({
  readings,
}: {
  readings: { taken_at: string; plato: number | null }[];
}) {
  const pts = readings
    .filter((r) => r.plato != null)
    .map((r) => ({ t: new Date(r.taken_at).getTime(), p: Number(r.plato) }))
    .sort((a, b) => a.t - b.t);
  if (pts.length < 2) {
    return (
      <p className="py-2 text-sm text-stone-500">
        Not enough readings for a curve yet — two or more and I&apos;ll draw
        it.
      </p>
    );
  }

  const W = 620;
  const H = 230;
  const padL = 46;
  const padR = 14;
  const padT = 14;
  const padB = 30;
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  let pMin = Math.min(...pts.map((p) => p.p));
  let pMax = Math.max(...pts.map((p) => p.p));
  if (pMax - pMin < 1) {
    pMax += 0.5;
    pMin = Math.max(0, pMin - 0.5);
  }
  const X = (t: number) =>
    t1 === t0 ? padL : padL + ((t - t0) / (t1 - t0)) * (W - padL - padR);
  const Y = (p: number) =>
    padT + (1 - (p - pMin) / (pMax - pMin)) * (H - padT - padB);
  const line = pts
    .map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)},${Y(p.p).toFixed(1)}`)
    .join(" ");
  const ticks = [pMax, (pMax + pMin) / 2, pMin];
  const fmtD = (t: number) =>
    new Date(t).toLocaleDateString([], { month: "numeric", day: "numeric" });

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="Fermentation curve (gravity over time)"
    >
      {ticks.map((v) => (
        <g key={v}>
          <line
            x1={padL}
            x2={W - padR}
            y1={Y(v)}
            y2={Y(v)}
            stroke="#e7e5e4"
            strokeWidth="1"
          />
          <text
            x={padL - 8}
            y={Y(v) + 4}
            textAnchor="end"
            fontSize="11"
            fill="#a8a29e"
          >
            {v.toFixed(1)}°
          </text>
        </g>
      ))}
      <path d={line} fill="none" stroke="#8f531c" strokeWidth="2.5" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={X(p.t)} cy={Y(p.p)} r="3.5" fill="#8f531c" stroke="#fff" strokeWidth="1.5" />
      ))}
      <text x={padL} y={H - 8} fontSize="11" fill="#a8a29e">
        {fmtD(t0)}
      </text>
      <text x={W - padR} y={H - 8} textAnchor="end" fontSize="11" fill="#a8a29e">
        {fmtD(t1)}
      </text>
    </svg>
  );
}
