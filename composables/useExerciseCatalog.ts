// QuiroFlow's starter exercises (utils/exerciseCatalog.ts) as a clinic uses
// them: where their demonstration videos are, and adding one -- or a whole
// starter programme -- to the clinic's own library. Adding is an ordinary
// insert into `exercises` under the staff member's RLS, with starter_key
// set; see the exercise_catalogue migration.
import { EXERCISE_CATALOG_PROGRAMS, exerciseCatalogItem, exerciseCatalogMediaPaths, type CatalogExercise } from '../utils/exerciseCatalog'

export function useExerciseCatalog() {
  const supabase = useSupabaseClient()
  const t = useT()
  // The videos are static files of the web app: same origin on the web, and
  // the web app's address in the mobile app (whose own bundle lacks them).
  const base = String((useRuntimeConfig().public as { apiBase?: string }).apiBase ?? '').replace(/\/$/, '')

  function media(slug: string) {
    const p = exerciseCatalogMediaPaths(slug)
    return { video: base + p.video, poster: base + p.poster }
  }

  /** The catalogue's usual dose, in the viewer's language. */
  function dose(item: CatalogExercise) {
    return { sets: item.sets, reps: t(item.reps.en, item.reps.es), frequency: t(item.frequency.en, item.frequency.es) }
  }

  async function findCopy(accountId: string, slug: string) {
    const { data } = await supabase.from('exercises').select('id, archived_at').eq('account_id', accountId).eq('starter_key', slug).maybeSingle()
    return data as { id: string; archived_at: string | null } | null
  }

  /**
   * The clinic's copy of a catalogue exercise, made now if it has none. One
   * it archived is restored rather than duplicated. Its id, or null.
   */
  async function addToLibrary(accountId: string, slug: string, teamMemberId: string | null | undefined): Promise<string | null> {
    const item = exerciseCatalogItem(slug)
    if (!item) return null
    const existing = await findCopy(accountId, slug)
    if (existing) {
      if (existing.archived_at) {
        const { error } = await supabase.from('exercises').update({ archived_at: null } as never).eq('id', existing.id)
        if (error) return null
      }
      return existing.id
    }
    const { data, error } = await supabase
      .from('exercises')
      .insert({
        account_id: accountId,
        name: t(item.name.en, item.name.es),
        instructions: t(item.instructions.en, item.instructions.es),
        starter_key: slug,
        created_by: teamMemberId ?? null,
      } as never)
      .select('id')
      .single()
    // Someone else added it a moment ago (the unique index): use theirs.
    if (error) return (await findCopy(accountId, slug))?.id ?? null
    return (data as { id: string }).id
  }

  /**
   * Adds a starter programme to the clinic's programmes, adding its exercises
   * to the library first. 'exists' when the clinic already has a programme of
   * that name.
   */
  async function addProgram(accountId: string, programSlug: string, teamMemberId: string | null | undefined): Promise<{ id: string } | { error: 'exists' | 'failed' }> {
    const program = EXERCISE_CATALOG_PROGRAMS.find((p) => p.slug === programSlug)
    if (!program) return { error: 'failed' }
    const name = t(program.name.en, program.name.es)
    const { data: same } = await supabase.from('exercise_programs').select('id').eq('account_id', accountId).ilike('name', name).limit(1)
    if (same?.length) return { error: 'exists' }
    const items = []
    for (const slug of program.items) {
      const id = await addToLibrary(accountId, slug, teamMemberId)
      const item = exerciseCatalogItem(slug)
      if (!id || !item) return { error: 'failed' }
      items.push({ exercise_id: id, ...dose(item), notes: null })
    }
    const { data, error } = await supabase.rpc('save_exercise_program', {
      p_account_id: accountId,
      p_program_id: null,
      p_name: name,
      p_description: t(program.description.en, program.description.es),
      p_items: items,
    } as never)
    if (error || !data) return { error: 'failed' }
    return { id: data as unknown as string }
  }

  return { media, dose, addToLibrary, addProgram }
}
