import {
  ArrowLeftRight,
  ArrowRight,
  Coins,
  Database,
  Send,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AreaChart, BarChart, Donut } from '../components/charts';
import { Card, CardHeader, EmptyState, Skeleton, StatCard } from '../components/ui';
import { AnimatedNumber } from '../components/ui';
import { useData } from '../lib/dataContext';
import {
  assetDistribution,
  cumulativeVolume,
  totalAssets,
  txSize,
  volumeSeries,
} from '../lib/derive';
import { fmtCurrency, fmtCurrencyCompact, fmtInt, fmtRelativeTime } from '../lib/format';
import { TYPE_COLORS } from '../lib/palette';
import { seedDemoData } from '../lib/seed';
import { useToast } from '../lib/toast';

export function Overview(): React.JSX.Element {
  const { accounts, transactions, recon, outbox, loading, refresh } = useData();
  const toast = useToast();
  const [seeding, setSeeding] = useState(false);

  const handleSeed = async (): Promise<void> => {
    setSeeding(true);
    try {
      await seedDemoData();
      toast.push('success', 'Sample ledger generated');
      await refresh();
    } catch (e) {
      toast.push('error', e instanceof Error ? e.message : 'Seeding failed');
    } finally {
      setSeeding(false);
    }
  };

  if (loading && !recon) {
    return (
      <div className="page">
        <div className="kpi-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="skeleton-stat" />
          ))}
        </div>
        <Skeleton className="skeleton-chart" />
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="page">
        <Card>
          <EmptyState icon={Sparkles} title="No accounts yet">
            <p>Generate sample data to populate balances, charts, and the reconciliation view.</p>
            <button
              className="btn btn-primary"
              disabled={seeding}
              onClick={() => void handleSeed()}
            >
              {seeding ? 'Generating…' : 'Generate sample data'}
            </button>
          </EmptyState>
        </Card>
      </div>
    );
  }

  const assets = totalAssets(accounts);
  const cumVol = cumulativeVolume(transactions);
  const recentVol = volumeSeries(transactions, 30);
  const donut = assetDistribution(accounts);
  const recent = transactions.slice(0, 6);

  return (
    <div className="page">
      {/* Hero */}
      <div className="hero">
        <Card className="hero-main" index={0}>
          <span className="hero-label">Total assets under ledger</span>
          <AnimatedNumber className="hero-value" value={assets} format={fmtCurrency} />
          <div className="hero-meta">
            <span className={`chip ${recon?.balanced ? 'chip-ok' : 'chip-bad'}`}>
              <ShieldCheck size={14} />
              {recon?.balanced ? 'Books balanced' : 'Drift detected'}
            </span>
            <span className="muted">
              {fmtInt(recon?.transaction_count ?? 0)} transactions ·{' '}
              {fmtInt(recon?.entry_count ?? 0)} entries
            </span>
          </div>
        </Card>

        <Card className="hero-proof" index={1}>
          <span className="hero-label">Global signed sum</span>
          <div className="proof-value-row">
            <AnimatedNumber
              className={`proof-value ${recon?.global_signed_sum === 0 ? 'proof-ok' : 'proof-bad'}`}
              value={recon?.global_signed_sum ?? 0}
              format={fmtInt}
            />
            {recon?.global_signed_sum === 0 && <span className="proof-check">✓</span>}
          </div>
          <p className="muted small">
            Every debit is matched by a credit, so the signed sum of all{' '}
            {fmtInt(recon?.entry_count ?? 0)} entries is zero. The books reconcile.
          </p>
        </Card>
      </div>

      {/* KPIs */}
      <div className="kpi-grid">
        <StatCard
          label="Total assets"
          value={assets}
          format={fmtCurrencyCompact}
          icon={Coins}
          accent={TYPE_COLORS.asset}
          index={0}
        />
        <StatCard
          label="Transactions"
          value={recon?.transaction_count ?? 0}
          format={fmtInt}
          icon={ArrowLeftRight}
          accent="#6366f1"
          index={1}
        />
        <StatCard
          label="Ledger entries"
          value={recon?.entry_count ?? 0}
          format={fmtInt}
          icon={Database}
          accent="#22d3ee"
          index={2}
        />
        <StatCard
          label="Events published"
          value={outbox?.published ?? 0}
          format={fmtInt}
          icon={Send}
          accent="#a78bfa"
          index={3}
        />
      </div>

      {/* Charts */}
      <div className="chart-row">
        <Card className="chart-card-wide" index={0}>
          <CardHeader title="Cumulative volume settled" sub="recent activity" />
          <AreaChart data={cumVol} />
        </Card>
        <Card className="chart-card-narrow" index={1}>
          <CardHeader title="Assets by account" />
          <div className="donut-wrap">
            <Donut slices={donut} />
            <ul className="legend">
              {donut.slice(0, 5).map((s) => (
                <li key={s.label}>
                  <span className="legend-dot" style={{ background: s.color }} />
                  <span className="legend-label">{s.label}</span>
                  <span className="legend-value mono">{fmtCurrencyCompact(s.value)}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      <Card index={0}>
        <CardHeader title="Transaction volume" sub="size of recent transactions" />
        <BarChart data={recentVol} color="#6366f1" />
      </Card>

      {/* Recent activity */}
      <Card index={0}>
        <CardHeader
          title="Recent activity"
          icon={ArrowLeftRight}
          action={
            <Link to="/ledger" className="link-action">
              View ledger <ArrowRight size={14} />
            </Link>
          }
        />
        <div className="activity-list">
          {recent.map((tx, i) => (
            <div
              key={tx.id}
              className="activity-row rise"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <div className="activity-icon">
                <ArrowLeftRight size={15} />
              </div>
              <div className="activity-desc">
                <span className="activity-title">{tx.description || 'Transaction'}</span>
                <span className="muted small">{fmtRelativeTime(tx.created_at)}</span>
              </div>
              <span className="activity-amount mono">{fmtCurrency(txSize(tx))}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
