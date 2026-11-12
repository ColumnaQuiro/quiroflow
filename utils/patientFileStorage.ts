// Where a patient's stored objects live, and the sizes they are kept at.
//
// Pure, with no imports: the server (compression, the delete route, the
// backfill), the web Files tab and the mobile bundle all read it, and in the
// mobile bundle `~` means mobile/.

/** Long edge a patient photo is stored at. Approved by the owner, Nov 2026:
 *  3,457 JPEGs averaged 1.3 MB each for pictures only ever seen on a screen. */
export const PATIENT_IMAGE_MAX_EDGE = 2000
/** Long edge of the grid thumbnail: a 4-column card is ~200 px wide, so 480
 *  covers a 2x screen. */
export const PATIENT_THUMB_MAX_EDGE = 480

/**
 * The size an image is stored at: scaled so its long edge is at most
 * `maxEdge`, never enlarged, proportions kept.
 */
export function fitLongEdge(width: number, height: number, maxEdge: number): { width: number; height: number; resized: boolean } {
  const long = Math.max(width, height)
  if (!(long > maxEdge) || !(width > 0) || !(height > 0)) return { width, height, resized: false }
  const scale = maxEdge / long
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), resized: true }
}

/**
 * Where a file's thumbnail is kept: beside it, in the same private bucket,
 * under the same account folder (so the same storage policies cover it).
 *
 * Derived from the file's own path rather than only recorded, so every path
 * that removes a file can remove its thumbnail without the row -- including
 * anonymize_patient, which hands back paths after the rows are gone. Always a
 * .jpg, appended to the whole name so `a.png` and `a.jpg` cannot collide.
 */
export function patientFileThumbPath(storagePath: string): string {
  const cut = storagePath.lastIndexOf('/')
  const dir = cut === -1 ? '' : storagePath.slice(0, cut + 1)
  return `${dir}thumbs/${storagePath.slice(cut + 1)}.jpg`
}

/** A file's own object plus its thumbnail (recorded or derived), for removal. */
export function patientFileObjectPaths(file: { storage_path: string | null; thumb_path?: string | null }): string[] {
  if (!file.storage_path) return file.thumb_path ? [file.thumb_path] : []
  return [...new Set([file.storage_path, file.thumb_path || patientFileThumbPath(file.storage_path)])]
}

export interface PatientStorageRefs {
  files: { storage_path: string | null; thumb_path?: string | null }[]
  /** patients.photo_storage_path */
  photo: string | null
  /** posture_assessments.views of each assessment: { front: { photo }, ... } */
  postureViews: unknown[]
}

/**
 * Every object a patient's ROWS point at, by bucket -- read before the
 * patient is deleted, because the rows cascade and take the paths with them.
 *
 * Only paths inside the account's own folder are returned: a path is data,
 * and a wrong one must not be able to reach another clinic's files.
 */
export function collectPatientStoragePaths(accountId: string, refs: PatientStorageRefs): { 'patient-files': string[]; 'patient-photos': string[] } {
  const files = new Set<string>()
  for (const f of refs.files) for (const p of patientFileObjectPaths(f)) files.add(p)
  for (const views of refs.postureViews) {
    if (!views || typeof views !== 'object') continue
    const photos = Object.values(views as Record<string, unknown>)
      .map((v) => (v && typeof v === 'object' ? (v as { photo?: unknown }).photo : null))
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
    for (const p of photos) files.add(p)
    // The report built from them, if one ever was (posture/[id]/report).
    if (photos[0]) files.add(photos[0].replace(/[^/]+$/, 'informe.pdf'))
  }
  const own = (p: string) => p.startsWith(`${accountId}/`) && !p.includes('/../')
  return {
    'patient-files': [...files].filter(own),
    'patient-photos': refs.photo && own(refs.photo) ? [refs.photo] : [],
  }
}
