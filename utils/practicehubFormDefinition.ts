import type { DocField } from './docFields'

// A PracticeHub form as its own editor describes it, turned into a template
// here with every field the type it was there.
//
// The API has no such description. /custom_forms is a name and an id, and a
// response is only what one patient answered, so the template the Form
// responses step leaves behind is a guess from the first response it saw:
// only the options that patient ticked, nothing marked required, and the
// field types read off the field names.
//
// PracticeHub's website has the real thing. Settings > Forms lists the forms
//
//   <tr class="tr-6"><td>Name</td><td>Patient</td><td><span ...>Active</span> ...
//
// and each form's editor, /settings/forms/form?action=update&id=6, carries the
// builder's own data in a script:
//
//   saved_data = [[{"type":"paragraph","label":"..."},
//                  {"type":"signature","required":true,"label":"Firmado","name":"signature-17…"}]];
//   saved_section_titles = ["Consentimiento "];
//
// one inner list per section. The types seen across one clinic's eleven forms
// (164 fields): header, paragraph, text, textarea, number, date,
// checkbox-group, radio-group, select, signature, drawableimage.
//
// A drawableimage names the picture drawn on as `form_image_id`: 0 for none,
// "assets/male_default.jpg" for PracticeHub's body diagram, otherwise the key
// of an image the clinic uploaded. Its form script builds the address from
// that (libs/form_builder/drawable-image.js), which is what
// practiceHubDiagramUrl repeats.

export interface PracticeHubFormListing {
  id: string
  name: string
  active: boolean
}

export interface PracticeHubBuilderField {
  type?: string
  subtype?: string
  label?: string
  name?: string
  description?: string
  required?: boolean
  other?: boolean
  min?: string | number
  max?: string | number
  values?: { label?: string; value?: string }[]
  form_image_id?: string | number
}

export interface PracticeHubFormDefinition {
  sections: PracticeHubBuilderField[][]
  titles: string[]
}

// The entities a form written in Spanish, Portuguese, French or German uses.
// Names are case-sensitive: &Ntilde; is not &ntilde;.
const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü', ccedil: 'ç',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', Uuml: 'Ü', Ccedil: 'Ç',
  agrave: 'à', egrave: 'è', igrave: 'ì', ograve: 'ò', ugrave: 'ù', acirc: 'â', ecirc: 'ê', ocirc: 'ô', atilde: 'ã', otilde: 'õ',
  auml: 'ä', ouml: 'ö', Auml: 'Ä', Ouml: 'Ö', szlig: 'ß',
  iquest: '¿', iexcl: '¡', ordm: 'º', ordf: 'ª', deg: '°', euro: '€', laquo: '«', raquo: '»',
  hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
}

/** A builder label as plain text: its tags dropped, its entities decoded. */
export function practiceHubPlainText(value: unknown): string {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name] ?? whole)
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** The forms Settings > Forms lists. */
export function parsePracticeHubFormList(html: string): PracticeHubFormListing[] {
  const forms: PracticeHubFormListing[] = []
  const seen = new Set<string>()
  for (const row of html.matchAll(/<tr[^>]*class="[^"]*\btr-(\d+)\b[^"]*"[^>]*>([\s\S]*?)<\/tr>/g)) {
    const id = row[1]!
    if (seen.has(id)) continue
    seen.add(id)
    const cells = [...row[2]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => practiceHubPlainText(cell[1]))
    forms.push({ id, name: cells[0] ?? '', active: !/\binactive\b/i.test(cells[2] ?? '') })
  }
  return forms
}

/** The JSON value starting at `start`, read by its brackets rather than to the next `];` (a label can hold one). */
function jsonValueAt(text: string, start: number): unknown {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '[' || ch === '{') depth++
    else if (ch === ']' || ch === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

function assignedValue(html: string, name: string): unknown {
  // The editor also keeps an older `//var saved_data = [...]` line, commented out.
  for (const match of html.matchAll(new RegExp(`(//)?[ \\t]*(?:var[ \\t]+)?${name}[ \\t]*=[ \\t]*(?=[\\[{])`, 'g'))) {
    if (match[1]) continue
    const value = jsonValueAt(html, match.index + match[0].length)
    if (value !== null) return value
  }
  return null
}

/** The form a form editor page describes, or null when the page is not one. */
export function parsePracticeHubFormDefinition(html: string): PracticeHubFormDefinition | null {
  const data = assignedValue(html, 'saved_data')
  if (!Array.isArray(data)) return null
  const sections = (data.every((section) => Array.isArray(section)) ? data : [data]) as PracticeHubBuilderField[][]
  const titles = assignedValue(html, 'saved_section_titles')
  return {
    sections: sections.map((section) => section.filter((field) => field && typeof field === 'object')),
    titles: Array.isArray(titles) ? titles.map((title) => practiceHubPlainText(title)) : [],
  }
}

/** Where PracticeHub serves the picture a drawable field is drawn on, or null when none was chosen. */
export function practiceHubDiagramUrl(formImageId: unknown): string | null {
  const id = String(formImageId ?? '').trim()
  if (!id || id === '0') return null
  if (id === 'assets/male_default.jpg') return 'https://s3-eu-west-1.amazonaws.com/phub-dev/assets/male_default.jpg'
  if (!/^[\w./ -]+$/.test(id) || id.includes('..')) return null
  return `https://s3-eu-west-1.amazonaws.com/phub-production/${id.split('/').map(encodeURIComponent).join('/')}`
}

/** Every picture the form's drawable fields are drawn on, once each. */
export function practiceHubDefinitionImages(definition: PracticeHubFormDefinition): string[] {
  const ids = definition.sections.flat().filter((field) => field.type === 'drawableimage').map((field) => String(field.form_image_id ?? '').trim())
  return [...new Set(ids.filter((id) => practiceHubDiagramUrl(id)))]
}

/**
 * The template blocks for a form, each the type its PracticeHub field was.
 * `imagePaths` maps a form_image_id to where that picture was stored here; a
 * drawable field whose picture is not in it still becomes a drawable block,
 * and the clinic picks the picture in Settings > Docs.
 */
export function practiceHubDefinitionBlocks(
  definition: PracticeHubFormDefinition,
  opts: { imagePaths?: Map<string, string>; newId?: () => string } = {},
): DocField[] {
  const newId = opts.newId ?? (() => crypto.randomUUID())
  const blocks: DocField[] = []
  const titled = definition.sections.length > 1

  definition.sections.forEach((section, index) => {
    const title = definition.titles[index] ?? ''
    if (titled && title) blocks.push({ id: newId(), type: 'heading', label: title })

    for (const field of section) {
      const text = practiceHubPlainText(field.label)
      const help = practiceHubPlainText(field.description)
      const label = help && text ? `${text} (${help})` : text || help
      const required = field.required === true
      const options = (field.values ?? []).map((option) => practiceHubPlainText(option.label ?? option.value)).filter(Boolean)

      switch (field.type) {
        case 'header':
          if (label) blocks.push({ id: newId(), type: 'heading', label })
          break
        case 'paragraph':
          if (label) blocks.push({ id: newId(), type: 'text', label })
          break
        case 'signature':
          blocks.push({ id: newId(), type: 'signature', label: label || 'Firma', required, value: null })
          break
        case 'drawableimage': {
          const imagePath = opts.imagePaths?.get(String(field.form_image_id ?? '').trim())
          blocks.push({ id: newId(), type: 'drawable_image', label: label || 'Diagrama', required, value: null, ...(imagePath ? { imagePath } : {}) })
          break
        }
        case 'checkbox-group':
          blocks.push({ id: newId(), type: 'choice', label: label || 'Opciones', required, multiple: true, options, allowOther: field.other === true, value: [] })
          break
        case 'radio-group':
        case 'select':
          blocks.push({ id: newId(), type: 'choice', label: label || 'Opciones', required, multiple: false, options, allowOther: field.other === true, value: null })
          break
        case 'date':
          blocks.push({ id: newId(), type: 'date', label: label || 'Fecha', required, value: null })
          break
        case 'number':
          // The scale block here is 0 to 10, so only a number asked on that range is one.
          blocks.push({ id: newId(), type: Number(field.min) === 0 && Number(field.max) === 10 ? 'scale' : 'short_text', label: label || 'Número', required, value: null })
          break
        case 'textarea':
          blocks.push({ id: newId(), type: 'long_text', label: label || 'Respuesta', required, value: null })
          break
        default:
          // text, and anything PracticeHub adds later: a question that can at least be answered.
          if (label) blocks.push({ id: newId(), type: 'short_text', label, required, value: null })
      }
    }
  })
  return blocks
}
