import type { InjectionKey } from 'vue'

// Who is looking at a report page, for the parts of it that ask: the shared
// loader (composables/useReportData.ts) needs the account for the Growth
// figures, and each block (components/reports/Block.vue) checks the role and
// the plan before it shows a figure.
//
// On the web both read the Pinia account store, and still do: nothing
// provides this there, so they fall back to useAccountStore() exactly as
// before. The app has no Pinia (mobile/composables/usePractitionerContext.ts
// says why), so its report page provides one of these, built from the
// practitioner context, and the store is never touched.
//
// Read lazily, so implement the fields as getters over something reactive:
// a block's "can I show this?" has to change when the context arrives.
export interface ReportViewer {
  readonly accountId: string | null
  readonly isOwner: boolean
  /** The role's permissions, as get_my_bootstrap returns them. */
  readonly permissions: Record<string, unknown>
  /** The account has Growth: the store's hasGrowthAddon rule. */
  readonly hasGrowthAddon: boolean
}

export const REPORT_VIEWER_KEY: InjectionKey<ReportViewer> = Symbol('report-viewer')
