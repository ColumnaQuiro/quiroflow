import { videoEmbedUrl } from './learn'
import { normalizeSearchTerm } from './searchText'

// Importing many exercises into the library from a spreadsheet
// (components/exercises/ImportDialog.vue): a clinic that keeps its home
// exercises as a list of YouTube links adds them in one go instead of one form
// at a time.
//
// An exercise in the library is a name, how to do it and a video link
// (exercises.name / instructions / media_url); sets and reps belong to the
// assignment, not to the exercise, so a file has nothing else to say.
//
// This file never reads the CSV itself -- the dialog does that with papaparse
// and hands over the cells. utils/ is auto-imported by the mobile app as well,
// whose build cannot resolve papaparse, so nothing here may import it.

export type ExerciseImportField = 'name' | 'video' | 'instructions'

// The template the dialog offers: the header row and nothing else, so no
// example can be imported by mistake (the dialog says what goes in each
// column). `;` because that is the list separator a Spanish Excel opens as
// columns; the BOM is added when it is downloaded so Excel reads accents as
// UTF-8.
export const EXERCISE_IMPORT_TEMPLATE_HEADERS = ['nombre', 'video_youtube', 'instrucciones'] as const

export function exerciseImportTemplateCsv(): string {
  return EXERCISE_IMPORT_TEMPLATE_HEADERS.join(';') + '\r\n'
}

// Headers in either language, any case, with or without accents, spaces or
// underscores: "Vídeo YouTube", "video_youtube" and "VIDEO" all name the video.
const HEADER_ALIASES: Record<ExerciseImportField, string[]> = {
  name: ['nombre', 'name', 'ejercicio', 'exercise', 'nombredelejercicio', 'exercisename', 'titulo', 'title'],
  video: ['videoyoutube', 'youtube', 'youtubeurl', 'urlyoutube', 'enlaceyoutube', 'video', 'videourl', 'urlvideo', 'enlacevideo', 'enlacedelvideo', 'videolink', 'enlace', 'link', 'url'],
  instructions: ['instrucciones', 'instructions', 'descripcion', 'description', 'comohacerlo', 'howtodoit', 'indicaciones', 'explicacion'],
}
const headerKey = (h: string) => normalizeSearchTerm(h.replace(/^\uFEFF/, '')).replace(/[^a-z0-9]/g, '')

export function exerciseImportColumns(header: string[]): Partial<Record<ExerciseImportField, number>> {
  const keys = header.map(headerKey)
  const columns: Partial<Record<ExerciseImportField, number>> = {}
  for (const field of Object.keys(HEADER_ALIASES) as ExerciseImportField[]) {
    // The earliest alias wins, so "video_youtube" is preferred to a loose "url".
    for (const alias of HEADER_ALIASES[field]) {
      const i = keys.indexOf(alias)
      if (i >= 0 && !Object.values(columns).includes(i)) {
        columns[field] = i
        break
      }
    }
  }
  return columns
}

// The separator a file uses, read from its first line: Excel in Spanish saves
// "CSV" with `;`, most other tools with `,`, and a copy from a sheet has tabs.
export function exerciseImportDelimiter(text: string): ',' | ';' | '\t' {
  const first = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? ''
  const count = (c: string) => first.split(c).length - 1
  const options = [';', ',', '\t'] as const
  return options.reduce<',' | ';' | '\t'>((best, c) => (count(c) > count(best) ? c : best), ',')
}

// Any way a YouTube (or Vimeo) video is written -- watch?v=, youtu.be/,
// /shorts/, /embed/, m.youtube.com, with or without https:// or a playlist
// behind it -- to the one form the library keeps: the address a person would
// open. Patients watch it embedded, through videoEmbedUrl, from any of them.
// null when the cell is empty; false when it is something else.
export function exerciseImportVideoLink(raw: string | null | undefined): string | null | false {
  let s = (raw ?? '').trim()
  if (!s) return null
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s) && /^(www\.|m\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com|vimeo\.com|player\.vimeo\.com)\//i.test(s)) s = `https://${s}`
  if (!/^https?:\/\//i.test(s)) return false
  const embed = videoEmbedUrl(s)
  if (!embed) return false
  const yt = embed.match(/^https:\/\/www\.youtube-nocookie\.com\/embed\/([\w-]+)$/)?.[1]
  if (yt) return `https://www.youtube.com/watch?v=${yt}`
  const vimeo = embed.match(/^https:\/\/player\.vimeo\.com\/video\/(\d+)$/)?.[1]
  if (vimeo) return `https://vimeo.com/${vimeo}`
  return false
}

// Two names are the same exercise when they differ only in case, accents or
// spacing: "Rotación torácica" is already "rotacion  toracica".
export function exerciseImportNameKey(name: string): string {
  return normalizeSearchTerm(name.trim().replace(/\s+/g, ' '))
}

export type ExerciseImportProblem = 'missing_name' | 'bad_video' | 'exists' | 'repeated'

export interface ExerciseImportRow {
  // Its row in the file, counting the header as 1, so a person can find it.
  line: number
  name: string
  video: string
  instructions: string
  mediaUrl: string | null
  problem: ExerciseImportProblem | null
}

export interface ExerciseImportPlan {
  rows: ExerciseImportRow[]
  columns: Partial<Record<ExerciseImportField, number>>
  // The file has no column that names the exercise: nothing can be read.
  noNameColumn: boolean
}

// Reads the cells of a parsed file (first row the header) against the names
// the library already has, and says for each row whether it can be created.
// A name already in the library, or earlier in the file, is skipped rather
// than doubled -- the same rule the "New exercise" form applies.
export function planExerciseImport(cells: string[][], existingNames: string[]): ExerciseImportPlan {
  const [header = [], ...body] = cells
  const columns = exerciseImportColumns(header)
  if (columns.name === undefined) return { rows: [], columns, noNameColumn: true }

  const existing = new Set(existingNames.map(exerciseImportNameKey))
  const claimed = new Set<string>()
  const cell = (row: string[], field: ExerciseImportField) => {
    const i = columns[field]
    return i === undefined ? '' : (row[i] ?? '').trim()
  }

  const rows: ExerciseImportRow[] = []
  body.forEach((row, i) => {
    if (row.every((c) => !c?.trim())) return
    const name = cell(row, 'name').replace(/\s+/g, ' ')
    const video = cell(row, 'video')
    const instructions = cell(row, 'instructions')
    const link = exerciseImportVideoLink(video)
    const key = exerciseImportNameKey(name)
    let problem: ExerciseImportProblem | null = null
    if (!name) problem = 'missing_name'
    else if (link === false) problem = 'bad_video'
    else if (existing.has(key)) problem = 'exists'
    else if (claimed.has(key)) problem = 'repeated'
    // Only a row that will be created claims its name, so a later, correct
    // copy of a row with a broken link still goes in.
    if (!problem) claimed.add(key)
    rows.push({ line: i + 2, name, video, instructions, mediaUrl: link || null, problem })
  })
  return { rows, columns, noNameColumn: false }
}
