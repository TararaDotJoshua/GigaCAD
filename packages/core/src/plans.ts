/**
 * GigaCAD's plans. Storage is the only limit: it counts every distinct file version
 * in the projects an account owns, including release and branch history.
 */

const GB = 1024 ** 3;
const TB = 1024 ** 4;

export const PLAN_IDS = ['free', 'maker', 'builder', 'workshop', 'studio'] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export type BillingInterval = 'monthly' | 'yearly';

export interface Plan {
  readonly id: PlanId;
  readonly name: string;
  /** US dollars per month when billed monthly. */
  readonly monthlyUsd: number;
  /** US dollars per year when billed yearly: ten months' price. */
  readonly yearlyUsd: number;
  readonly storageBytes: number;
  readonly summary: string;
}

export const PLANS: readonly Plan[] = [
  { id: 'free', name: 'Free', monthlyUsd: 0, yearlyUsd: 0, storageBytes: 5 * GB, summary: 'Trying GigaCAD, small public or personal projects.' },
  { id: 'maker', name: 'Maker', monthlyUsd: 6, yearlyUsd: 60, storageBytes: 25 * GB, summary: 'Individual hobby CAD work.' },
  { id: 'builder', name: 'Builder', monthlyUsd: 15, yearlyUsd: 150, storageBytes: 100 * GB, summary: 'Active multi-project builders.' },
  { id: 'workshop', name: 'Workshop', monthlyUsd: 39, yearlyUsd: 390, storageBytes: 500 * GB, summary: 'Serious assemblies and retained release history.' },
  { id: 'studio', name: 'Studio', monthlyUsd: 99, yearlyUsd: 990, storageBytes: 2 * TB, summary: 'Small teams with large libraries.' },
];

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value);
}

export function getPlan(id: PlanId): Plan {
  return PLANS.find((plan) => plan.id === id)!;
}

/** The payment provider's price key for a paid plan, e.g. `gigacad_maker_yearly`. */
export function priceLookupKey(plan: Exclude<PlanId, 'free'>, interval: BillingInterval): string {
  return `gigacad_${plan}_${interval}`;
}

export function parsePriceLookupKey(key: string | null | undefined): { plan: Exclude<PlanId, 'free'>; interval: BillingInterval } | null {
  const match = /^gigacad_([a-z]+)_(monthly|yearly)$/.exec(key ?? '');
  if (!match || !isPlanId(match[1]) || match[1] === 'free') return null;
  return { plan: match[1], interval: match[2] as BillingInterval };
}

/** "5 GB", "2 TB", "1.4 GB", "830 MB": binary units, labeled the way people expect. */
export function formatBytes(bytes: number): string {
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  if (unit === 0) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  const rounded = value >= 100 || Number.isInteger(value) ? Math.round(value).toString() : value.toFixed(1).replace(/\.0$/, '');
  return `${rounded} ${units[unit]}`;
}
