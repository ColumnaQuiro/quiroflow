import { postureHeadline, type FrontMetrics, type PostureView, type SideMetrics, type ViewMetrics } from './posture'

// What the posture report says, as text: the findings under each photo, the
// totals, the effective head weight, and a closing paragraph. The PDF itself
// is drawn by server/utils/posturePdf.ts; this part is pure so it can be
// tested and read without a PDF in the way.
//
// Written for the patient, in plain words. The numbers are estimates from a
// photo, so the wording describes what the photo shows and never names a
// condition.

export type ReportLang = 'es' | 'en'

export interface ReportFinding { label: string; text: string }
export interface ReportSection {
  view: PostureView
  title: string
  findings: ReportFinding[]
  totals: { label: string; value: string }[]
  /** The effective head weight, side views only. */
  headWeight: { label: string; value: string; note: string } | null
}

// Below these a line reads as level or centred: a photo cannot tell 0.3°
// from nothing, and a report that lists it invites a question it cannot answer.
export const LEVEL_DEG = 0.5
export const CENTRED_CM = 0.5
const UPRIGHT_HEAD_KG = 5.4

const num = (n: number, lang: ReportLang) => (Math.round(n * 10) / 10 || 0).toLocaleString(lang === 'es' ? 'es-ES' : 'en-GB', { maximumFractionDigits: 1 })

const T = {
  es: {
    front: 'Vista frontal',
    back: 'Vista posterior',
    right: 'Vista lateral derecha',
    left: 'Vista lateral izquierda',
    head: 'Cabeza',
    shoulders: 'Hombros',
    shoulder: 'Hombro',
    pelvis: 'Pelvis',
    hip: 'Cadera',
    knee: 'Rodilla',
    // "La cabeza, la pelvis" and "los hombros": the words agree with which.
    centred: (pl: boolean) => (pl ? 'centrados' : 'centrada'),
    level: (pl: boolean) => (pl ? 'nivelados' : 'nivelada'),
    toRight: (cm: string, pl: boolean) => `${pl ? 'desplazados' : 'desplazada'} ${cm} cm hacia la derecha`,
    toLeft: (cm: string, pl: boolean) => `${pl ? 'desplazados' : 'desplazada'} ${cm} cm hacia la izquierda`,
    lowerRight: (d: string, pl: boolean) => `${pl ? 'inclinados' : 'inclinada'} ${d}°, ${pl ? 'más bajo el derecho' : 'más baja a la derecha'}`,
    lowerLeft: (d: string, pl: boolean) => `${pl ? 'inclinados' : 'inclinada'} ${d}°, ${pl ? 'más bajo el izquierdo' : 'más baja a la izquierda'}`,
    onLine: 'sobre la vertical',
    ahead: (cm: string) => `${cm} cm por delante de la vertical`,
    behind: (cm: string) => `${cm} cm por detrás de la vertical`,
    headAngle: (d: string) => `${d}° por delante del hombro`,
    totalShifts: 'Desplazamientos totales',
    totalTilts: 'Inclinaciones totales',
    headWeight: 'Peso efectivo de la cabeza',
    headWeightNote: (x: string) => `Erguida pesa unos 5 kg. Así, el cuello sostiene unas ${x} veces ese peso.`,
    headWeightUpright: 'Erguida pesa unos 5 kg: el cuello la sostiene sin carga añadida.',
  },
  en: {
    front: 'Front view',
    back: 'Back view',
    right: 'Right side view',
    left: 'Left side view',
    head: 'Head',
    shoulders: 'Shoulders',
    shoulder: 'Shoulder',
    pelvis: 'Pelvis',
    hip: 'Hip',
    knee: 'Knee',
    centred: (_pl: boolean) => 'centred',
    level: (_pl: boolean) => 'level',
    toRight: (cm: string, _pl: boolean) => `shifted ${cm} cm to the right`,
    toLeft: (cm: string, _pl: boolean) => `shifted ${cm} cm to the left`,
    lowerRight: (d: string, _pl: boolean) => `tilted ${d}°, lower on the right`,
    lowerLeft: (d: string, _pl: boolean) => `tilted ${d}°, lower on the left`,
    onLine: 'on the vertical',
    ahead: (cm: string) => `${cm} cm ahead of the vertical`,
    behind: (cm: string) => `${cm} cm behind the vertical`,
    headAngle: (d: string) => `${d}° ahead of the shoulder`,
    totalShifts: 'Total shifts',
    totalTilts: 'Total tilts',
    headWeight: 'Effective head weight',
    headWeightNote: (x: string) => `Upright it weighs about 5 kg, so the neck is holding about ${x} times that.`,
    headWeightUpright: 'Upright it weighs about 5 kg: the neck holds it with no added load.',
  },
} as const

export function viewTitle(view: PostureView, lang: ReportLang) {
  return T[lang][view]
}

function frontSection(view: PostureView, m: FrontMetrics, lang: ReportLang): ReportSection {
  const t = T[lang]
  const shift = (cm: number, pl: boolean) => (Math.abs(cm) < CENTRED_CM ? t.centred(pl) : cm > 0 ? t.toRight(num(cm, lang), pl) : t.toLeft(num(-cm, lang), pl))
  const tilt = (d: number, pl: boolean) => (Math.abs(d) < LEVEL_DEG ? t.level(pl) : d > 0 ? t.lowerRight(num(d, lang), pl) : t.lowerLeft(num(-d, lang), pl))
  // "Shoulders: centred, level" reads better than two lines saying nothing.
  const line = (cm: number, d: number, pl = false) => [shift(cm, pl), tilt(d, pl)].join(' · ')
  const shifts = Math.abs(m.headShift) + Math.abs(m.shoulderShift) + Math.abs(m.hipShift)
  const tilts = Math.abs(m.headTilt) + Math.abs(m.shoulderTilt) + Math.abs(m.hipTilt)
  return {
    view,
    title: t[view],
    findings: [
      { label: t.head, text: line(m.headShift, m.headTilt) },
      { label: t.shoulders, text: line(m.shoulderShift, m.shoulderTilt, true) },
      { label: t.pelvis, text: line(m.hipShift, m.hipTilt) },
    ],
    totals: [
      { label: t.totalShifts, value: `${num(shifts, lang)} cm` },
      { label: t.totalTilts, value: `${num(tilts, lang)}°` },
    ],
    headWeight: null,
  }
}

function sideSection(view: PostureView, m: SideMetrics, lang: ReportLang): ReportSection {
  const t = T[lang]
  const fwd = (cm: number) => (Math.abs(cm) < CENTRED_CM ? t.onLine : cm > 0 ? t.ahead(num(cm, lang)) : t.behind(num(-cm, lang)))
  const shifts = Math.abs(m.earForward) + Math.abs(m.shoulderForward) + Math.abs(m.hipForward) + Math.abs(m.kneeForward)
  const ratio = m.headWeight / UPRIGHT_HEAD_KG
  return {
    view,
    title: t[view],
    findings: [
      { label: t.head, text: [fwd(m.earForward), ...(Math.abs(m.headAngle) >= LEVEL_DEG ? [t.headAngle(num(m.headAngle, lang))] : [])].join(' · ') },
      { label: t.shoulder, text: fwd(m.shoulderForward) },
      { label: t.hip, text: fwd(m.hipForward) },
      { label: t.knee, text: fwd(m.kneeForward) },
    ],
    totals: [{ label: t.totalShifts, value: `${num(shifts, lang)} cm` }],
    headWeight: {
      label: t.headWeight,
      value: `${num(m.headWeight, lang)} kg`,
      note: ratio >= 1.15 ? t.headWeightNote(num(ratio, lang)) : t.headWeightUpright,
    },
  }
}

/** One section per view taken, in the order the photos are taken. */
export function postureReportSections(metrics: Partial<Record<PostureView, ViewMetrics>>, lang: ReportLang): ReportSection[] {
  const out: ReportSection[] = []
  for (const v of ['front', 'right', 'back', 'left'] as PostureView[]) {
    const m = metrics[v]
    if (!m) continue
    out.push(v === 'front' || v === 'back' ? frontSection(v, m as FrontMetrics, lang) : sideSection(v, m as SideMetrics, lang))
  }
  return out
}

/**
 * The closing paragraph: what stands out, in a sentence or two, and what
 * comes next. Thresholds are deliberately conservative -- this is read by the
 * patient, and a degree and a half of shoulder tilt is common in anyone.
 */
export function postureConclusion(metrics: Partial<Record<PostureView, ViewMetrics>>, lang: ReportLang): string {
  const h = postureHeadline(metrics)
  const es = lang === 'es'
  const notes: string[] = []
  if (h.headWeight !== null && h.headWeight >= 10) {
    notes.push(
      es
        ? `la cabeza se adelanta respecto al hombro, y eso hace que el cuello sostenga el equivalente a unos ${num(h.headWeight, lang)} kg en lugar de unos 5`
        : `the head sits ahead of the shoulder, which has the neck holding the equivalent of about ${num(h.headWeight, lang)} kg instead of about 5`,
    )
  }
  if (h.shoulderTilt !== null && Math.abs(h.shoulderTilt) >= 2) {
    const side = h.shoulderTilt > 0 ? (es ? 'derecho' : 'right') : es ? 'izquierdo' : 'left'
    notes.push(es ? `el hombro ${side} queda más bajo (${num(Math.abs(h.shoulderTilt), lang)}°)` : `the ${side} shoulder sits lower (${num(Math.abs(h.shoulderTilt), lang)}°)`)
  }
  if (h.hipTilt !== null && Math.abs(h.hipTilt) >= 2) {
    const side = h.hipTilt > 0 ? (es ? 'derecho' : 'right') : es ? 'izquierdo' : 'left'
    notes.push(es ? `la pelvis está más baja del lado ${side} (${num(Math.abs(h.hipTilt), lang)}°)` : `the pelvis is lower on the ${side} (${num(Math.abs(h.hipTilt), lang)}°)`)
  }
  const next = es
    ? 'Repetiremos estas fotos en las próximas revisiones, en el mismo sitio y de la misma forma, para ver cómo evoluciona.'
    : 'We will repeat these photos at your next reviews, in the same place and the same way, to see how it changes.'
  if (!notes.length) {
    return `${es ? 'En estas fotos la alineación es buena: no hay desplazamientos ni inclinaciones que destaquen.' : 'In these photos the alignment is good: no shift or tilt stands out.'} ${next}`
  }
  const joined = notes.length === 1 ? notes[0]! : `${notes.slice(0, -1).join('; ')}${es ? ' y ' : ' and '}${notes[notes.length - 1]}`
  return `${es ? 'Lo que más destaca en estas fotos: ' : 'What stands out most in these photos: '}${joined}. ${next}`
}

export interface PostureEvolutionLine { label: string; then: string; now: string; better: boolean | null }

/** Then and now for the headline numbers, against an earlier assessment. */
export function postureEvolution(
  earlier: Partial<Record<PostureView, ViewMetrics>>,
  now: Partial<Record<PostureView, ViewMetrics>>,
  lang: ReportLang,
): PostureEvolutionLine[] {
  const a = postureHeadline(earlier)
  const b = postureHeadline(now)
  const es = lang === 'es'
  const rows: [string, number | null, number | null, string][] = [
    [es ? 'Peso efectivo de la cabeza' : 'Effective head weight', a.headWeight, b.headWeight, 'kg'],
    [es ? 'Cabeza por delante del hombro' : 'Head ahead of the shoulder', a.headForward, b.headForward, 'cm'],
    [es ? 'Inclinación de hombros' : 'Shoulder tilt', a.shoulderTilt, b.shoulderTilt, '°'],
    [es ? 'Inclinación de pelvis' : 'Pelvic tilt', a.hipTilt, b.hipTilt, '°'],
  ]
  const fmt = (n: number, unit: string) => `${num(unit === '°' ? Math.abs(n) : n, lang)}${unit === '°' ? '°' : ` ${unit}`}`
  return rows
    .filter(([, x, y]) => x !== null && y !== null)
    .map(([label, x, y, unit]) => {
      const before = Math.abs(x!)
      const after = Math.abs(y!)
      return { label, then: fmt(x!, unit), now: fmt(y!, unit), better: Math.abs(after - before) < 0.1 ? null : after < before }
    })
}

/** The fixed paragraphs. */
export function postureReportCopy(lang: ReportLang) {
  return lang === 'es'
    ? {
        title: (name: string) => `Informe postural de ${name}`,
        intro:
          'Este informe recoge tu postura tal y como se ve en las fotos tomadas en consulta. Sobre cada foto se marcan unos puntos de referencia (oreja, hombro, cadera, rodilla y tobillo) y una línea vertical que sale del tobillo: cuanto más se acercan los puntos a esa línea, y cuanto más nivelados están a ambos lados, más equilibrada es la postura. Las medidas son estimaciones a partir de la imagen.',
        conclusion: 'Resumen',
        evolution: (date: string) => `Evolución desde el ${date}`,
        then: 'Antes',
        now: 'Ahora',
        legend: 'Línea azul: la vertical desde el tobillo. En naranja, los puntos medidos y las líneas entre ellos.',
        disclaimer: 'Estimaciones a partir de fotografías, para documentar y explicar. No constituyen un diagnóstico.',
        page: (n: number, of: number) => `Página ${n} de ${of}`,
      }
    : {
        title: (name: string) => `Posture report for ${name}`,
        intro:
          'This report shows your posture as it appears in the photos taken at the clinic. Each photo is marked with reference points (ear, shoulder, hip, knee and ankle) and a vertical line rising from the ankle: the closer the points sit to that line, and the more level they are from side to side, the more balanced the posture. The measurements are estimates from the image.',
        conclusion: 'Summary',
        evolution: (date: string) => `Changes since ${date}`,
        then: 'Then',
        now: 'Now',
        legend: 'Blue line: the vertical from the ankle. In orange, the measured points and the lines between them.',
        disclaimer: 'Estimates from photographs, to document and explain. Not a diagnosis.',
        page: (n: number, of: number) => `Page ${n} of ${of}`,
      }
}
