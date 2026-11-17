// What an import job (import_jobs) says about itself: its progress while it
// runs, what each step did, and the email sent when it ends. Shared by the
// server that runs it (server/utils/importJobs.ts) and the screens that watch
// it (components/import/QuirocitasJob.vue).

export type ImportJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

export interface ImportJobProgress {
  /** Read: 'list' -> 'patients' -> 'ledger'. Import steps: 'apply'. */
  phase?: 'list' | 'patients' | 'ledger' | 'apply'
  done?: number
  total?: number
  /** Patients Quirocitas would not send, in this read. */
  failed?: number
  /** The cash-ledger month the read has walked back to. */
  month?: string
  passStartedAt?: string
  ledgerStarted?: boolean
  /** Rows an import step has written so far, over every slice. */
  written?: number
  errors?: string[]
  warnings?: string[]
  stalls?: number
  failures?: number
  lastError?: string
}

export interface ImportJobStepResult {
  step: string
  written: number
  errors: string[]
  warnings: string[]
}

type T = (en: string, es: string) => string

export function importJobStepLabel(step: string, t: T): string {
  switch (step) {
    case 'read': return t('Read Quirocitas', 'Leer Quirocitas')
    case 'patients': return t('Patients', 'Pacientes')
    case 'appointments': return t('Appointments', 'Citas')
    case 'clinical': return t('Clinical history and calls', 'Historial clínico y llamadas')
    case 'files': return t('Files and photos', 'Archivos y fotos')
    case 'bonos': return 'Bonos'
    case 'ledger': return t('Payments and invoices', 'Pagos y facturas')
    default: return step
  }
}

/** Percent of the whole job done, for one bar across every step. */
export function importJobPercent(job: { status: string; steps: string[]; step_index: number; progress: unknown }): number {
  if (job.status === 'done') return 100
  const steps = job.steps.length || 1
  const p = (job.progress ?? {}) as ImportJobProgress
  let within = 0
  if (p.phase === 'patients' && p.total) within = (p.done ?? 0) / p.total * 0.9
  else if (p.phase === 'ledger') within = 0.95
  else if (p.phase === 'apply' && p.total) within = Math.min(1, (p.done ?? 0) / p.total)
  return Math.max(1, Math.min(99, Math.round(((job.step_index + within) / steps) * 100)))
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** The email the person who started a job gets when it ends. */
export function importJobEmail(input: {
  t: T
  lang: string
  clinicName: string
  status: 'done' | 'failed'
  steps: string[]
  results: ImportJobStepResult[]
  error: string | null
  url: string
}): { subject: string; html: string } {
  const { t } = input
  const nf = new Intl.NumberFormat('es-ES')
  const problems = input.results.reduce((a, r) => a + r.errors.length, 0)
  const subject = input.status === 'failed'
    ? t('The Quirocitas import stopped', 'La importación de Quirocitas se ha detenido')
    : problems
      ? t('The Quirocitas import has finished, with some problems', 'La importación de Quirocitas ha terminado, con algunos problemas')
      : t('The Quirocitas import has finished', 'La importación de Quirocitas ha terminado')

  const lead = input.status === 'failed'
    ? t(
        `The import into ${input.clinicName || 'QuiroFlow'} stopped before the end. What was imported until then stays; starting it again carries on from there.`,
        `La importación a ${input.clinicName || 'QuiroFlow'} se ha detenido antes de terminar. Lo importado hasta entonces se queda; al volver a empezarla, sigue desde ahí.`,
      )
    : t(
        `Everything from Quirocitas is now in ${input.clinicName || 'QuiroFlow'}.`,
        `Ya está en ${input.clinicName || 'QuiroFlow'} todo lo de Quirocitas.`,
      )

  const rows = input.steps.map((step) => {
    const r = input.results.find((x) => x.step === step)
    const what = !r
      ? t('Not run', 'Sin hacer')
      : step === 'read'
        ? t(`${nf.format(r.written)} patients read`, `${nf.format(r.written)} pacientes leídos`)
        : t(`${nf.format(r.written)} saved`, `${nf.format(r.written)} guardados`)
    return `<tr><td style="padding:4px 16px 4px 0">${escapeHtml(importJobStepLabel(step, t))}</td><td style="padding:4px 0;color:${r ? '#111' : '#888'}">${escapeHtml(what)}</td></tr>`
  })

  const notes = input.results.flatMap((r) => [...r.errors, ...r.warnings].slice(0, 5).map((n) => `<li style="margin:0 0 6px">${escapeHtml(importJobStepLabel(r.step, t))}: ${escapeHtml(n)}</li>`))

  const html = [
    '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#111">',
    `<p>${escapeHtml(lead)}</p>`,
    input.status === 'failed' && input.error ? `<p style="color:#b42318">${escapeHtml(input.error)}</p>` : '',
    `<table style="border-collapse:collapse;font-size:14px">${rows.join('')}</table>`,
    notes.length ? `<p style="margin-top:16px">${escapeHtml(t('Worth a look:', 'Para revisar:'))}</p><ul style="padding-left:18px;color:#444;font-size:13px">${notes.join('')}</ul>` : '',
    `<p style="margin-top:16px"><a href="${escapeHtml(input.url)}">${escapeHtml(t('Open the import in QuiroFlow', 'Ver la importación en QuiroFlow'))}</a></p>`,
    '</div>',
  ].join('')
  return { subject, html }
}
