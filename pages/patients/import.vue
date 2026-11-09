<script setup lang="ts">
// Import contacts straight into a list, from Patients > Lists: the "Other
// system" importer of Settings > Import, opened with the list chosen. Gated
// like that page (data_admin, utils/routePermissions.ts), because it creates
// patient records in bulk; the list is only where they land.
const route = useRoute()
const t = useT()
const listId = computed(() => (typeof route.query.list === 'string' ? route.query.list : null))
// Its own tab title: utils/screenTitle.ts reads /patients/<anything> as a
// patient's record, so this page was announced and listed as "Patient".
useHead({ title: () => `${t('Import into a list', 'Importar a una lista')} · QuiroFlow` })
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Import into a list', 'Importar a una lista')">
      <UiBtn variant="secondary" @click="navigateTo({ path: '/patients', query: { view: 'lists' } })">{{ t('Back to lists', 'Volver a las listas') }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto bg-surface-page px-4 pb-10 pt-[18px] sm:px-6">
      <div class="mx-auto max-w-[880px]">
        <ImportGenericCsvPatientsImporter :initial-list-id="listId" />
      </div>
    </div>
  </div>
</template>
