import { createHash } from 'node:crypto';

/** Stable JSON serialization: object keys sorted, so {a,b} and {b,a} hash equal. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

/**
 * A fingerprint of the write request. Reusing an idempotency key with a
 * different fingerprint is an error (422): keys must not be reused for different
 * payloads.
 */
export function fingerprint(method: string, path: string, body: unknown): string {
  return createHash('sha256')
    .update(`${method}\n${path}\n${canonicalJson(body)}`)
    .digest('hex');
}
