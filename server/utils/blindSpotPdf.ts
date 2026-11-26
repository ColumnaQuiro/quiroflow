import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { DEFAULT_CLINIC_TIMEZONE } from '~/utils/clinicClock'
import {
  BLIND_SPOT_CENTRE,
  BLIND_SPOT_REFERENCE,
  blindSpotAsymmetry,
  blindSpotContour,
  formatBlindSpotArea,
  type BlindSpotEye,
  type BlindSpotPoint,
  type BlindSpotTestRow,
} from '~/utils/blindSpot'
import { loadPostureLogo } from '~/server/utils/posturePdf'

// The Blind Spot report for the patient, two A4 pages:
//   1. the result -- both eyes' maps before and after the adjustment, the
//      difference between eyes, how it has moved since the first test;
//   2. what it means for the nervous system, as functional neurology
//      (Carrick Institute) reads it.
//
// Page 2 says throughout that it is that model's reading ("según este
// modelo", "se interpreta"), and the foot of each page that this is not a
// diagnosis. Keep it so: the anatomy (each eye's blind spot is processed by
// the opposite hemisphere) is established; reading its size as how active a
// hemisphere is, is functional neurology's, and the report must not present
// it as more. Drawn on the server for the reason the posture report is: the
// staff app opens documents from a URL. pdfkit is loaded inside the function
// (CLAUDE.md: a top-level import in server/utils runs on every cold start).
// The standard PDF fonts have no arrow, so "before - after" uses a hyphen.

type Lang = 'es' | 'en'

export interface BlindSpotSessionTests {
  before: BlindSpotTestRow | null
  after: BlindSpotTestRow
}

export interface BlindSpotReportData {
  sessionId: string
  patientId: string
  patientName: string
  testedAt: string
  timeZone: string
  lang: Lang
  session: BlindSpotSessionTests
  /** Every session up to this one, oldest first: the first is "since your first test". */
  history: Array<{ testedAt: string; asymmetry: number | null }>
  clinic: { name: string; address: string | null; phone: string | null } | null
  practitionerName: string | null
  logo: Buffer | null
}

const BRAND = '#4F46E5'
const BRAND_TINT = '#EEF0FE'
const INK = '#15171E'
const INK_SOFT = '#3A3F52'
const MUTED = '#686D7D'
const LINE = '#E8E9ED'
const GRID = '#F0F1F4'
const REF = '#B6BAC6'
const BEFORE = '#B45309'
const SURFACE = '#FAFAFB'

const SELECT = 'id, patient_id, session_id, phase, right_eye, left_eye, right_area, left_area, points_per_eye, distance_cm, px_per_mm, note, tested_at, created_by'

export async function loadBlindSpotReportData(supabase: SupabaseClient<Database>, accountId: string, sessionId: string): Promise<BlindSpotReportData | null> {
  const { data: rows } = await supabase.from('blind_spot_tests').select(SELECT).eq('account_id', accountId).eq('session_id', sessionId)
  const list = (rows ?? []) as unknown as BlindSpotTestRow[]
  if (!list.length) return null
  const pre = list.find((r) => r.phase === 'pre') ?? null
  const post = list.find((r) => r.phase === 'post') ?? null
  const single = list.find((r) => r.phase === 'single') ?? null
  const after = post ?? single ?? pre!
  const session: BlindSpotSessionTests = { before: post ? pre : null, after }

  const [{ data: patient }, { data: clinic }, { data: earlier }, { data: practitioner }] = await Promise.all([
    supabase.from('patients').select('first_name, last_name, preferred_language').eq('id', after.patient_id).maybeSingle(),
    supabase.from('clinics').select('name, address, phone, timezone, logo_storage_path').eq('account_id', accountId).order('created_at').limit(1).maybeSingle(),
    // Up to this session, not after it: a report printed again later says what it said then.
    supabase.from('blind_spot_tests').select('session_id, phase, right_area, left_area, tested_at').eq('patient_id', after.patient_id).lte('tested_at', after.tested_at).order('tested_at'),
    after.created_by ? supabase.from('team_members').select('full_name').eq('id', after.created_by).maybeSingle() : Promise.resolve({ data: null }),
  ])
  if (!patient) return null

  // One entry per session: the "before" of a pair if it has one (where the
  // patient walked in), else the lone test.
  const bySession = new Map<string, Array<{ phase: string; right_area: number | null; left_area: number | null; tested_at: string }>>()
  for (const r of earlier ?? []) bySession.set(r.session_id, [...(bySession.get(r.session_id) ?? []), r])
  const history = [...bySession.values()]
    .map((tests) => {
      const first = tests.find((x) => x.phase === 'pre') ?? tests.find((x) => x.phase === 'single') ?? tests[0]!
      return { testedAt: first.tested_at, asymmetry: blindSpotAsymmetry(first.right_area, first.left_area)?.percent ?? null }
    })
    .sort((a, b) => a.testedAt.localeCompare(b.testedAt))

  return {
    sessionId,
    patientId: after.patient_id,
    patientName: [patient.first_name, patient.last_name].filter(Boolean).join(' '),
    testedAt: after.tested_at,
    timeZone: clinic?.timezone || DEFAULT_CLINIC_TIMEZONE,
    lang: patient.preferred_language === 'en' ? 'en' : 'es',
    session,
    history,
    clinic: clinic ? { name: clinic.name, address: clinic.address, phone: clinic.phone } : null,
    practitionerName: (practitioner as { full_name?: string } | null)?.full_name ?? null,
    logo: await loadPostureLogo(supabase, clinic?.logo_storage_path ?? null),
  }
}

/** The "in your case" paragraph, from the numbers. Exported for its test. */
export function blindSpotCaseText(data: Pick<BlindSpotReportData, 'session' | 'history' | 'lang' | 'timeZone'>): string {
  const es = data.lang === 'es'
  const { before, after } = data.session
  const now = blindSpotAsymmetry(after.right_area, after.left_area)
  const then = before ? blindSpotAsymmetry(before.right_area, before.left_area) : null
  const eye = (e: BlindSpotEye | null) => (e === 'left' ? (es ? 'izquierdo' : 'left') : es ? 'derecho' : 'right')
  const other = (e: BlindSpotEye | null) => (e === 'left' ? (es ? 'derecho' : 'right') : es ? 'izquierdo' : 'left')
  // Each eye's blind spot is the opposite hemisphere's.
  const hemi = (e: BlindSpotEye | null) => (e === 'left' ? (es ? 'derecho' : 'right') : es ? 'izquierdo' : 'left')
  const parts: string[] = []
  const lead = then ?? now
  if (!lead) return es ? 'No hay medidas suficientes de los dos ojos para compararlos.' : 'There are not enough measurements of both eyes to compare them.'

  if (lead.percent < 10 || !lead.larger) {
    parts.push(es
      ? `${then ? 'Antes del ajuste, los' : 'Los'} puntos ciegos de tus dos ojos tenían un tamaño parecido (${lead.percent} % de diferencia): según este modelo, tus dos hemisferios trabajan de forma equilibrada.`
      : `${then ? 'Before the adjustment, the' : 'The'} blind spots of your two eyes were of a similar size (${lead.percent} % apart): in this model, both hemispheres are working evenly.`)
  } else {
    parts.push(es
      ? `${then ? 'Antes del ajuste, tu' : 'Tu'} punto ciego ${eye(lead.larger)} era un ${lead.percent} % mayor que el ${other(lead.larger)}: según este modelo, tu hemisferio ${hemi(lead.larger)} estaba menos activado.`
      : `${then ? 'Before the adjustment, your' : 'Your'} ${eye(lead.larger)} blind spot was ${lead.percent} % larger than the ${other(lead.larger)}: in this model, your ${hemi(lead.larger)} hemisphere was less active.`)
  }
  if (then && now) {
    const fell = now.percent < then.percent
    const rose = now.percent > then.percent
    parts.push(es
      ? `Tras el ajuste, la diferencia ${fell ? `baja al ${now.percent} %, una respuesta al estímulo` : rose ? `sube al ${now.percent} %` : `se mantiene en el ${now.percent} %`}.`
      : `After the adjustment the difference ${fell ? `falls to ${now.percent} %, a response to the stimulus` : rose ? `rises to ${now.percent} %` : `stays at ${now.percent} %`}.`)
  }
  const first = data.history[0]
  const latest = now ?? then
  if (data.history.length > 1 && first?.asymmetry != null && latest) {
    const d = new Date(first.testedAt).toLocaleDateString(es ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'long', timeZone: data.timeZone })
    parts.push(es ? `Desde tu primera prueba (${d}), la diferencia ha pasado del ${first.asymmetry} % al ${latest.percent} %.` : `Since your first test (${d}), the difference has gone from ${first.asymmetry} % to ${latest.percent} %.`)
  }
  parts.push(es ? 'Lo seguiremos midiendo en tus revisiones.' : 'We will keep measuring it at your reviews.')
  return parts.join(' ')
}

export async function generateBlindSpotReportPdf(data: BlindSpotReportData): Promise<Buffer> {
  const { default: PDFDocument } = await import('pdfkit')
  const es = data.lang === 'es'
  const L = (esText: string, enText: string) => (es ? esText : enText)
  const day = (iso: string) => new Date(iso).toLocaleDateString(es ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: data.timeZone })
  const area = (v: number | null | undefined) => formatBlindSpotArea(v, data.lang)
  const { before, after } = data.session

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: L(`Punto ciego · ${data.patientName}`, `Blind spot · ${data.patientName}`), Creator: 'QuiroFlow' } })
    const chunks: Buffer[] = []
    doc.on('data', (c) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const M = 48
    const PW = doc.page.width
    const W = PW - 2 * M

    const header = () => {
      let logoOk = false
      if (data.logo) {
        try {
          doc.image(data.logo, PW - M - 110, M - 4, { fit: [110, 40], align: 'right' })
          logoOk = true
        } catch {
          // a logo that will not embed is not a reason to have no report
        }
      }
      doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text(data.clinic?.name ?? '', M, M, { width: W - 120 })
      const sub = [data.clinic?.address, data.clinic?.phone].filter(Boolean).join(' · ')
      if (sub) doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(sub, M, M + 18, { width: W - 120 })
      if (!logoOk) doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(day(data.testedAt), M, M + 2, { width: W, align: 'right' })
      doc.moveTo(M, M + 46).lineTo(PW - M, M + 46).lineWidth(0.7).strokeColor(LINE).stroke()
    }

    const footer = (page: number, extra: string) => {
      const y = doc.page.height - M - 26
      doc.moveTo(M, y - 8).lineTo(PW - M, y - 8).lineWidth(0.7).strokeColor(LINE).stroke()
      doc.font('Helvetica').fontSize(7.8).fillColor(MUTED).text(`${extra} · ${L(`Página ${page} de 2`, `Page ${page} of 2`)}`, M, y, { width: W - 150 })
      if (page === 1 && data.practitionerName) doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(data.practitionerName, PW - M - 140, y, { width: 140, align: 'right' })
    }

    // One eye's map: the same drawing as components/blindspot/Map.vue.
    const drawMap = (x: number, y: number, w: number, eye: BlindSpotEye, pre: BlindSpotPoint[] | null, post: BlindSpotPoint[]) => {
      const s = w / 320
      const h = 240 * s
      const fixX = eye === 'right' ? 20 : 300
      const place = ([dx, dy]: [number, number]): [number, number] => [x + (eye === 'right' ? fixX + dx * 10 : fixX - dx * 10) * s, y + (110 - dy * 10) * s]
      doc.save()
      doc.roundedRect(x, y, w, h, 6).fillAndStroke(SURFACE, LINE)
      doc.rect(x, y, w, h).clip()
      for (let gx = 0; gx <= 320; gx += 10) doc.moveTo(x + gx * s, y).lineTo(x + gx * s, y + h).lineWidth(0.4).strokeColor(GRID).stroke()
      for (let gy = 0; gy <= 240; gy += 10) doc.moveTo(x, y + gy * s).lineTo(x + w, y + gy * s).lineWidth(0.4).strokeColor(GRID).stroke()
      doc.moveTo(x, y + 110 * s).lineTo(x + w, y + 110 * s).lineWidth(0.7).strokeColor('#E1E3EA').stroke()
      const [rcx, rcy] = place([BLIND_SPOT_CENTRE.x, BLIND_SPOT_CENTRE.y])
      doc.ellipse(rcx, rcy, BLIND_SPOT_REFERENCE.rx * 10 * s, BLIND_SPOT_REFERENCE.ry * 10 * s).dash(2, { space: 3 }).lineWidth(1).strokeColor(REF).stroke().undash()
      const outline = (pts: BlindSpotPoint[]) => blindSpotContour(pts, 96).map(place)
      if (pre) {
        const c = outline(pre)
        if (c.length) doc.polygon(...c).dash(4, { space: 3 }).lineWidth(1.2).strokeColor(BEFORE).stroke().undash()
      }
      const c = outline(post)
      if (c.length) {
        doc.polygon(...c).fillOpacity(0.12).fill(BRAND).fillOpacity(1)
        doc.polygon(...c).lineWidth(1.6).strokeColor(BRAND).stroke()
      }
      const [fx, fy] = place([0, 0])
      doc.moveTo(fx - 6 * s, fy).lineTo(fx + 6 * s, fy).moveTo(fx, fy - 6 * s).lineTo(fx, fy + 6 * s).lineWidth(1.2).strokeColor(INK).stroke()
      doc.restore()
      return h
    }

    const statBox = (x: number, y: number, w: number, label: string, value: string) => {
      doc.roundedRect(x, y, w, 52, 7).fillAndStroke(SURFACE, LINE)
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED).text(label.toUpperCase(), x + 10, y + 10, { width: w - 20, characterSpacing: 0.5 })
      doc.font('Helvetica-Bold').fontSize(15).fillColor(INK).text(value, x + 10, y + 26, { width: w - 20, lineBreak: false })
    }

    // ---------------- Page 1: the result
    header()
    let y = M + 64
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text(L(`INFORME PARA ${data.patientName.toUpperCase()}`, `REPORT FOR ${data.patientName.toUpperCase()}`), M, y, { characterSpacing: 0.6 })
    y += 14
    doc.font('Helvetica-Bold').fontSize(24).fillColor(INK).text(L('Tu prueba de punto ciego', 'Your blind spot test'), M, y)
    y += 34
    doc.font('Helvetica').fontSize(11).fillColor(INK_SOFT).text(
      before
        ? L('Cada ojo tiene un pequeño punto ciego, donde el nervio óptico sale hacia el cerebro. Hoy lo hemos medido en los dos ojos, antes y después del ajuste.', 'Each eye has a small blind spot, where the optic nerve leaves for the brain. Today we measured it in both eyes, before and after the adjustment.')
        : L('Cada ojo tiene un pequeño punto ciego, donde el nervio óptico sale hacia el cerebro. Hoy lo hemos medido en los dos ojos.', 'Each eye has a small blind spot, where the optic nerve leaves for the brain. Today we measured it in both eyes.'),
      M, y, { width: W, lineGap: 2 },
    )
    y = doc.y + 16

    const mapW = (W - 16) / 2
    const eyeTitle = (eye: BlindSpotEye, x: number) => {
      const b = eye === 'left' ? before?.left_area : before?.right_area
      const a = eye === 'left' ? after.left_area : after.right_area
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(eye === 'left' ? L('Ojo izquierdo', 'Left eye') : L('Ojo derecho', 'Right eye'), x, y, { width: mapW / 2 })
      doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(before ? `${area(b)} - ${area(a)} °²` : `${area(a)} °²`, x + mapW / 2, y, { width: mapW / 2, align: 'right' })
    }
    eyeTitle('left', M)
    eyeTitle('right', M + mapW + 16)
    y += 16
    const mh = drawMap(M, y, mapW, 'left', before?.left_eye.points ?? null, after.left_eye.points)
    drawMap(M + mapW + 16, y, mapW, 'right', before?.right_eye.points ?? null, after.right_eye.points)
    y += mh + 8
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(
      [before ? L('Discontinua naranja: antes del ajuste', 'Dashed orange: before the adjustment') : null, before ? L('Continua: después', 'Solid: after') : L('Continua: medido', 'Solid: measured'), L('Punteado gris: tamaño de referencia', 'Dotted grey: typical size'), L(`${after.points_per_eye} puntos por ojo`, `${after.points_per_eye} points per eye`)].filter(Boolean).join('   ·   '),
      M, y, { width: W },
    )
    y = doc.y + 16

    const now = blindSpotAsymmetry(after.right_area, after.left_area)
    const then = before ? blindSpotAsymmetry(before.right_area, before.left_area) : null
    const bw = (W - 24) / 3
    statBox(M, y, bw, L('Diferencia entre ojos', 'Difference between eyes'), then && now ? `${then.percent} % - ${now.percent} %` : now ? `${now.percent} %` : '-')
    const first = data.history[0]
    statBox(M + bw + 12, y, bw, L('Desde la 1.ª prueba', 'Since the first test'), data.history.length > 1 && first?.asymmetry != null && now ? `${first.asymmetry} % - ${now.percent} %` : L('Primera prueba', 'First test'))
    statBox(M + 2 * (bw + 12), y, bw, L('Fecha', 'Date'), new Date(data.testedAt).toLocaleDateString(es ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: data.timeZone }))
    y += 68

    const note = after.note || before?.note
    if (note) {
      const h = doc.font('Helvetica').fontSize(10.5).heightOfString(note, { width: W - 32 }) + 40
      doc.roundedRect(M, y, W, h, 8).fill('#F7F8FA')
      doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(L('Comentario de tu quiropráctico', 'From your chiropractor'), M + 16, y + 12)
      doc.font('Helvetica').fontSize(10.5).fillColor(INK_SOFT).text(note, M + 16, y + 28, { width: W - 32 })
      y += h + 14
    }
    doc.roundedRect(M, y, W, 36, 8).fillAndStroke(BRAND_TINT, '#D8DCFB')
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#3B32C9').text(L('En la página 2: qué significa este resultado para tu sistema nervioso.', 'On page 2: what this result means for your nervous system.'), M + 16, y + 12, { width: W - 32 })
    footer(1, L('Medición funcional para el seguimiento en consulta. No es una prueba diagnóstica ni sustituye una revisión oftalmológica', 'A functional measure for follow-up in the clinic. Not a diagnostic test, and no substitute for an eye examination'))

    // ---------------- Page 2: the nervous system
    doc.addPage()
    header()
    y = M + 64
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text(L('INTERPRETACIÓN SEGÚN LA NEUROLOGÍA FUNCIONAL · CARRICK INSTITUTE', 'AS FUNCTIONAL NEUROLOGY READS IT · CARRICK INSTITUTE'), M, y, { characterSpacing: 0.6 })
    y += 14
    doc.font('Helvetica-Bold').fontSize(22).fillColor(INK).text(L('Qué significa para tu sistema nervioso', 'What it means for your nervous system'), M, y, { width: W })
    y = doc.y + 14

    // The diagram: each eye's blind spot to the opposite hemisphere, through
    // the thalamus, which also receives the spine's signals.
    const dh = 150
    doc.roundedRect(M, y, W, dh, 8).fillAndStroke(SURFACE, LINE)
    const cx = M + W / 2
    const larger = (then ?? now)?.larger ?? null
    const lessActive: 'left' | 'right' | null = (then ?? now)?.percent != null && (then ?? now)!.percent >= 10 ? (larger === 'left' ? 'right' : larger === 'right' ? 'left' : null) : null
    const hemi = (side: 'left' | 'right', x: number) => {
      const on = lessActive === side
      doc.roundedRect(x, y + 12, 104, 44, 20).fillAndStroke(on ? BRAND_TINT : '#FFFFFF', on ? BRAND : '#CFD2DC')
      doc.font('Helvetica-Bold').fontSize(9).fillColor(on ? '#3B32C9' : INK_SOFT).text(side === 'left' ? L('Hemisferio izquierdo', 'Left hemisphere') : L('Hemisferio derecho', 'Right hemisphere'), x + 6, y + 23, { width: 92, align: 'center' })
    }
    hemi('left', cx - 110)
    hemi('right', cx + 6)
    const eyeY = y + 122
    doc.circle(cx - 34, eyeY, 10).lineWidth(1.2).strokeColor(INK).stroke()
    doc.circle(cx - 34, eyeY, 4).fill(INK)
    doc.circle(cx + 34, eyeY, 10).lineWidth(1.2).strokeColor(INK).stroke()
    doc.circle(cx + 34, eyeY, 4).fill(INK)
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(L('OI', 'L'), cx - 44, eyeY + 13, { width: 20, align: 'center' }).text(L('OD', 'R'), cx + 24, eyeY + 13, { width: 20, align: 'center' })
    // Left eye to the right hemisphere, right eye to the left: they cross.
    doc.moveTo(cx - 30, eyeY - 10).bezierCurveTo(cx - 26, y + 90, cx + 50, y + 84, cx + 58, y + 58).lineWidth(1.6).strokeColor(BRAND).stroke()
    doc.moveTo(cx + 30, eyeY - 10).bezierCurveTo(cx + 26, y + 90, cx - 50, y + 84, cx - 58, y + 58).lineWidth(1.6).strokeColor(MUTED).stroke()
    doc.roundedRect(cx - 28, y + 74, 56, 18, 9).fillAndStroke('#FFFFFF', '#CFD2DC')
    doc.font('Helvetica-Bold').fontSize(8).fillColor(INK).text(L('Tálamo', 'Thalamus'), cx - 28, y + 79, { width: 56, align: 'center' })
    doc.ellipse(M + 70, y + 84, 14, 19).dash(3, { space: 3 }).lineWidth(1.2).strokeColor(BRAND).stroke().undash()
    doc.font('Helvetica').fontSize(8).fillColor(INK_SOFT).text(L('Punto ciego del ojo izquierdo', 'Left eye blind spot'), M + 20, y + 36, { width: 100, align: 'center' })
    doc.ellipse(M + W - 70, y + 84, 14, 19).dash(3, { space: 3 }).lineWidth(1.2).strokeColor(MUTED).stroke().undash()
    doc.font('Helvetica').fontSize(8).fillColor(INK_SOFT).text(L('Punto ciego del ojo derecho', 'Right eye blind spot'), M + W - 120, y + 36, { width: 100, align: 'center' })
    doc.moveTo(M + 86, y + 90).lineTo(cx - 44, eyeY - 4).dash(3, { space: 3 }).lineWidth(1).strokeColor(BRAND).stroke().undash()
    doc.moveTo(M + W - 86, y + 90).lineTo(cx + 44, eyeY - 4).dash(3, { space: 3 }).lineWidth(1).strokeColor(MUTED).stroke().undash()
    doc.roundedRect(cx + 78, y + 112, 92, 22, 6).fillAndStroke('#FEF6E7', BEFORE)
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#96591A').text(L('Columna cervical', 'Cervical spine'), cx + 78, y + 119, { width: 92, align: 'center' })
    doc.moveTo(cx + 78, y + 118).bezierCurveTo(cx + 60, y + 112, cx + 40, y + 100, cx + 28, y + 90).lineWidth(1.1).strokeColor(BEFORE).stroke()
    y += dh + 6
    doc.font('Helvetica').fontSize(8.8).fillColor(MUTED).text(L('La vía visual se cruza: lo que ve cada ojo hacia la sien, donde está su punto ciego, lo procesa el hemisferio del lado contrario. El tálamo reúne esa información con la que llega del cuerpo, también de la columna.', 'The visual pathway crosses: what each eye sees towards the temple, where its blind spot is, is processed by the opposite hemisphere. The thalamus brings that together with what arrives from the body, the spine included.'), M, y, { width: W })
    y = doc.y + 12

    const blocks: Array<[string, string]> = [
      [L('1  Cada ojo, un hemisferio', '1  Each eye, one hemisphere'), L('El punto ciego del ojo izquierdo lo procesa la corteza visual del hemisferio derecho; el del ojo derecho, el hemisferio izquierdo. Por eso comparar los dos ojos es comparar los dos lados del cerebro.', 'The left eye’s blind spot is processed by the visual cortex of the right hemisphere, and the right eye’s by the left. Comparing the two eyes is comparing the two sides of the brain.')],
      [L('2  El estado de activación', '2  How active it is'), L('La neurología funcional del Dr. F. R. Carrick llama estado integrativo central a lo preparadas que están unas neuronas para responder. Depende de los estímulos que reciben por el tálamo: vista, oído, equilibrio y, sobre todo, músculos y articulaciones de la columna.', 'Dr F. R. Carrick’s functional neurology calls how ready a group of neurons is to respond its central integrative state. It depends on what reaches them through the thalamus: sight, hearing, balance and, above all, the muscles and joints of the spine.')],
      [L('3  Por qué cambia de tamaño', '3  Why its size changes'), L('Si un hemisferio recibe menos estímulo, su corteza visual responde peor y el punto ciego del ojo contrario se mide más grande. La diferencia entre ojos se usa como indicador de hemisfericidad: un lado del cerebro trabajando por debajo del otro.', 'When a hemisphere receives less stimulation, its visual cortex responds less well and the opposite eye’s blind spot measures larger. The difference between the eyes is used as a sign of hemisphericity: one side of the brain working below the other.')],
      [L('4  Qué aporta el ajuste', '4  What the adjustment does'), L('El ajuste estimula los receptores de las articulaciones de la columna. Esas señales suben por el cerebelo y el tálamo hasta la corteza. Si el punto ciego se reduce después, se interpreta como que ese hemisferio ha respondido al estímulo.', 'The adjustment stimulates the receptors in the joints of the spine. Those signals travel up through the cerebellum and the thalamus to the cortex. When the blind spot shrinks afterwards, it is read as that hemisphere responding to the stimulus.')],
    ]
    const colW = (W - 12) / 2
    const blockH = (b: [string, string]) => doc.font('Helvetica').fontSize(9.6).heightOfString(b[1], { width: colW - 24, lineGap: 1.5 }) + 40
    for (let row = 0; row < 2; row++) {
      const pairH = Math.max(blockH(blocks[row * 2]!), blockH(blocks[row * 2 + 1]!))
      for (let col = 0; col < 2; col++) {
        const b = blocks[row * 2 + col]!
        const x = M + col * (colW + 12)
        doc.roundedRect(x, y, colW, pairH, 8).lineWidth(0.7).strokeColor(LINE).stroke()
        doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(b[0], x + 12, y + 12, { width: colW - 24 })
        doc.font('Helvetica').fontSize(9.6).fillColor(INK_SOFT).text(b[1], x + 12, y + 30, { width: colW - 24, lineGap: 1.5 })
      }
      y += pairH + 10
    }

    const caseText = blindSpotCaseText(data)
    const ch = doc.font('Helvetica').fontSize(10.5).heightOfString(caseText, { width: W - 36, lineGap: 2 }) + 42
    doc.roundedRect(M, y, W, ch, 8).fillAndStroke(BRAND_TINT, '#D8DCFB')
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#3B32C9').text(L('En tu caso', 'In your case'), M + 18, y + 13)
    doc.font('Helvetica').fontSize(10.5).fillColor(INK).text(caseText, M + 18, y + 31, { width: W - 36, lineGap: 2 })
    y += ch + 12

    doc.font('Helvetica').fontSize(7.8).fillColor(MUTED).text(L('Referencias: Carrick FR. Changes in brain function after manipulation of the cervical spine. J Manipulative Physiol Ther. 1997;20(8):529-545. Carrick Institute, formación en neurología funcional.', 'References: Carrick FR. Changes in brain function after manipulation of the cervical spine. J Manipulative Physiol Ther. 1997;20(8):529-545. Carrick Institute, functional neurology training.'), M, y, { width: W })
    footer(2, L('Interpretación según el modelo de la neurología funcional. No es un diagnóstico médico ni sustituye una revisión oftalmológica o neurológica', 'As read by the functional neurology model. Not a medical diagnosis, and no substitute for an eye or neurological examination'))

    doc.end()
  })
}
