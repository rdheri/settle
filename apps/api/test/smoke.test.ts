import { describe, it, expect } from 'vitest';
import { AccountType, Direction, Money } from '@settle/shared';

describe('phase 0 — toolchain smoke', () => {
  it('resolves shared contracts across the workspace', () => {
    expect(AccountType.options).toContain('asset');
    expect(Direction.options).toEqual(['debit', 'credit']);
  });

  it('Money rejects floats and accepts integer cents', () => {
    expect(Money.safeParse(1000).success).toBe(true);
    expect(Money.safeParse(10.5).success).toBe(false);
  });
});
