// What an import job (import_jobs) says about itself: its progress while it
// runs, what each step did, and the email sent when it ends. Shared by the
// server that runs it (server/utils/importJobs.ts) and the screens that watch
// it (components/import/QuirocitasJob.vue). Every source runs through it:
// Quirocitas, PracticeHub and QuiroHiro (see import_jobs.source).

export type ImportJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

export interface ImportJobProgress {
  /** Read: 'list' -> 'patients' -> 'ledger' (Quirocitas) or 'read' (PracticeHub). Import steps: 'apply'. */
  phase?: 'list' | 'patients' | 'ledger' | 'read' | 'links' | 'apply'
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
  /**
   * Slices in a row that claimed the job and never saved it: cut off by the
   * platform (out of time or memory) before reaching their save, so no catch
   * ever counted them. Set when a slice starts, cleared when one saves.
   */
  unfinished?: number
  /**
   * The job is waiting because the database is short of memory or slow to
   * answer (server/utils/importPressure.ts): since when, why, and how many
   * times it has looked. Cleared by the first slice that finds it well again.
   */
  paused?: { since: string; reason: string; checks: number }
  // --- reading PracticeHub, page by page (server/utils/practicehubImportJob.ts)
  /** The read's own id: its pages only become the copy once it finishes. */
  pass?: string
  /** Which of PRACTICEHUB_LISTS the read is on, and the next page of it. */
  listIndex?: number
  listCount?: number
  page?: number
  pageCount?: number
  /** PracticeHub 2.0 lists are walked by cursor, not page number. */
  cursor?: string
  /** Pages saved per list so far in this pass. */
  pagesRead?: Record<string, number>
  /** Records PracticeHub says it holds, summed over the lists read so far. */
  records?: number
  /** QuiroHiro: the month the oldest contact was added, which the appointment walk starts a year before. */
  earliest?: string
  /**
   * A downloading step's fresh read of its link list (PRACTICEHUB_LINK_LISTS),
   * kept apart from the step's own counts. `readAt` is unset while it reads;
   * `lapsed` says a link was refused as expired, which sends the step to read
   * it anew (utils/practicehubImport/linkRefresh.ts).
   */
  links?: {
    pass?: string
    listIndex?: number
    page?: number
    pageCount?: number
    cursor?: string
    pagesRead?: Record<string, number>
    records?: number
    done?: number
    readAt?: string
    /** A link from this read was refused as expired: read the list again. */
    lapsed?: boolean
    /** Refreshes in a row since a file was last stored (practicehubImportJob caps them). */
    refreshes?: number
  }
}

export interface ImportJobStepResult {
  step: string
  written: number
  errors: string[]
  warnings: string[]
  /** A dry run (options.dryRun): nothing was written, and these say what would have been. */
  dryRun?: boolean
  stats?: { label: string; value: number | string }[]
  /** Units of work Apply would have done. */
  wouldWrite?: number
}

export type ImportSource = 'quirocitas' | 'practicehub' | 'quirohiro'

export function importSourceName(source: string | undefined): string {
  return source === 'practicehub' ? 'PracticeHub' : source === 'quirohiro' ? 'QuiroHiro' : 'Quirocitas'
}

type T = (en: string, es: string) => string

export function importJobStepLabel(step: string, t: T, source?: string): string {
  switch (step) {
    case 'read': return source === 'practicehub' ? t('Read PracticeHub', 'Leer PracticeHub') : source === 'quirohiro' ? t('Read QuiroHiro', 'Leer QuiroHiro') : t('Read Quirocitas', 'Leer Quirocitas')
    case 'patients': return t('Patients', 'Pacientes')
    case 'appointments': return t('Appointments', 'Citas')
    case 'appointment_types': return t('Appointment types', 'Tipos de cita')
    case 'treatment_notes': return t('Treatment notes', 'Notas de tratamiento')
    case 'care_plans': return t('Care plans', 'Planes de tratamiento')
    case 'patient_logs': return t('Patient logs', 'Registros de pacientes')
    case 'sticky_notes': return t('Sticky notes', 'Notas adhesivas')
    case 'custom_form_responses': return t('Form responses', 'Respuestas de formularios')
    case 'exercises': return t('Exercises', 'Ejercicios')
    case 'profile_photos': return t('Profile photos', 'Fotos de perfil')
    case 'file_attachments': return t('Files', 'Archivos')
    case 'clinical': return source === 'quirohiro' ? t('Clinical records and notes', 'Fichas y notas clínicas') : t('Clinical history and calls', 'Historial clínico y llamadas')
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
  else if (p.phase === 'read' && p.listCount) within = Math.min(0.99, ((p.listIndex ?? 0) + (p.pageCount ? ((p.page ?? 1) - 1) / p.pageCount : 0)) / p.listCount)
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
  source?: string
  clinicName: string
  status: 'done' | 'failed'
  steps: string[]
  results: ImportJobStepResult[]
  error: string | null
  url: string
}): { subject: string; html: string } {
  const { t } = input
  const from = importSourceName(input.source)
  const nf = new Intl.NumberFormat('es-ES')
  const problems = input.results.reduce((a, r) => a + r.errors.length, 0)
  const dryRun = input.results.some((r) => r.dryRun)
  const subject = input.status === 'failed'
    ? t(`The ${from} import stopped`, `La importación de ${from} se ha detenido`)
    : dryRun
      ? t(`The ${from} preview has finished`, `La vista previa de ${from} ha terminado`)
      : problems
        ? t(`The ${from} import has finished, with some problems`, `La importación de ${from} ha terminado, con algunos problemas`)
        : t(`The ${from} import has finished`, `La importación de ${from} ha terminado`)

  const lead = input.status === 'failed'
    ? t(
        `The import into ${input.clinicName || 'QuiroFlow'} stopped before the end. What was imported until then stays; starting it again carries on from there.`,
        `La importación a ${input.clinicName || 'QuiroFlow'} se ha detenido antes de terminar. Lo importado hasta entonces se queda; al volver a empezarla, sigue desde ahí.`,
      )
    : dryRun
      ? t(
          `Nothing was written to ${input.clinicName || 'QuiroFlow'}: this was a preview of what an import from ${from} would change.`,
          `No se ha escrito nada en ${input.clinicName || 'QuiroFlow'}: era una vista previa de lo que cambiaría una importación de ${from}.`,
        )
      : t(
          `Everything from ${from} is now in ${input.clinicName || 'QuiroFlow'}.`,
          `Ya está en ${input.clinicName || 'QuiroFlow'} todo lo de ${from}.`,
        )

  const rows = input.steps.map((step) => {
    const r = input.results.find((x) => x.step === step)
    const what = !r
      ? t('Not run', 'Sin hacer')
      : step === 'read'
        ? input.source === 'practicehub'
          ? t(`${nf.format(r.written)} records read`, `${nf.format(r.written)} registros leídos`)
          : t(`${nf.format(r.written)} patients read`, `${nf.format(r.written)} pacientes leídos`)
        : r.dryRun
          ? t(`${nf.format(r.wouldWrite ?? 0)} to write`, `${nf.format(r.wouldWrite ?? 0)} por escribir`)
          : t(`${nf.format(r.written)} saved`, `${nf.format(r.written)} guardados`)
    return `<tr><td style="padding:4px 16px 4px 0">${escapeHtml(importJobStepLabel(step, t, input.source))}</td><td style="padding:4px 0;color:${r ? '#111' : '#888'}">${escapeHtml(what)}</td></tr>`
  })

  const notes = input.results.flatMap((r) => [...r.errors, ...r.warnings].slice(0, 5).map((n) => `<li style="margin:0 0 6px">${escapeHtml(importJobStepLabel(r.step, t, input.source))}: ${escapeHtml(n)}</li>`))

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
