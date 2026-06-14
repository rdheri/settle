import { createContext, useContext } from 'react';
import type { SettleData } from './useSettleData';

export const DataContext = createContext<SettleData | null>(null);

export function useData(): SettleData {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataContext');
  return ctx;
}
