import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { AccountType } from '../lib/api';
import { TYPE_COLORS } from '../lib/palette';

/** Smoothly tween a number toward `value` (ease-out cubic). Starts at the final
 *  value, so content is correct even if rAF is throttled (e.g. background tab). */
export function useCountUp(value: number, duration = 800): number {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);

  useEffect(() => {
    const from = prev.current;
    const to = value;
    if (from === to) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number): void => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else prev.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return display;
}

export function AnimatedNumber({
  value,
  format,
  className,
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
}): React.JSX.Element {
  const animated = useCountUp(value);
  return <span className={className}>{format(animated)}</span>;
}

/** A small CSS-driven entrance (transform only — never hides content). */
function riseStyle(index: number): CSSProperties {
  return { animationDelay: `${index * 55}ms` };
}

export function Card({
  children,
  className = '',
  index = 0,
}: {
  children: ReactNode;
  className?: string;
  index?: number;
}): React.JSX.Element {
  return (
    <section className={`card rise ${className}`} style={riseStyle(index)}>
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  icon: Icon,
  action,
  sub,
}: {
  title: string;
  icon?: LucideIcon;
  action?: ReactNode;
  sub?: string;
}): React.JSX.Element {
  return (
    <div className="card-header">
      <div className="card-header-title">
        {Icon && <Icon size={16} className="card-header-icon" />}
        <h2>{title}</h2>
        {sub && <span className="card-header-sub">{sub}</span>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  format,
  icon: Icon,
  accent = 'var(--accent)',
  hint,
  index = 0,
}: {
  label: string;
  value: number;
  format: (n: number) => string;
  icon: LucideIcon;
  accent?: string;
  hint?: ReactNode;
  index?: number;
}): React.JSX.Element {
  return (
    <div className="stat-card rise" style={riseStyle(index)}>
      <div className="stat-card-top">
        <span className="stat-card-label">{label}</span>
        <span className="stat-card-icon" style={{ color: accent, background: `${accent}1a` }}>
          <Icon size={16} />
        </span>
      </div>
      <AnimatedNumber className="stat-card-value" value={value} format={format} />
      {hint && <div className="stat-card-hint">{hint}</div>}
    </div>
  );
}

export function TypeBadge({ type }: { type: AccountType }): React.JSX.Element {
  const color = TYPE_COLORS[type];
  return (
    <span
      className="type-badge"
      style={{ color, borderColor: `${color}40`, background: `${color}14` }}
    >
      {type}
    </span>
  );
}

export function Skeleton({ className = '' }: { className?: string }): React.JSX.Element {
  return <div className={`skeleton ${className}`} />;
}

export function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <Icon size={26} />
      </div>
      <h3>{title}</h3>
      {children}
    </div>
  );
}
