// A reactive `window.matchMedia(query).matches`. False during SSR and until
// mount, so a server-rendered page starts in its wide layout and switches
// once the browser says otherwise.
export function useMediaQuery(query: string) {
  const matches = ref(false)
  let mql: MediaQueryList | null = null
  const update = () => (matches.value = !!mql?.matches)
  onMounted(() => {
    mql = window.matchMedia(query)
    update()
    mql.addEventListener('change', update)
  })
  onBeforeUnmount(() => mql?.removeEventListener('change', update))
  return matches
}
