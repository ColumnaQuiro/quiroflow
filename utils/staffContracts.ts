// How someone works for the clinic (staff_contracts), for Personal and a
// person's file. One row per contract; the history is never overwritten.

export const EMPLOYMENT_TYPES = ['employee', 'self_employed', 'partner'] as const
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number]

export const CONTRACT_MODALITIES = ['indefinido', 'temporal', 'fijo_discontinuo', 'practicas'] as const
export type ContractModality = (typeof CONTRACT_MODALITIES)[number]

export interface StaffContract {
  id: string
  team_member_id: string
  employment_type: EmploymentType | string
  modality: ContractModality | string | null
  starts_on: string | null
  ends_on: string | null
  weekly_hours: number | null
  job_title: string | null
  convenio: string | null
  created_at: string
}

type T = (en: string, es: string) => string

export function employmentTypeLabel(type: string, t: T): string {
  if (type === 'employee') return t('Employee', 'Empleado')
  if (type === 'self_employed') return t('Self-employed', 'Autónomo')
  if (type === 'partner') return t('Partner', 'Socio')
  return type
}

export function modalityLabel(modality: string, t: T): string {
  if (modality === 'indefinido') return t('Permanent', 'Indefinido')
  if (modality === 'temporal') return t('Fixed-term', 'Temporal')
  if (modality === 'fijo_discontinuo') return t('Seasonal permanent', 'Fijo discontinuo')
  if (modality === 'practicas') return t('Internship', 'Prácticas')
  return modality
}

/** Newest first: by start date (an undated contract counts as the oldest), then by when it was entered. */
export function sortContracts<C extends Pick<StaffContract, 'starts_on' | 'created_at'>>(contracts: C[]): C[] {
  return [...contracts].sort((a, b) => (b.starts_on ?? '').localeCompare(a.starts_on ?? '') || b.created_at.localeCompare(a.created_at))
}

/**
 * The contract in force on `today`: the newest that has started (or has no
 * start date). One signed for later is not current yet; when that is all
 * there is, it is returned so the person still shows what they will be.
 */
export function currentContract<C extends Pick<StaffContract, 'starts_on' | 'created_at'>>(contracts: C[], today: string): C | null {
  const sorted = sortContracts(contracts)
  return sorted.find((c) => !c.starts_on || c.starts_on <= today) ?? sorted[sorted.length - 1] ?? null
}

/** Days from `today` to the contract's last day, when it has one and it is still ahead (0 = ends today). */
export function daysUntilEnd(contract: Pick<StaffContract, 'ends_on'> | null, today: string): number | null {
  if (!contract?.ends_on || contract.ends_on < today) return null
  return Math.round((Date.parse(`${contract.ends_on}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000)
}

/** Ended already: the person's last contract is behind them. */
export const contractEnded = (contract: Pick<StaffContract, 'ends_on'> | null, today: string) => !!contract?.ends_on && contract.ends_on < today

/** Within this many days of its end, a contract is flagged on the overview. */
export const CONTRACT_ENDING_SOON_DAYS = 30

/**
 * Minutes a week of planned shift above the contracted hours, or 0. `weekly`
 * is the planned week in minutes (shiftMinutes summed over its days).
 */
export function hoursOverContract(plannedMinutes: number, weeklyHours: number | null | undefined): number {
  if (!weeklyHours) return 0
  return Math.max(0, plannedMinutes - Math.round(weeklyHours * 60))
}
