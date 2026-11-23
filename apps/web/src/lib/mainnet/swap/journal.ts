import { z } from 'zod';
import { MainnetAccountSchema } from '@taply/shared';
import { SwapStepSchema, isSwapAssetId, type SwapAssetId, type SwapStep } from './model';

/**
 * Swap jobs on this device (a dedicated swap record, never a payment receipt).
 *
 * The device signing ledger (Codex coordinator) remains the source of truth for
 * "was a transaction reserved/handed off/finalised". This journal only remembers
 * WHICH swap a step belongs to, so a refresh resumes the same job instead of
 * starting a new one. A step whose outcome is not proven is `unknown` and blocks
 * the job: it is never re-sent from here.
 */
export type StepStatus = 'pending' | 'signing' | 'unknown' | 'done' | 'failed' | 'refunded' | 'not_delivered';
export type JobStatus = 'active' | 'completed' | 'refunded' | 'failed' | 'partial' | 'unknown' | 'cancelled';

const Hash = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const U = z.string().regex(/^(0|[1-9][0-9]{0,38})$/);
const StepRecord = z.strictObject({
  step: SwapStepSchema,
  status: z.enum(['pending', 'signing', 'unknown', 'done', 'failed', 'refunded', 'not_delivered']),
  operationHash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  txHash: Hash.nullable(),
  /** Verified amount the step moved (swap: amount out; wrap/unwrap: amount). */
  amount: U.nullable(),
});
const Job = z.strictObject({
  v: z.literal(1),
  id: z.string().regex(/^[0-9a-f]{64}$/),
  accountId: MainnetAccountSchema,
  from: z.string().refine(isSwapAssetId),
  to: z.string().refine(isSwapAssetId),
  amountIn: U,
  expectedOut: U,
  minOut: U,
  slippageBps: z.number().int().min(1).max(500),
  priceImpactBps: z.number().int().min(0).max(10000),
  quoteBlock: z.string().regex(/^[0-9]{1,20}$/),
  steps: z.array(StepRecord).min(1).max(6),
  status: z.enum(['active', 'completed', 'refunded', 'failed', 'partial', 'unknown', 'cancelled']),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
});
export type SwapJob = Omit<z.infer<typeof Job>, 'from' | 'to' | 'steps'> & { from: SwapAssetId; to: SwapAssetId; steps: Array<Omit<z.infer<typeof StepRecord>, 'step'> & { step: SwapStep }> };
const Store = z.strictObject({ jobs: z.array(Job).max(50) });

export const SWAP_JOURNAL_PREFIX = 'taply.mainnet.swap.v1:';
export function swapJournalKey(accountId: string): string { return SWAP_JOURNAL_PREFIX + MainnetAccountSchema.parse(accountId); }

export class SwapJournalError extends Error { constructor(readonly code: 'CORRUPT' | 'ACTIVE_JOB_EXISTS' | 'NOT_FOUND' | 'STORAGE_UNAVAILABLE') { super(code); } }

export function loadSwapJobs(storage: Pick<Storage, 'getItem'>, accountId: string): SwapJob[] {
  const raw = storage.getItem(swapJournalKey(accountId));
  if (raw === null) return [];
  if (raw.length > 200_000) throw new SwapJournalError('CORRUPT');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new SwapJournalError('CORRUPT'); }
  const r = Store.safeParse(parsed);
  // A corrupt journal fails closed (no new swap), never silently replaced.
  if (!r.success) throw new SwapJournalError('CORRUPT');
  return r.data.jobs as SwapJob[];
}
function save(storage: Pick<Storage, 'setItem' | 'getItem'>, accountId: string, jobs: SwapJob[]): void {
  const value = JSON.stringify(Store.parse({ jobs: jobs.slice(-50) }));
  try { storage.setItem(swapJournalKey(accountId), value); } catch { throw new SwapJournalError('STORAGE_UNAVAILABLE'); }
  if (storage.getItem(swapJournalKey(accountId)) !== value) throw new SwapJournalError('STORAGE_UNAVAILABLE');
}
export const isOpenJob = (j: SwapJob) => j.status === 'active' || j.status === 'unknown';
export function activeSwapJob(jobs: readonly SwapJob[]): SwapJob | null { return jobs.find(isOpenJob) ?? null; }

/** One open job per account on this device; a second tab sees the first job instead of creating another. */
export function createSwapJob(storage: Pick<Storage, 'setItem' | 'getItem'>, job: Omit<SwapJob, 'v' | 'status' | 'createdAt' | 'updatedAt' | 'steps'> & { steps: SwapStep[] }, now = Date.now()): SwapJob {
  const jobs = loadSwapJobs(storage, job.accountId);
  if (activeSwapJob(jobs)) throw new SwapJournalError('ACTIVE_JOB_EXISTS');
  const created: SwapJob = { ...job, v: 1, status: 'active', createdAt: now, updatedAt: now,
    steps: job.steps.map(step => ({ step, status: 'pending', operationHash: null, txHash: null, amount: null })) };
  save(storage, job.accountId, [...jobs, created]);
  return created;
}
export function updateSwapJob(storage: Pick<Storage, 'setItem' | 'getItem'>, accountId: string, id: string, change: (job: SwapJob) => SwapJob, now = Date.now()): SwapJob {
  const jobs = loadSwapJobs(storage, accountId);
  const i = jobs.findIndex(j => j.id === id);
  if (i < 0) throw new SwapJournalError('NOT_FOUND');
  const next = { ...change(structuredClone(jobs[i]!)), updatedAt: now };
  jobs[i] = next;
  save(storage, accountId, jobs);
  return next;
}

/** Job status from its steps. Never 'completed' unless every step is verified done. */
export function deriveJobStatus(job: SwapJob): JobStatus {
  if (job.status === 'cancelled') return 'cancelled';
  const s = job.steps.map(x => x.status);
  if (s.every(x => x === 'done')) return 'completed';
  if (s.includes('unknown') || s.includes('signing')) return s.includes('unknown') ? 'unknown' : 'active';
  const swap = job.steps.find(x => x.step.kind === 'swap');
  if (swap?.status === 'refunded') return job.steps.some(x => x.step.kind === 'wrap' && x.status === 'done') ? 'partial' : 'refunded';
  if (s.includes('not_delivered')) return 'partial';
  if (s.includes('failed')) return job.steps.some(x => x.status === 'done' && x.step.kind !== 'register') ? 'partial' : 'failed';
  return 'active';
}
export function nextPendingStep(job: SwapJob): number {
  const firstOpen = job.steps.findIndex(x => x.status !== 'done');
  if (firstOpen < 0) return -1;
  return job.steps[firstOpen]!.status === 'pending' ? firstOpen : -1;
}
export function swapOutput(job: SwapJob): string | null {
  const s = job.steps.find(x => x.step.kind === 'swap' && x.status === 'done');
  return s?.amount ?? null;
}
