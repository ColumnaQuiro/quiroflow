import { PRODUCT_NEWS, unreadNews } from '../utils/productNews'

// Which Novedades a person has not seen yet, for the dot and count on the
// top bar's button.
//
// Kept on the login itself (auth user_metadata.news_seen_at), not on
// team_members: it is one person's, it should follow them from the front-desk
// iPad to their laptop, and team_members is guarded column by column
// (20260925073743_team_members_write_guard) and audited, where a timestamp
// written on every visit would only add noise. What is stored is the date of
// the newest entry they have seen, so the comparison is between two of the
// file's own dates and the clinic's clock never enters into it.
export function useProductNews() {
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()
  // The JWT's claims carry user_metadata only as of when it was issued, so
  // once marked seen this is the truth for the rest of the visit.
  const seenUpTo = useState<string | null | undefined>('product-news-seen-up-to', () => undefined)
  const seen = computed(() => {
    if (seenUpTo.value !== undefined) return seenUpTo.value
    const meta = user.value?.user_metadata as { news_seen_at?: string } | undefined
    return meta?.news_seen_at ?? null
  })

  const today = new Date().toISOString().slice(0, 10)
  const unread = computed(() => unreadNews(PRODUCT_NEWS, seen.value, today))
  const unreadIds = computed(() => new Set(unread.value.map((e) => e.id)))

  async function markSeen() {
    const newest = PRODUCT_NEWS[0]?.date
    if (!newest || (seen.value && seen.value >= newest)) return
    seenUpTo.value = newest
    const { error } = await supabase.auth.updateUser({ data: { news_seen_at: newest } })
    // A fresh token carries the new metadata, so a reload does not bring the
    // dot back until the old one expires.
    if (!error) await supabase.auth.refreshSession()
  }

  return { entries: PRODUCT_NEWS, unread, unreadIds, markSeen }
}
