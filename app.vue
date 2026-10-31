<script setup lang="ts">
const t = useT()
const { preference } = useLang()
const route = useRoute()
// <html lang> was never set, so a screen reader read the Spanish interface
// with an English voice. It follows the interface language; a page in its
// own language (the booking page) sets its own, and that one wins. So does
// a page's own title over the screen's name (utils/screenTitle.ts).
useHead({
  htmlAttrs: { lang: () => preference.value },
  title: () => screenTitle(route.path, t),
})
</script>

<template>
  <div>
    <NuxtRouteAnnouncer />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <UiToastContainer />
  </div>
</template>
