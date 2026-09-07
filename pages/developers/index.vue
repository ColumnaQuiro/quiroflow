<script setup lang="ts">
// /developers on the app host is the section root and has no content of its
// own -- the first real page is Introduction. On the docs subdomain this
// route is never reached: "/" there is redirected straight to /introduction
// by middleware/account.global.ts.
definePageMeta({ layout: false })
const { link } = useDevPortal()
await navigateTo(link('introduction'), { replace: true })
</script>

<template>
  <div />
</template>
