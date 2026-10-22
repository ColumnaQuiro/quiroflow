<script setup lang="ts">
// Settings > Recalls: how the Recalls list is worked. For now, who a new
// recall is assigned to (SettingsRecallAssignee).

const t = useT()
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Recalls', 'Recordatorios')" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-4 pb-24 sm:px-6 sm:pt-6 lg:pb-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[820px] flex-1 flex-col gap-4">
          <SettingsRecallAssignee />
        </div>
      </div>
    </div>
  </div>
</template>
