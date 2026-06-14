import { z } from 'zod';

/**
 * SETTLE shared contracts.
 *
 * Money is ALWAYS an integer number of minor units (e.g. cents). It is validated
 * as a safe integer so a float can never enter the system. At the database layer
 * the corresponding column is BIGINT. Fleshed out further in Phases 2–4.
 */

/** Integer minor units (cents). Never a float; bounded to JS safe-integer range. */
export const Money = z.number().int().safe();
export type Money = z.infer<typeof Money>;

export const AccountType = z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']);
export type AccountType = z.infer<typeof AccountType>;

export const Direction = z.enum(['debit', 'credit']);
export type Direction = z.infer<typeof Direction>;

export const SETTLE_VERSION = '0.0.0';
