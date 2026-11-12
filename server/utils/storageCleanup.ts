import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../types/database.types'

// Removing Storage objects after the rows that named them are gone.
//
// Always AFTER, and never able to fail the operation it follows: a patient
// that was deleted stays deleted whether or not Storage answered. What could
// not be removed is logged with its paths, so it can be removed by hand, and
// /api/internal/storage-orphans will count it.

const CHUNK = 100

/** Removes `paths` from `bucket`. Never throws; says how many went and which did not. */
export async function removeStorageObjects(service: SupabaseClient<Database>, bucket: string, paths: string[], context: string): Promise<{ removed: number; failed: string[] }> {
  const unique = [...new Set(paths.filter(Boolean))]
  let removed = 0
  const failed: string[] = []
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK)
    try {
      const { data, error } = await service.storage.from(bucket).remove(chunk)
      if (error) throw error
      // A path with no object behind it (a thumbnail that was never made) is
      // simply not in `data`; that is not a failure.
      removed += data?.length ?? 0
    } catch (e) {
      failed.push(...chunk)
      console.error(`[storage-cleanup] ${context}: could not remove ${chunk.length} object(s) from ${bucket}`, chunk, e)
    }
  }
  return { removed, failed }
}

/** The objects directly inside one folder, as full paths. Empty when it cannot be listed. */
export async function listStorageFolder(service: SupabaseClient<Database>, bucket: string, folder: string): Promise<string[]> {
  try {
    const { data, error } = await service.storage.from(bucket).list(folder, { limit: 1000 })
    if (error) throw error
    // A sub-folder comes back as an entry with no id; only objects are wanted.
    return (data ?? []).filter((o) => o.id).map((o) => `${folder}/${o.name}`)
  } catch (e) {
    console.error(`[storage-cleanup] could not list ${bucket}/${folder}`, e)
    return []
  }
}
