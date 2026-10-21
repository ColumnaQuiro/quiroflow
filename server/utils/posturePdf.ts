import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { DEFAULT_CLINIC_TIMEZONE } from '~/utils/clinicClock'
import { measureAll, POSTURE_VIEWS, VIEW_POINTS, type Points, type PostureView, type Pt, type StoredViews, type ViewMetrics } from '~/utils/posture'
import { postureConclusion, postureEvolution, postureReportCopy, postureReportSections, viewTitle, type ReportLang } from '~/utils/postureReport'

// The posture report for one assessment, as a PDF for the patient: the
// clinic's header, what each photo shows in words (utils/postureReport.ts),
// the photos with their points drawn on them, and then each photo again on a
// page of its own, large enough to see. Drawn here rather than in the browser
// because the staff app cannot bundle a PDF library (Xcode Cloud installs
// mobile/ only) and opens documents in the system viewer from a URL.
//
// sharp and pdfkit are loaded inside the functions, not at the top: see
// CLAUDE.md, a top-level import in server/utils runs on every cold start.

interface Photo { view: PostureView; jpeg: Buffer; width: number; height: number }

export interface PostureReportData {
  assessmentId: string
  patientId: string
  patientName: string
  takenAt: string
  timeZone: string
  lang: ReportLang
  metrics: Partial<Record<PostureView, ViewMetrics>>
  photos: Photo[]
  earlier: { takenAt: string; metrics: Partial<Record<PostureView, ViewMetrics>> } | null
  clinic: { name: string; address: string | null; phone: string | null; email: string | null } | null
  logo: Buffer | null
}

const BRAND = '#4F46E5'
const INK = '#1F2430'
const MUTED = '#6B7080'
const LINE = '#E3E5EC'
const TINT = '#F3F4FB'
const WARN_BG = '#FFF4E0'
const WARN_TEXT = '#9A5B00'
const BETTER = '#13795B'
const WORSE = '#B45309'

const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]

/** The same drawing as components/posture/Overlay.vue, as an SVG to lay over the photo, plus a grid. */
export function postureOverlaySvg(view: PostureView, p: Points, width: number, height: number): string {
  const paired = view === 'front' || view === 'back'
  const stroke = Math.max(2, Math.round(width / 300))
  const r = Math.max(6, Math.round(width / 90))
  const plumbX = paired ? mid(p.ankleR!, p.ankleL!)[0] : p.ankle![0]
  const joints = ['ear', 'shoulder', 'hip', 'knee', 'ankle']
  const chain = joints.map((k) => (paired ? mid(p[`${k}R`]!, p[`${k}L`]!) : p[k]!).join(',')).join(' ')
  const step = height / 24
  const grid: string[] = []
  for (let y = step; y < height; y += step) grid.push(`<line x1="0" y1="${y.toFixed(1)}" x2="${width}" y2="${y.toFixed(1)}"/>`)
  for (let x = plumbX % step; x < width; x += step) grid.push(`<line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${height}"/>`)
  const pairs = paired ? joints.map((k) => `<line x1="${p[`${k}R`]![0]}" y1="${p[`${k}R`]![1]}" x2="${p[`${k}L`]![0]}" y2="${p[`${k}L`]![1]}"/>`) : []
  const dots = VIEW_POINTS[view].map((n) => `<circle cx="${p[n]![0]}" cy="${p[n]![1]}" r="${r}"/>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<g stroke="#fff" stroke-opacity=".22" stroke-width="${Math.max(1, stroke / 2)}">${grid.join('')}</g>
<line x1="${plumbX}" y1="0" x2="${plumbX}" y2="${height}" stroke="#7CC4FF" stroke-width="${stroke}" stroke-dasharray="${stroke * 5} ${stroke * 4}"/>
<g stroke="#FFB020" stroke-width="${stroke}">${pairs.join('')}</g>
<polyline points="${chain}" fill="none" stroke="#FFB020" stroke-width="${stroke}" stroke-linejoin="round"/>
<g fill="#FFB020" stroke="#fff" stroke-width="${stroke}">${dots.join('')}</g>
</svg>`
}

type Doc = InstanceType<typeof import('pdfkit')>

/**
 * A plain figure standing as straight as a photo could show, beside each
 * photo, so the patient has something to compare theirs with: every point on
 * the vertical from the side, and level from side to side from the front.
 */
function drawReferenceFigure(doc: Doc, view: PostureView, x: number, y: number, w: number, h: number) {
  const cx = x + w / 2
  const at = (f: number) => y + f * h
  const side = view === 'right' || view === 'left'
  const body = '#D9DBE3'
  // The silhouette.
  doc.circle(cx, at(0.075), w * 0.14).fill(body)
  if (side) {
    doc.roundedRect(cx - w * 0.05, at(0.11), w * 0.1, h * 0.08, 2).fill(body)
    doc.roundedRect(cx - w * 0.17, at(0.17), w * 0.34, h * 0.37, 6).fill(body)
    doc.roundedRect(cx - w * 0.11, at(0.5), w * 0.22, h * 0.47, 4).fill(body)
    doc.lineWidth(w * 0.1).lineCap('round').strokeColor('#C9CCD6').moveTo(cx, at(0.21)).lineTo(cx + (view === 'right' ? 1 : -1) * w * 0.04, at(0.49)).stroke().lineCap('butt')
  } else {
    doc.polygon([cx - w * 0.3, at(0.18)], [cx + w * 0.3, at(0.18)], [cx + w * 0.19, at(0.52)], [cx - w * 0.19, at(0.52)]).fill(body)
    doc.roundedRect(cx - w * 0.19, at(0.5), w * 0.16, h * 0.47, 3).fill(body)
    doc.roundedRect(cx + w * 0.03, at(0.5), w * 0.16, h * 0.47, 3).fill(body)
    doc.lineWidth(w * 0.07).strokeColor(body).moveTo(cx - w * 0.33, at(0.2)).lineTo(cx - w * 0.38, at(0.5)).stroke()
    doc.moveTo(cx + w * 0.33, at(0.2)).lineTo(cx + w * 0.38, at(0.5)).stroke()
  }
  // The vertical, and the points on it.
  doc.lineWidth(1).strokeColor('#7CC4FF').dash(3, { space: 2.5 }).moveTo(cx, y - 4).lineTo(cx, y + h + 2).stroke().undash()
  const levels = [0.08, 0.2, 0.5, 0.73, 0.95]
  const half = [0.07, 0.3, 0.17, 0.11, 0.11]
  doc.lineWidth(1.2).strokeColor('#FFB020')
  if (side) {
    doc.moveTo(cx, at(levels[0]!)).lineTo(cx, at(levels[4]!)).stroke()
    for (const f of levels) doc.circle(cx, at(f), 2.6).fillAndStroke('#FFB020', '#fff')
  } else {
    levels.forEach((f, i) => {
      const dx = w * half[i]!
      doc.strokeColor('#FFB020').moveTo(cx - dx, at(f)).lineTo(cx + dx, at(f)).stroke()
      doc.circle(cx - dx, at(f), 2.6).fillAndStroke('#FFB020', '#fff')
      doc.circle(cx + dx, at(f), 2.6).fillAndStroke('#FFB020', '#fff')
    })
  }
}

export async function loadPostureReportData(supabase: SupabaseClient<Database>, accountId: string, assessmentId: string): Promise<PostureReportData | null> {
  const { data: a } = await supabase
    .from('posture_assessments')
    .select('id, patient_id, taken_at, height_cm, views, metrics')
    .eq('id', assessmentId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!a) return null
  const views = a.views as unknown as StoredViews

  const [{ data: patient }, { data: clinic }, { data: earlier }] = await Promise.all([
    supabase.from('patients').select('first_name, last_name, preferred_language').eq('id', a.patient_id).maybeSingle(),
    // The patient may have been seen at several of the clinic's sites; the
    // header is the account's first, as the statement's is.
    supabase.from('clinics').select('name, address, phone, email, timezone, logo_storage_path').eq('account_id', accountId).order('created_at').limit(1).maybeSingle(),
    // Compared with the first assessment, as the Progress tab does by default.
    supabase.from('posture_assessments').select('taken_at, metrics').eq('patient_id', a.patient_id).lt('taken_at', a.taken_at).order('taken_at').limit(1).maybeSingle(),
  ])
  if (!patient) return null

  const { default: sharp } = await import('sharp')
  const photos = (
    await Promise.all(
      POSTURE_VIEWS.filter((v) => views[v]).map(async (v): Promise<Photo | null> => {
        const s = views[v]!
        const { data: blob } = await supabase.storage.from('patient-files').download(s.photo)
        if (!blob) return null
        const jpeg = await sharp(Buffer.from(await blob.arrayBuffer()))
          .resize(s.width, s.height, { fit: 'fill' })
          .composite([{ input: Buffer.from(postureOverlaySvg(v, s.points, s.width, s.height)), top: 0, left: 0 }])
          .jpeg({ quality: 82 })
          .toBuffer()
        return { view: v, jpeg, width: s.width, height: s.height }
      }),
    )
  ).filter((p): p is Photo => !!p)

  let logo: Buffer | null = null
  if (clinic?.logo_storage_path) {
    try {
      const { data: publicUrl } = supabase.storage.from('clinic-logos').getPublicUrl(clinic.logo_storage_path)
      const res = await fetch(publicUrl.publicUrl)
      if (res.ok) logo = Buffer.from(await res.arrayBuffer())
    } catch {
      logo = null // a logo that will not load is not a reason to have no report
    }
  }

  return {
    assessmentId: a.id,
    patientId: a.patient_id,
    patientName: [patient.first_name, patient.last_name].filter(Boolean).join(' '),
    takenAt: a.taken_at,
    timeZone: clinic?.timezone || DEFAULT_CLINIC_TIMEZONE,
    lang: patient.preferred_language === 'en' ? 'en' : 'es',
    // Measured again from the stored points, so an assessment saved before a
    // measurement existed (the knees, 21 Oct 2026) has it in its report too.
    // The same functions as at save time: the numbers otherwise agree.
    metrics: Number(a.height_cm) > 0 ? measureAll(views, Number(a.height_cm)) : ((a.metrics ?? {}) as Partial<Record<PostureView, ViewMetrics>>),
    photos,
    earlier: earlier ? { takenAt: earlier.taken_at, metrics: (earlier.metrics ?? {}) as Partial<Record<PostureView, ViewMetrics>> } : null,
    clinic: clinic ? { name: clinic.name, address: clinic.address, phone: clinic.phone, email: clinic.email } : null,
    logo,
  }
}

export async function generatePostureReportPdf(data: PostureReportData): Promise<Buffer> {
  const { default: PDFDocument } = await import('pdfkit')
  const copy = postureReportCopy(data.lang)
  const day = (iso: string) => new Date(iso).toLocaleDateString(data.lang === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: data.timeZone })

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
    // Opened once each: every photo is drawn twice, and embedding it twice would double the file.
    const images = new Map(data.photos.map((p) => [p.view, { ...p, img: (doc as unknown as { openImage: (b: Buffer) => PDFKit.Mixins.ImageSrc }).openImage(p.jpeg) }]))
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

    // Title bar.
    doc.rect(M, y, W, 32).fill(BRAND)
    const date = day(data.takenAt)
    doc.font('Helvetica').fontSize(10).fillColor('#fff')
    const dateW = doc.widthOfString(date)
    doc.text(date, M + W - 12 - dateW, y + 11, { lineBreak: false })
    doc.font('Helvetica-Bold').fontSize(13).text(copy.title(data.patientName), M + 12, y + 9, { width: W - dateW - 40, lineBreak: false, ellipsis: true })
    y += 46

    doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(copy.intro, M, y, { width: W, lineGap: 2 })
    y = doc.y + 16

    // One section per view: the photo on the left, what it shows on the right.
    const PHOTO_H = 210
    const PHOTO_W = 135
    const REF_W = 58
    for (const s of postureReportSections(data.metrics, data.lang)) {
      ensure(PHOTO_H + 30)
      doc.font('Helvetica-Bold').fontSize(12).fillColor(BRAND).text(s.title, M, y)
      y += 20
      const top = y
      const photo = images.get(s.view)
      drawReferenceFigure(doc, s.view, M, top + 6, REF_W, PHOTO_H - 30)
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(copy.reference, M - 6, top + PHOTO_H - 14, { width: REF_W + 12, align: 'center' })
      if (photo) doc.image(photo.img, M + REF_W + 10, top, { fit: [PHOTO_W, PHOTO_H], align: 'center' })
      const x = M + REF_W + 10 + PHOTO_W + 18
      const tw = W - (x - M)
      let ty = top
      for (const f of s.findings) {
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(`${f.label}: `, x, ty, { width: tw, continued: true })
        doc.font('Helvetica').fillColor(INK).text(f.text)
        ty = doc.y + 5
      }
      ty += 4
      for (const row of s.totals) {
        doc.rect(x, ty, tw, 20).fill(TINT)
        doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(row.label, x + 8, ty + 6, { width: tw - 90, lineBreak: false })
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(row.value, x + tw - 88, ty + 5.5, { width: 80, align: 'right', lineBreak: false })
        ty += 22
      }
      if (s.headWeight) {
        ty += 6
        doc.font('Helvetica').fontSize(8.5)
        const noteH = doc.heightOfString(s.headWeight.note, { width: tw - 16 })
        const boxH = 48 + noteH
        doc.rect(x, ty, tw, boxH).fill(WARN_BG)
        doc.font('Helvetica-Bold').fontSize(8).fillColor(WARN_TEXT).text(s.headWeight.label.toUpperCase(), x + 8, ty + 8, { width: tw - 16, characterSpacing: 0.4 })
        doc.font('Helvetica-Bold').fontSize(20).fillColor(INK).text(s.headWeight.value, x + 8, ty + 20, { width: tw - 16 })
        doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(s.headWeight.note, x + 8, ty + 42, { width: tw - 16 })
        ty += boxH
      }
      y = Math.max(top + PHOTO_H, ty) + 20
    }

    // Then and now, when there is an earlier assessment to compare with.
    const evolution = data.earlier ? postureEvolution(data.earlier.metrics, data.metrics, data.lang) : []
    if (data.earlier && evolution.length) {
      ensure(40 + evolution.length * 20)
      doc.font('Helvetica-Bold').fontSize(12).fillColor(BRAND).text(copy.evolution(day(data.earlier.takenAt)), M, y)
      y += 20
      const c1 = W - 170
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED)
      doc.text(copy.then, M + c1, y, { width: 80, align: 'right' })
      doc.text(copy.now, M + c1 + 85, y, { width: 80, align: 'right' })
      y += 14
      for (const e of evolution) {
        doc.moveTo(M, y).lineTo(M + W, y).lineWidth(0.5).strokeColor(LINE).stroke()
        doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(e.label, M, y + 5, { width: c1 - 10, lineBreak: false })
        doc.fillColor(MUTED).text(e.then, M + c1, y + 5, { width: 80, align: 'right', lineBreak: false })
        doc.font('Helvetica-Bold').fillColor(e.better === null ? INK : e.better ? BETTER : WORSE).text(e.now, M + c1 + 85, y + 5, { width: 80, align: 'right', lineBreak: false })
        y += 20
      }
      y += 16
    }

    const conclusion = postureConclusion(data.metrics, data.lang)
    doc.font('Helvetica').fontSize(9.5)
    ensure(30 + doc.heightOfString(conclusion, { width: W, lineGap: 2 }))
    doc.font('Helvetica-Bold').fontSize(12).fillColor(BRAND).text(copy.conclusion, M, y)
    doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(conclusion, M, doc.y + 6, { width: W, lineGap: 2 })

    // Each photo again, a page each, large enough to see the points.
    for (const v of POSTURE_VIEWS) {
      const photo = images.get(v)
      if (!photo) continue
      doc.addPage()
      doc.font('Helvetica-Bold').fontSize(14).fillColor(BRAND).text(viewTitle(v, data.lang), M, M)
      const top = doc.y + 10
      const boxH = BOTTOM - top - 26
      const scale = Math.min(W / photo.width, boxH / photo.height)
      const w = photo.width * scale
      const h = photo.height * scale
      doc.image(photo.img, M + (W - w) / 2, top, { width: w, height: h })
      doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(copy.legend, M, top + h + 8, { width: W, align: 'center' })
    }

    // Footer on every page, written last so it knows the page count.
    const range = doc.bufferedPageRange()
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i)
      doc.page.margins.bottom = 0
      const fy = PH - M + 4
      doc.moveTo(M, fy - 6).lineTo(M + W, fy - 6).lineWidth(0.5).strokeColor(LINE).stroke()
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(copy.disclaimer, M, fy, { width: W - 90, lineBreak: false })
      doc.text(copy.page(i + 1, range.count), M + W - 90, fy, { width: 90, align: 'right', lineBreak: false })
    }

    doc.end()
  })
}
