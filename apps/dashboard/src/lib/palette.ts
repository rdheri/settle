import type { AccountType } from './api';

/** Account-type colors, consistent across badges and charts (work on both themes). */
export const TYPE_COLORS: Record<AccountType, string> = {
  asset: '#34d399',
  liability: '#fbbf24',
  equity: '#a78bfa',
  revenue: '#22d3ee',
  expense: '#fb7185',
};

export const CHART = {
  primary: '#34d399',
  secondary: '#6366f1',
  grid: 'rgba(148, 163, 184, 0.12)',
  axis: 'rgba(148, 163, 184, 0.5)',
};

/** A rotating palette for donut slices when more colors are needed. */
export const SLICE_COLORS = ['#34d399', '#22d3ee', '#6366f1', '#a78bfa', '#fbbf24', '#fb7185'];
