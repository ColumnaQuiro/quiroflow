// Renaming a patient's file (Files tab on the web, the staff app's patient
// record). Only the name people read changes -- patient_files.file_name, which
// is also the name a download is saved under; the object in storage keeps its
// path. Staff only: patients can read their shared files and nothing more
// (the patient_files policies give them SELECT alone).

/** The extension of a file name, dot included ("" when it has none). */
function extensionOf(name: string): string {
  const m = /(\.[A-Za-z0-9]{1,6})$/.exec(name)
  return m ? m[1]! : ''
}

/**
 * The name to save, or null when there is nothing to save: blank, or the same
 * as before. Typing "Informe RX" for "scan_0042.pdf" keeps the ".pdf" -- the
 * extension is how the phone and the download know what opens it -- unless
 * the new name brings its own.
 */
export function renamedFileName(typed: string, previous: string): string | null {
  // Slashes would read as folders in a download name; \s also takes tabs and
  // line breaks pasted in.
  const name = typed.replace(/[/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
  if (!name) return null
  const ext = extensionOf(previous)
  const next = ext && !extensionOf(name) ? `${name}${ext}` : name
  return next === previous ? null : next
}

/** The name without its extension: what the rename field starts with. */
export function editableFileName(name: string): string {
  const ext = extensionOf(name)
  return ext ? name.slice(0, -ext.length) : name
}
