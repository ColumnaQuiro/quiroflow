// The words the lead board and drawer put around the API's figures.
//
// The API used to send them finished, in English -- "New Lead", "2 d in
// stage", "Direct", "Unassigned", "created 7 Nov" -- so a Spanish front desk
// read a board that was English everywhere but its people's names. As with
// the dashboard (utils/growthDashboard.ts), the server now says what the
// values are and the browser, which knows the reader's language, words them.

type T = (en: string, es: string) => string

const STAGE_TITLES: Record<string, [string, string]> = {
  new: ['New lead', 'Lead nuevo'],
  contacted: ['Contacted', 'Contactado'],
  qualified: ['Qualified', 'Cualificado'],
  booked: ['Booked', 'Reservado'],
  showed: ['Showed', 'Asistió'],
  converted: ['Converted', 'Convertido'],
  lost: ['Lost', 'Perdido'],
}

/** A stage's name. Unknown keys come back as they are rather than as nothing. */
export function growthLeadStageTitle(key: string, t: T, fallback?: string): string {
  const pair = STAGE_TITLES[key]
  return pair ? t(pair[0], pair[1]) : (fallback ?? key)
}

/** "12 min in stage", "3 h in stage", "2 d in stage", or "just now". */
export function growthLeadTimeInStage(since: string, t: T, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - new Date(since).getTime()) / 60000))
  if (minutes < 1) return t('Just now', 'Ahora mismo')
  if (minutes < 60) return t(`${minutes} min in stage`, `${minutes} min en la etapa`)
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t(`${hours} h in stage`, `${hours} h en la etapa`)
  const days = Math.floor(hours / 24)
  return t(`${days} d in stage`, `${days} d en la etapa`)
}

/** The source as shown, where a lead with none is "Direct". */
export function growthLeadSource(source: string, t: T): string {
  return source === 'Direct' ? t('Direct', 'Directo') : source
}

const ATTRIBUTION_LABELS: Record<string, [string, string]> = {
  campaign: ['Campaign', 'Campaña'],
  ad: ['Ad', 'Anuncio'],
  audience: ['Keyword / audience', 'Palabra clave / público'],
  first_touch: ['First touch', 'Primer contacto'],
  last_touch: ['Last touch', 'Último contacto'],
  cost: ['Cost per lead', 'Coste por lead'],
}

export function growthLeadAttributionLabel(key: string | undefined, t: T, fallback: string): string {
  const pair = key ? ATTRIBUTION_LABELS[key] : undefined
  return pair ? t(pair[0], pair[1]) : fallback
}
