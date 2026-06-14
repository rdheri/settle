/** Format integer minor units (cents) as a major-unit string, e.g. -50000 -> "-500.00". */
export function fmtMinor(n: number): string {
  return (n / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}
