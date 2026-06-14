import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where the fault-injection harness writes its latest summary (served to the dashboard). */
export const HARNESS_RESULT_PATH =
  process.env.HARNESS_RESULT_PATH ??
  resolve(dirname(fileURLToPath(import.meta.url)), '../../harness/last-run.json');

export async function writeFaultRun(result: unknown): Promise<void> {
  await mkdir(dirname(HARNESS_RESULT_PATH), { recursive: true });
  await writeFile(HARNESS_RESULT_PATH, JSON.stringify(result, null, 2), 'utf8');
}

export async function readLatestFaultRun(): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(HARNESS_RESULT_PATH, 'utf8'));
  } catch {
    return null;
  }
}
