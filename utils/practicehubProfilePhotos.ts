// A patient's profile photo, from PracticeHub's patient list.
//
// GET /api/patients carries `profile_image` on every patient: a pre-signed S3
// link like the ones /api/files hands out, or null. No import step read it,
// so every clinic that moved over arrived with initials where its photos had
// been -- 172 of 1,535 patients on the account this was measured against.
//
// The link is to whatever was uploaded as the photo, which is not always a
// picture: one of those 172 is a 2 MB PDF, served as application/pdf. So the
// bytes decide, not the link and not the Content-Type S3 reports.

export interface PracticeHubPhotoSource {
  id: number
  patient_number: string | number | null
  profile_image?: string | null
}

export interface PhotoTargetPatient {
  id: string
  external_reference: string | null
  photo_storage_path: string | null
}

export interface ProfilePhotoPlan {
  /** Photos to fetch, each for a patient here that has none. */
  queue: { phPatientId: number; patientId: string; url: string }[]
  /** Patients with a photo in PracticeHub who already have one here. */
  alreadyHere: number
}

/**
 * Which profile photos to bring over. A patient who already has a photo here
 * is left alone, whether it came from an earlier run or was taken in
 * QuiroFlow since: the newer picture is the one reception chose.
 */
export function planProfilePhotos(phPatients: PracticeHubPhotoSource[], ourPatients: PhotoTargetPatient[]): ProfilePhotoPlan {
  const byNumber = new Map<string, PhotoTargetPatient>()
  for (const p of ourPatients) {
    const ref = String(p.external_reference ?? '').trim()
    if (ref) byNumber.set(ref, p)
  }

  const plan: ProfilePhotoPlan = { queue: [], alreadyHere: 0 }
  for (const ph of phPatients) {
    const url = typeof ph.profile_image === 'string' ? ph.profile_image.trim() : ''
    if (!url) continue
    const ours = byNumber.get(String(ph.patient_number ?? '').trim())
    if (!ours) continue
    if (ours.photo_storage_path) plan.alreadyHere++
    else plan.queue.push({ phPatientId: ph.id, patientId: ours.id, url })
  }
  return plan
}

/** The image type the bytes start as, or null when they are not a picture a browser shows. */
export function sniffImageType(bytes: Uint8Array): { contentType: string; extension: string } | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b)
  if (starts(0xff, 0xd8, 0xff)) return { contentType: 'image/jpeg', extension: 'jpg' }
  if (starts(0x89, 0x50, 0x4e, 0x47)) return { contentType: 'image/png', extension: 'png' }
  if (starts(0x47, 0x49, 0x46, 0x38)) return { contentType: 'image/gif', extension: 'gif' }
  // RIFF....WEBP
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return { contentType: 'image/webp', extension: 'webp' }
  }
  return null
}

/**
 * Where an imported photo is stored. One fixed name per patient, so a retry
 * writes the same object again instead of leaving the first attempt behind.
 */
export function practiceHubPhotoPath(accountId: string, patientId: string, extension: string): string {
  return `${accountId}/${patientId}/practicehub.${extension}`
}
