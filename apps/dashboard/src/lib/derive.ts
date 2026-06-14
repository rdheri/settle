import type { AccountWithBalance, TransactionResponse } from './api';
import { SLICE_COLORS } from './palette';

/** Sum of the debit legs of a transaction = its "size" / volume. */
export function txSize(tx: TransactionResponse): number {
  return tx.entries
    .filter((e) => e.direction === 'debit')
    .reduce((sum, e) => sum + e.amount, 0);
}

export function totalAssets(accounts: AccountWithBalance[]): number {
  return accounts.filter((a) => a.type === 'asset').reduce((s, a) => s + a.balance, 0);
}

/** Cumulative settled volume over the fetched window, oldest → newest. */
export function cumulativeVolume(transactions: TransactionResponse[]): number[] {
  const chrono = [...transactions].reverse();
  let running = 0;
  return chrono.map((tx) => {
    running += txSize(tx);
    return running / 100; // major units for nicer axis
  });
}

/** Per-transaction size for the most recent `n` transactions, oldest → newest. */
export function volumeSeries(transactions: TransactionResponse[], n = 24): number[] {
  return [...transactions]
    .slice(0, n)
    .reverse()
    .map((tx) => txSize(tx) / 100);
}

export interface Slice {
  label: string;
  value: number;
  color: string;
}

/** Donut slices: where the money sits (asset balances), largest first. */
export function assetDistribution(accounts: AccountWithBalance[]): Slice[] {
  return accounts
    .filter((a) => a.type === 'asset' && a.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .map((a, i) => ({
      label: a.name,
      value: a.balance,
      color: SLICE_COLORS[i % SLICE_COLORS.length]!,
    }));
}
