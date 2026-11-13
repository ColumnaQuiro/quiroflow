// The back plane follows the clinic's colour on the patient side
// (utils/planePalette.ts). Runs after plugins/brand.client.ts, which has
// already put back the colour this phone saw last time, so the plane opens in
// the clinic's shade with no flash of indigo.
//
// useClinicBrand().brand is null on the staff side (layouts/practitioner.vue
// hides it) and for a clinic with no colour: the stylesheet is then removed
// and assets/css/main.css's indigo applies.
const STYLE_ID = 'clinic-plane-colours'

export default defineNuxtPlugin(() => {
  const { brand } = useClinicBrand()
  watch(
    () => brand.value?.color ?? null,
    (color) => {
      const css = planeCss(color)
      let tag = document.getElementById(STYLE_ID)
      if (!css) {
        tag?.remove()
        return
      }
      if (!tag) {
        tag = document.createElement('style')
        tag.id = STYLE_ID
        document.head.appendChild(tag)
      }
      if (tag.textContent !== css) tag.textContent = css
    },
    { immediate: true },
  )
})
