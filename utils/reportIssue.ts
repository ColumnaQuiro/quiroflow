// Something worth knowing about that is not an exception: reported from code
// shared by the web and the staff app (components/posture/Capture.vue, say),
// which cannot import either Sentry SDK -- the web's is @sentry/nuxt, the
// app's @sentry/capacitor, and the app's cloud build only installs mobile/
// (CLAUDE.md, "Mobile builds only see mobile/node_modules").
//
// So each app provides one as $reportIssue from the plugin that owns its
// Sentry (plugins/report-issue.client.ts, mobile/plugins/00.sentry.client.ts)
// and shared code calls it through useNuxtApp(). Tags only: never a name, a
// record id or anything from the photo.
export type IssueLevel = 'info' | 'warning' | 'error'
export interface IssueContext { tags: Record<string, string>; level?: IssueLevel; fingerprint?: string[] }
export type ReportIssue = (message: string, context: IssueContext) => void
