import { useId } from 'react';

type Point = readonly [number, number];

/** Catmull-Rom → cubic bézier for a smooth line through all points. */
function smoothPath(pts: Point[]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0]![0]},${pts[0]![1]}`;
  const d = [`M ${pts[0]![0]},${pts[0]![1]}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d.push(`C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2[0]},${p2[1]}`);
  }
  return d.join(' ');
}

export function AreaChart({
  data,
  height = 220,
  color = '#34d399',
}: {
  data: number[];
  height?: number;
  color?: string;
}): React.JSX.Element {
  const gid = useId().replace(/:/g, '');
  const W = 1000;
  const H = 320;
  const pad = 12;

  if (data.length < 2) {
    return (
      <div className="chart-empty" style={{ height }}>
        Not enough activity yet
      </div>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const xs = (i: number): number => (i / (data.length - 1)) * W;
  const ys = (v: number): number => H - pad - ((v - min) / range) * (H - 2 * pad);
  const pts: Point[] = data.map((v, i) => [xs(i), ys(v)]);
  const line = smoothPath(pts);
  const area = `${line} L ${W},${H} L 0,${H} Z`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="chart-svg chart-draw"
      style={{ height }}
    >
      <defs>
        <linearGradient id={`area-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.34" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((g) => (
        <line
          key={g}
          x1="0"
          x2={W}
          y1={H * g}
          y2={H * g}
          stroke="var(--chart-grid)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <path d={area} fill={`url(#area-${gid})`} />
      <path
        className="chart-line"
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function BarChart({
  data,
  height = 180,
  color = '#6366f1',
}: {
  data: number[];
  height?: number;
  color?: string;
}): React.JSX.Element {
  const W = 1000;
  const H = 320;
  const gap = 0.32;

  if (data.length === 0) {
    return (
      <div className="chart-empty" style={{ height }}>
        No transactions yet
      </div>
    );
  }

  const max = Math.max(...data, 1);
  const bw = W / data.length;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="chart-svg"
      style={{ height }}
    >
      {data.map((v, i) => {
        const h = (v / max) * (H - 8);
        const x = i * bw + (bw * gap) / 2;
        const w = bw * (1 - gap);
        return (
          <rect
            key={i}
            className="chart-bar"
            x={x}
            y={H - h}
            width={w}
            height={h}
            rx={3}
            fill={color}
            style={{ animationDelay: `${i * 14}ms` }}
          />
        );
      })}
    </svg>
  );
}

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

export function Donut({
  slices,
  size = 190,
}: {
  slices: DonutSlice[];
  size?: number;
}): React.JSX.Element {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const cx = 100;
  const cy = 100;
  const r = 78;
  const sw = 24;
  const circ = 2 * Math.PI * r;

  if (total <= 0) {
    return (
      <div className="chart-empty" style={{ height: size }}>
        No balances yet
      </div>
    );
  }

  let offset = 0;
  return (
    <svg viewBox="0 0 200 200" style={{ width: size, height: size }} className="donut">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--chart-grid)" strokeWidth={sw} />
      {slices.map((s) => {
        const dash = (s.value / total) * circ;
        const el = (
          <circle
            key={s.label}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={sw}
            strokeLinecap="butt"
            transform={`rotate(-90 ${cx} ${cy})`}
            strokeDasharray={`${dash} ${circ - dash}`}
            strokeDashoffset={-offset}
          />
        );
        offset += dash;
        return el;
      })}
    </svg>
  );
}

export function Sparkline({
  data,
  color = '#34d399',
  width = 120,
  height = 40,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}): React.JSX.Element | null {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data
    .map(
      (v, i) =>
        `${(i / (data.length - 1)) * width},${height - 3 - ((v - min) / range) * (height - 6)}`,
    )
    .join(' ');
  return (
    <svg width={width} height={height} className="sparkline" aria-hidden>
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
