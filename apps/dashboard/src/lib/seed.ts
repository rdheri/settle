import { api } from './api';
import type { AccountResponse } from './api';

const rand = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T>(arr: T[]): T => arr[rand(0, arr.length - 1)]!;

/**
 * Create a realistic sample ledger so the dashboard's charts and tables are
 * populated. Every write is idempotent and balanced — this exercises the real API.
 */
export async function seedDemoData(
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const equity = await api.createAccount('Equity Capital', 'equity');
  const revenue = await api.createAccount('Sales Revenue', 'revenue');
  const expense = await api.createAccount('Operating Expense', 'expense');

  const assetNames = ['Operating Cash', 'Savings Reserve', 'Merchant Wallet', 'Payroll Account'];
  const assets: AccountResponse[] = [];
  for (const name of assetNames) {
    assets.push(await api.createAccount(name, 'asset'));
  }

  // Opening capital into Operating Cash.
  await api.createTransaction({
    description: 'Opening capital',
    entries: [
      { account_id: assets[0]!.id, amount: 5_000_000, direction: 'debit' },
      { account_id: equity.id, amount: 5_000_000, direction: 'credit' },
    ],
  });

  const STEPS = 44;
  let done = 0;
  const tick = (): void => onProgress?.(++done, STEPS);

  for (let i = 0; i < STEPS; i++) {
    const roll = Math.random();
    try {
      if (roll < 0.4) {
        // Revenue: debit an asset, credit revenue.
        const amount = rand(50, 4000) * 100;
        await api.createTransaction({
          description: pick([
            'Card settlement',
            'Invoice paid',
            'Subscription charge',
            'Payout received',
          ]),
          entries: [
            { account_id: pick(assets).id, amount, direction: 'debit' },
            { account_id: revenue.id, amount, direction: 'credit' },
          ],
        });
      } else if (roll < 0.65) {
        // Expense: debit expense, credit an asset.
        const amount = rand(20, 1500) * 100;
        await api.createTransaction({
          description: pick(['Cloud bill', 'Vendor payment', 'Office supplies', 'Fees']),
          entries: [
            { account_id: expense.id, amount, direction: 'debit' },
            { account_id: assets[0]!.id, amount, direction: 'credit' },
          ],
        });
      } else {
        // Transfer between two asset accounts.
        const from = assets[0]!;
        let to = pick(assets);
        while (to.id === from.id) to = pick(assets);
        const amount = rand(100, 3000) * 100;
        await api.transfer(from.id, to.id, amount, `Sweep to ${to.name}`);
      }
    } catch {
      // Insufficient funds etc. are fine during seeding; keep going.
    }
    tick();
  }
}
