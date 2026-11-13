import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { DEFAULT_CLINIC_TIMEZONE } from '~/utils/clinicClock'
import { POSTURE_VIEWS, type Points, type PostureView, type StoredViews, type ViewMetrics } from '~/utils/posture'
import { COMPARE_GROUPS, compareBar, compareHeadline, comparePosture, compareSentence, ghostPoints, withCompareUnit, type CompareGroup, type CompareRow, type PostureComparison } from '~/utils/postureCompare'
import { viewTitle, type ReportLang } from '~/utils/postureReport'
import { remeasure } from '~/utils/postureTrend'
import { loadPostureLogo, loadPosturePhotos, type PosturePhoto } from './posturePdf'

// The comparison of two posture assessments of one patient, as a PDF: the
// clinic's header, what changed in a sentence, every measure then and now
// with whether it is closer to aligned (utils/postureCompare.ts -- the same
// rows the record shows), and each view both have with its two photos side
// by side, the earlier figure dashed over the later one.
//
// Nothing is stored about a comparison; the PDF is a short-lived object under
// the clinic's exports folder (storePostureComparison), not beside either
// assessment, so deleting one cannot leave its photo behind in a file kept
// with the other.
//
// pdfkit (and sharp, through loadPosturePhotos) load inside the functions:
// see CLAUDE.md, a top-level import in server/utils runs on every cold start.

export interface PostureCompareData {
  patientId: string
  patientName: string
  beforeAt: string
  afterAt: string
  timeZone: string
  lang: ReportLang
  comparison: PostureComparison
  /** The views both have, in the order they are taken, each with its two photos. */
  views: { view: PostureView; before: PosturePhoto; after: PosturePhoto }[]
  clinic: { name: string; address: string | null; phone: string | null; email: string | null } | null
  logo: Buffer | null
}

const BRAND = '#4F46E5'
const INK = '#1F2430'
const MUTED = '#6B7080'
const LINE = '#E3E5EC'
const TRACK = '#EEF0F3'
const BETTER = '#13795B'
const BETTER_BG = '#E9F6EF'
const WORSE = '#B45309'
const WORSE_BG = '#FFF4E0'
const SAME_BG = '#F3F4FB'

const COPY = {
  es: {
    title: (name: string) => `Comparativa postural de ${name}`,
    intro:
      'Este informe compara tu postura en dos valoraciones, con las fotos tomadas en consulta en el mismo sitio y de la misma forma. Cada medida es su distancia a la postura alineada: cuanto más pequeña, mejor. Un cambio de menos de medio grado o medio centímetro se da por igual, porque una foto no distingue menos que eso.',
    measure: 'Medida',
    change: 'Cambio',
    better: 'Mejora',
    worse: 'A vigilar',
    same: 'Igual',
    barLegend: 'En cada barra: punto hueco, antes; punto lleno, ahora; marca verde, lo alineado.',
    photoLegend: (before: string) => `Línea azul: la vertical desde el tobillo. En naranja, los puntos medidos. En blanco discontinuo sobre la segunda foto, la postura del ${before}, ajustada a la misma altura.`,
    disclaimer: 'Estimaciones a partir de fotografías, para documentar y explicar. No constituyen un diagnóstico.',
    page: (n: number, of: number) => `Página ${n} de ${of}`,
    file: 'comparativa-postural',
  },
  en: {
    title: (name: string) => `Posture comparison for ${name}`,
    intro:
      'This report compares your posture at two assessments, with the photos taken at the clinic in the same place and the same way. Each measurement is its distance from aligned posture: the smaller, the better. A change under half a degree or half a centimetre counts as the same, because a photo cannot tell less than that.',
    measure: 'Measurement',
    change: 'Change',
    better: 'Better',
    worse: 'To watch',
    same: 'Same',
    barLegend: 'On each bar: hollow dot, before; full dot, now; green mark, aligned.',
    photoLegend: (before: string) => `Blue line: the vertical from the ankle. In orange, the measured points. Dashed white on the second photo, the posture of ${before}, brought to the same height.`,
    disclaimer: 'Estimates from photographs, to document and explain. Not a diagnosis.',
    page: (n: number, of: number) => `Page ${n} of ${of}`,
    file: 'posture-comparison',
  },
} as const

/** The download's name: "comparativa-postural-2026-06-02-2026-09-08.pdf". */
export function postureCompareFileName(data: Pick<PostureCompareData, 'lang' | 'beforeAt' | 'afterAt'>): string {
  return `${COPY[data.lang].file}-${data.beforeAt.slice(0, 10)}-${data.afterAt.slice(0, 10)}.pdf`
}

/**
 * Both assessments, whichever way round they were named, as long as they are
 * the same patient's in this account. Null otherwise: the caller answers 404.
 */
export async function loadPostureCompareData(supabase: SupabaseClient<Database>, accountId: string, idA: string, idB: string): Promise<PostureCompareData | null> {
  if (idA === idB) return null
  const { data: rows } = await supabase
    .from('posture_assessments')
    .select('id, patient_id, taken_at, height_cm, views, metrics')
    .in('id', [idA, idB])
    .eq('account_id', accountId)
    .order('taken_at')
  const [b, a] = rows ?? []
  if (!a || !b || a.patient_id !== b.patient_id) return null

  const [{ data: patient }, { data: clinic }] = await Promise.all([
    supabase.from('patients').select('first_name, last_name, preferred_language').eq('id', a.patient_id).maybeSingle(),
    supabase.from('clinics').select('name, address, phone, email, timezone, logo_storage_path').eq('account_id', accountId).order('created_at').limit(1).maybeSingle(),
  ])
  if (!patient) return null
  const lang: ReportLang = patient.preferred_language === 'en' ? 'en' : 'es'

  const bViews = b.views as unknown as StoredViews
  const aViews = a.views as unknown as StoredViews
  const common = POSTURE_VIEWS.filter((v) => bViews[v] && aViews[v])
  const only = (views: StoredViews): StoredViews => Object.fromEntries(common.map((v) => [v, views[v]!]))
  const ghosts: Partial<Record<PostureView, Points | null>> = Object.fromEntries(common.map((v) => [v, ghostPoints(v, bViews[v]!, aViews[v]!)]))
  const [beforePhotos, afterPhotos, logo] = await Promise.all([
    loadPosturePhotos(supabase, only(bViews)),
    loadPosturePhotos(supabase, only(aViews), ghosts),
    loadPostureLogo(supabase, clinic?.logo_storage_path ?? null),
  ])

  const measure = (r: typeof a) => remeasure({ takenAt: r.taken_at, heightCm: Number(r.height_cm), views: r.views as unknown as StoredViews, metrics: (r.metrics ?? {}) as Partial<Record<PostureView, ViewMetrics>> })
  return {
    patientId: a.patient_id,
    patientName: [patient.first_name, patient.last_name].filter(Boolean).join(' '),
    beforeAt: b.taken_at,
    afterAt: a.taken_at,
    timeZone: clinic?.timezone || DEFAULT_CLINIC_TIMEZONE,
    lang,
    comparison: comparePosture(measure(b), measure(a), lang),
    views: common.flatMap((v) => {
      const before = beforePhotos.find((p) => p.view === v)
      const after = afterPhotos.find((p) => p.view === v)
      return before && after ? [{ view: v, before, after }] : []
    }),
    clinic: clinic ? { name: clinic.name, address: clinic.address, phone: clinic.phone, email: clinic.email } : null,
    logo,
  }
}

export async function generatePostureComparePdf(data: PostureCompareData): Promise<Buffer> {
  const { default: PDFDocument } = await import('pdfkit')
  const copy = COPY[data.lang]
  const locale = data.lang === 'es' ? 'es-ES' : 'en-GB'
  const day = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: data.timeZone })
  const shortDay = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: data.timeZone })
  const value = (n: number, unit: string) => withCompareUnit(n, unit, data.lang)

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: copy.title(data.patientName), Creator: 'QuiroFlow' } })
    const chunks: Buffer[] = []
    doc.on('data', (c) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const M = 40
    const PW = doc.page.width
    const PH = doc.page.height
    const W = PW - 2 * M
    const BOTTOM = PH - M - 24 // room for the footer
    let y = M
    const ensure = (h: number) => {
      if (y + h > BOTTOM) {
        doc.addPage()
        y = M
      }
    }

    // Header: the clinic on the left, its logo on the right.
    let logoOk = !!data.logo
    if (data.logo) {
      try {
        doc.image(data.logo, PW - M - 120, y, { fit: [120, 50], align: 'right' })
      } catch {
        logoOk = false // an unsupported image: the report stands without it
      }
    }
    const headW = logoOk ? W - 135 : W
    if (data.clinic) {
      doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text(data.clinic.name, M, y, { width: headW })
      doc.font('Helvetica').fontSize(9).fillColor(MUTED)
      if (data.clinic.address) doc.text(data.clinic.address, M, doc.y + 2, { width: headW })
      const contact = [data.clinic.phone, data.clinic.email].filter(Boolean).join('  ·  ')
      if (contact) doc.text(contact, M, doc.y + 1, { width: headW })
    }
    y = Math.max(doc.y, y + (logoOk ? 50 : 0)) + 16

    // Title bar. A hyphen between the dates: the standard fonts have no arrow.
    doc.rect(M, y, W, 32).fill(BRAND)
    const range = `${shortDay(data.beforeAt)} - ${shortDay(data.afterAt)}`
    doc.font('Helvetica').fontSize(10).fillColor('#fff')
    const rangeW = doc.widthOfString(range)
    doc.text(range, M + W - 12 - rangeW, y + 11, { lineBreak: false })
    doc.font('Helvetica-Bold').fontSize(13).text(copy.title(data.patientName), M + 12, y + 9, { width: W - rangeW - 40, lineBreak: false, ellipsis: true })
    y += 46

    doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(copy.intro, M, y, { width: W, lineGap: 2 })
    y = doc.y + 14

    // What changed, first: the count and the sentence.
    const c = data.comparison
    const tone = c.better ? { bg: BETTER_BG, fg: BETTER } : c.worse ? { bg: WORSE_BG, fg: WORSE } : { bg: SAME_BG, fg: INK }
    const sentence = c.rows.length ? compareSentence(c, data.lang) : ''
    doc.font('Helvetica').fontSize(9.5)
    const boxH = 38 + (sentence ? doc.heightOfString(sentence, { width: W - 28, lineGap: 2 }) + 6 : 0)
    doc.roundedRect(M, y, W, boxH, 5).fill(tone.bg)
    doc.font('Helvetica-Bold').fontSize(14).fillColor(tone.fg).text(compareHeadline(c, data.lang), M + 14, y + 12, { width: W - 28 })
    if (sentence) doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(sentence, M + 14, y + 34, { width: W - 28, lineGap: 2 })
    y += boxH + 16

    // The table: one row per measure, grouped as on the record.
    const VAL_W = 62
    const CHG_W = 112
    const BAR_W = 110
    const LABEL_W = W - 2 * VAL_W - CHG_W - BAR_W
    const xBar = M + LABEL_W
    const xBefore = xBar + BAR_W
    const xAfter = xBefore + VAL_W
    const xChange = xAfter + VAL_W
    const verdictText = (r: CompareRow) => (r.verdict === 'better' ? copy.better : r.verdict === 'worse' ? copy.worse : copy.same)
    const verdictColor = (r: CompareRow) => (r.verdict === 'better' ? BETTER : r.verdict === 'worse' ? WORSE : MUTED)
    const drawBar = (r: CompareRow, x: number, cy: number, w: number) => {
      const b = compareBar(r)
      const at = (f: number) => x + 6 + f * (w - 18)
      doc.moveTo(at(0), cy).lineTo(at(1), cy).lineWidth(2.5).lineCap('round').strokeColor(TRACK).stroke()
      if (Math.abs(b.after - b.before) > 0.005) doc.moveTo(at(b.before), cy).lineTo(at(b.after), cy).lineWidth(2.5).strokeColor(verdictColor(r)).stroke()
      doc.lineCap('butt').moveTo(at(b.ideal), cy - 5).lineTo(at(b.ideal), cy + 5).lineWidth(1.2).strokeColor(BETTER).stroke()
      doc.circle(at(b.before), cy, 3).lineWidth(1.4).fillAndStroke('#fff', MUTED)
      doc.circle(at(b.after), cy, 3.2).fill(r.verdict === 'same' ? INK : verdictColor(r))
    }
    if (c.rows.length) {
      ensure(40)
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text(copy.measure, M, y, { width: LABEL_W, lineBreak: false })
      doc.text(shortDay(data.beforeAt), xBefore, y, { width: VAL_W, align: 'right', lineBreak: false })
      doc.text(shortDay(data.afterAt), xAfter, y, { width: VAL_W, align: 'right', lineBreak: false })
      doc.text(copy.change, xChange, y, { width: CHG_W, align: 'right', lineBreak: false })
      y += 14
      for (const g of ['head', 'side', 'front'] as CompareGroup[]) {
        const rows = c.rows.filter((r) => r.group === g)
        if (!rows.length) continue
        ensure(18 + 20)
        doc.rect(M, y, W, 16).fill(SAME_BG)
        doc.font('Helvetica-Bold').fontSize(8).fillColor(BRAND).text(COMPARE_GROUPS[g][data.lang].toUpperCase(), M + 6, y + 4.5, { characterSpacing: 0.4, lineBreak: false })
        y += 16
        for (const r of rows) {
          ensure(20)
          doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(r.label, M, y + 5.5, { width: LABEL_W - 8, lineBreak: false, ellipsis: true })
          drawBar(r, xBar, y + 10, BAR_W)
          doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(value(r.before, r.unit), xBefore, y + 5.5, { width: VAL_W, align: 'right', lineBreak: false })
          doc.font('Helvetica-Bold').fillColor(INK).text(value(r.after, r.unit), xAfter, y + 5.5, { width: VAL_W, align: 'right', lineBreak: false })
          // A hyphen, not a minus sign: the PDF's standard fonts have no U+2212.
          const sign = r.delta > 0 ? '+' : r.delta < 0 ? '-' : ''
          const change = r.verdict === 'same' ? verdictText(r) : `${sign}${value(Math.abs(r.delta), r.unit)} · ${verdictText(r)}`
          doc.font('Helvetica-Bold').fontSize(9).fillColor(verdictColor(r)).text(change, xChange, y + 6, { width: CHG_W, align: 'right', lineBreak: false })
          y += 20
          doc.moveTo(M, y).lineTo(M + W, y).lineWidth(0.5).strokeColor(LINE).stroke()
        }
        y += 6
      }
      ensure(14)
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(copy.barLegend, M, y + 2, { width: W })
    }

    // Each view both have, a page each: before on the left, now on the right.
    for (const v of data.views) {
      doc.addPage()
      doc.font('Helvetica-Bold').fontSize(14).fillColor(BRAND).text(viewTitle(v.view, data.lang), M, M)
      const top = doc.y + 10
      const gap = 14
      const colW = (W - gap) / 2
      const boxH = BOTTOM - top - 58
      const open = (b: Buffer) => (doc as unknown as { openImage: (b: Buffer) => PDFKit.Mixins.ImageSrc }).openImage(b)
      const before = open(v.before.jpeg)
      const after = open(v.after.jpeg)
      let lowest = top
      ;[{ p: v.before, img: before, at: data.beforeAt }, { p: v.after, img: after, at: data.afterAt }].forEach((side, i) => {
        const scale = Math.min(colW / side.p.width, boxH / side.p.height)
        const w = side.p.width * scale
        const h = side.p.height * scale
        const x = M + i * (colW + gap) + (colW - w) / 2
        doc.image(side.img, x, top, { width: w, height: h })
        doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(day(side.at), M + i * (colW + gap), top + h + 8, { width: colW, align: 'center', lineBreak: false })
        lowest = Math.max(lowest, top + h + 24)
      })
      doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(copy.photoLegend(shortDay(data.beforeAt)), M, lowest + 4, { width: W, align: 'center' })
    }

    // Footer on every page, written last so it knows the page count.
    const pages = doc.bufferedPageRange()
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(pages.start + i)
      doc.page.margins.bottom = 0
      const fy = PH - M + 4
      doc.moveTo(M, fy - 6).lineTo(M + W, fy - 6).lineWidth(0.5).strokeColor(LINE).stroke()
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(copy.disclaimer, M, fy, { width: W - 90, lineBreak: false })
      doc.text(copy.page(i + 1, pages.count), M + W - 90, fy, { width: 90, align: 'right', lineBreak: false })
    }

    doc.end()
  })
}

const LINK_SECONDS = 60 * 5
const KEEP_HOURS = 24

/**
 * The PDF as a short-lived link, which is what the staff app's and the
 * patient app's WebView can open (utils/openWhenReady.ts). Kept under the
 * clinic's exports folder with the service role, as the GDPR export is, and
 * older files there are removed first: a copy of someone's photos should not
 * outlive the request it answered.
 */
export async function storePostureComparison(service: SupabaseClient<Database>, accountId: string, pdf: Buffer, fileName: string): Promise<string | null> {
  const folder = `${accountId}/exports`
  const { data: old } = await service.storage.from('patient-files').list(folder, { limit: 100 })
  const stale = (old ?? []).filter((f) => f.created_at && Date.now() - Date.parse(f.created_at) > KEEP_HOURS * 3_600_000).map((f) => `${folder}/${f.name}`)
  if (stale.length) await service.storage.from('patient-files').remove(stale)

  const path = `${folder}/${Date.now()}-${crypto.randomUUID()}-${fileName}`
  const { error } = await service.storage.from('patient-files').upload(path, pdf, { contentType: 'application/pdf' })
  if (error) return null
  const { data: signed } = await service.storage.from('patient-files').createSignedUrl(path, LINK_SECONDS)
  return signed?.signedUrl ?? null
}
