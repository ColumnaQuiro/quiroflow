// The clinic's own look (composables/useClinicBrand.ts), from the first
// paint: what this phone drew with last time is put back before anything
// renders, so a patient never sees the app open in QuiroFlow's indigo and
// turn their clinic's green a moment later.
//
// Then it is asked again, on launch and whenever the signed-in person
// changes, by the join code the device holds. A phone with no code is a
// staff phone (mobile/pages/join.vue), and gets QuiroFlow's look without a
// request being spent on it.
export default defineNuxtPlugin(() => {
  const brand = useClinicBrand()
  brand.restore()
  const user = useSupabaseUser()
  watch(
    () => user.value?.sub ?? user.value?.id ?? '',
    () => {
      const slug = localStorage.getItem('clinic_slug')
      if (slug) brand.load(slug)
      else brand.clear()
    },
    { immediate: true },
  )
})
