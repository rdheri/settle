import {
  CheckCircle2,
  CircleSlash,
  Gauge,
  Layers,
  Repeat,
  ShieldCheck,
  XCircle,
  Zap,
} from 'lucide-react';
import { AnimatedNumber, Card, CardHeader, EmptyState } from '../components/ui';
import { useData } from '../lib/dataContext';
import type { FaultRunSummary } from '../lib/api';
import { fmtInt, fmtRelativeTime } from '../lib/format';

export function Reliability(): React.JSX.Element {
  const { recon, metrics, outbox, fault } = useData();

  return (
    <div className="page">
      {/* Live invariant proof */}
      <div className="rel-top">
        <Card className={`proof-card ${recon?.balanced ? 'proof-card-ok' : 'proof-card-bad'}`} index={0}>
          <div className="proof-card-icon">
            {recon?.balanced ? <ShieldCheck size={26} /> : <XCircle size={26} />}
          </div>
          <div>
            <span className="hero-label">Live double-entry invariant</span>
            <div className="proof-card-status">
              {recon ? (recon.balanced ? 'BOOKS BALANCED' : 'DRIFT DETECTED') : 'Checking…'}
            </div>
            <p className="muted small">
              Global signed sum of all {fmtInt(recon?.entry_count ?? 0)} entries ={' '}
              <span className="mono strong">{fmtInt(recon?.global_signed_sum ?? 0)}</span>
              {recon?.anomalies.length ? ` · ${recon.anomalies.length} anomalies` : ' · no anomalies'}
            </p>
          </div>
        </Card>

        <div className="rel-metrics">
          <MetricTile icon={Repeat} label="Serialization retries" value={metrics?.serialization_retries ?? 0} accent="#6366f1" />
          <MetricTile icon={CircleSlash} label="Deadlock retries" value={metrics?.deadlock_retries ?? 0} accent="#a78bfa" />
          <MetricTile icon={Layers} label="Outbox published" value={outbox?.published ?? 0} accent="#22d3ee" />
          <MetricTile icon={Layers} label="Outbox pending" value={outbox?.pending ?? 0} accent="#fbbf24" />
        </div>
      </div>

      {/* Fault-injection harness */}
      <Card index={1}>
        <CardHeader title="Fault-injection harness" icon={Zap} sub="latest run" />
        {fault ? <HarnessResults fault={fault} /> : <NoRun />}
      </Card>
    </div>
  );
}

function MetricTile({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Repeat;
  label: string;
  value: number;
  accent: string;
}): React.JSX.Element {
  return (
    <div className="metric-tile">
      <span className="metric-tile-icon" style={{ color: accent, background: `${accent}1a` }}>
        <Icon size={15} />
      </span>
      <AnimatedNumber className="metric-tile-value" value={value} format={fmtInt} />
      <span className="metric-tile-label">{label}</span>
    </div>
  );
}

function HarnessResults({ fault }: { fault: FaultRunSummary }): React.JSX.Element {
  return (
    <>
      <div className={`harness-banner ${fault.passed ? 'harness-ok' : 'harness-bad'}`}>
        {fault.passed ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
        {fault.passed ? 'ALL GUARANTEES HELD' : 'FAILURE DETECTED'}
        <span className="harness-banner-sub">
          {fmtInt(fault.duration_ms)} ms · finished {fmtRelativeTime(fault.finished_at)}
        </span>
      </div>

      <div className="kpi-grid kpi-grid-6">
        <BigStat label="Operations attempted" value={fault.operations_attempted} />
        <BigStat label="Applied exactly once" value={fault.applied_exactly_once} highlight />
        <BigStat label="Duplicates short-circuited" value={fault.duplicates_short_circuited} />
        <BigStat label="Serialization retries" value={fault.serialization_retries} />
        <BigStat label="Final balance drift" value={fault.final_balance_drift} bad={fault.final_balance_drift !== 0} good={fault.final_balance_drift === 0} />
        <BigStat label="Throughput (ops/sec)" value={Math.round(fault.throughput_per_sec)} icon={Gauge} />
      </div>

      <div className="scenario-grid">
        {fault.scenarios.map((s, i) => (
          <div key={s.name} className="scenario rise" style={{ animationDelay: `${i * 70}ms` }}>
            <div className="scenario-head">
              <span className={`scenario-badge ${s.passed ? 'scenario-pass' : 'scenario-fail'}`}>
                {s.passed ? 'PASS' : 'FAIL'}
              </span>
              <span className="scenario-name">{s.name}</span>
            </div>
            <p className="muted small">{s.description}</p>
            <div className="scenario-metrics">
              {Object.entries(s.metrics).map(([k, v]) => (
                <span key={k} className="scenario-metric">
                  <span className="muted">{k.replace(/_/g, ' ')}</span>
                  <span className="mono strong">{String(v)}</span>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function BigStat({
  label,
  value,
  highlight,
  good,
  bad,
  icon: Icon,
}: {
  label: string;
  value: number;
  highlight?: boolean;
  good?: boolean;
  bad?: boolean;
  icon?: typeof Gauge;
}): React.JSX.Element {
  return (
    <div className={`big-stat ${highlight ? 'big-stat-hl' : ''}`}>
      <span className="big-stat-label">
        {Icon && <Icon size={13} />} {label}
      </span>
      <AnimatedNumber
        className={`big-stat-value ${good ? 'proof-ok' : ''} ${bad ? 'proof-bad' : ''}`}
        value={value}
        format={fmtInt}
      />
    </div>
  );
}

function NoRun(): React.JSX.Element {
  return (
    <EmptyState icon={Zap} title="No harness run recorded yet">
      <p>
        Run the fault-injection harness to prove exactly-once money movement under concurrency and crash retries:
      </p>
      <code className="code-block">pnpm harness</code>
      <p className="muted small">Results stream here automatically once the run completes.</p>
    </EmptyState>
  );
}
