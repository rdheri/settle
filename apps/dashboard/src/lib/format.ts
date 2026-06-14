/** Integer minor units (cents) -> major-unit string, e.g. -50000 -> "-500.00". */
export function fmtMinor(n: number): string {
  return (n / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Compact currency for large headline numbers, e.g. 5_000_000 cents -> "$50.0K". */
export function fmtCurrencyCompact(cents: number): string {
  const major = cents / 100;
  const sign = major < 0 ? '-' : '';
  const abs = Math.abs(major);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

export function fmtCurrency(cents: number): string {
  return `${cents < 0 ? '-' : ''}$${fmtMinor(Math.abs(cents))}`;
}

export function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function fmtRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffSec = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return RELATIVE.format(Math.round(diffSec), 'second');
  if (abs < 3600) return RELATIVE.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return RELATIVE.format(Math.round(diffSec / 3600), 'hour');
  return RELATIVE.format(Math.round(diffSec / 86400), 'day');
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour12: false });
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}
