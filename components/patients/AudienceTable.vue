<script setup lang="ts">
// The Lists tab and the Segments tab: every list (or segment) the person can
// see, how many patients it holds now, and what can be done with it.
// Opening one shows its members in the patient list, where they can be
// filtered, exported and selected like anyone else.
export interface AudienceRow {
  id: string
  name: string
  shared: boolean
  /** A segment's rules, a list's description. */
  detail: string
  count: number | undefined
  /** How many of them accept marketing by email / WhatsApp (lists). */
  email?: number
  whatsapp?: number
  manageable: boolean
}

defineProps<{
  kind: 'list' | 'segment'
  rows: AudienceRow[]
  loaded: boolean
  counting: boolean
  /** The lists (or segments) themselves could not be read. */
  failed?: boolean
  canImport?: boolean
}>()
const emit = defineEmits<{
  open: [id: string]
  create: []
  rename: [id: string]
  delete: [id: string]
  import: [id: string | null]
  retry: []
}>()
const t = useT()
</script>

<template>
  <section :data-cy="`${kind}-table`" class="mt-4">
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <p class="mr-auto max-w-[640px] text-[12.5px] leading-snug text-ink-muted">
        <template v-if="kind === 'list'">
          {{ t('People you put on a list stay on it until you take them off. Add them from a selection on the patient list, or import a file straight into one.', 'Quien añades a una lista sigue en ella hasta que lo quitas. Añádelos seleccionándolos en la lista de pacientes o importa un archivo directamente.') }}
        </template>
        <template v-else>
          {{ t('A segment is a saved filter: whoever matches its rules is in it, and it updates by itself as their details change.', 'Un segmento es un filtro guardado: quien cumple sus reglas está dentro, y se actualiza solo a medida que cambian sus datos.') }}
        </template>
      </p>
      <UiBtn v-if="kind === 'list' && canImport" variant="secondary" size="sm" data-cy="list-import" @click="emit('import', null)">
        {{ t('Import into a list', 'Importar a una lista') }}
      </UiBtn>
      <UiBtn variant="primary" size="sm" :data-cy="`${kind}-create`" @click="emit('create')">
        {{ kind === 'list' ? t('New list', 'Nueva lista') : t('New segment', 'Nuevo segmento') }}
      </UiBtn>
    </div>

    <!-- Outside the table, which is 640px and scrolls sideways on a phone:
    a centred row put the sentence past the right edge of the screen. -->
    <UiEmptyState
      v-if="failed && !loaded"
      :data-cy="`${kind}-load-failed`"
      :title="kind === 'list' ? t('The lists could not be loaded', 'No se han podido cargar las listas') : t('The segments could not be loaded', 'No se han podido cargar los segmentos')"
      :description="t('Check the connection and try again.', 'Comprueba la conexión y vuelve a intentarlo.')"
      class="!px-0 !py-0"
    >
      <template #icon>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
      </template>
      <template #actions>
        <UiBtn @click="emit('retry')">{{ t('Try again', 'Reintentar') }}</UiBtn>
      </template>
    </UiEmptyState>

    <UiEmptyState
      v-else-if="loaded && rows.length === 0"
      :data-cy="`${kind}-empty`"
      :title="kind === 'list' ? t('No lists yet', 'Todavía no hay listas') : t('No segments yet', 'Todavía no hay segmentos')"
      :description="kind === 'list'
        ? t('Create one, or select patients on the list and add them to a new one.', 'Crea una, o selecciona pacientes en la lista y añádelos a una nueva.')
        : t('Filter the patient list and save it as a segment.', 'Filtra la lista de pacientes y guárdala como segmento.')"
      class="!px-0 !py-0"
    >
      <template #icon>
        <svg v-if="kind === 'list'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
        </svg>
        <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
        </svg>
      </template>
    </UiEmptyState>

    <div v-else class="overflow-hidden rounded-card border border-line bg-surface shadow-card" :aria-busy="!loaded">
      <div class="overflow-x-auto">
        <table class="w-full min-w-[640px] border-collapse text-[13px]">
          <caption class="sr-only">{{ kind === 'list' ? t('Lists', 'Listas') : t('Segments', 'Segmentos') }}</caption>
          <thead>
            <tr class="border-b border-line-row bg-surface-subtle2 text-[11px] font-[640] uppercase tracking-[.07em] text-ink-faint">
              <th scope="col" class="px-5 py-2.5 text-left">{{ t('Name', 'Nombre') }}</th>
              <th scope="col" class="w-[110px] px-3 py-2.5 text-right">{{ t('Patients', 'Pacientes') }}</th>
              <th v-if="kind === 'list'" scope="col" class="w-[190px] px-3 py-2.5 text-left">{{ t('Accept marketing', 'Aceptan publicidad') }}</th>
              <th scope="col" class="w-[200px] px-3 py-2.5"><span class="sr-only">{{ t('Actions', 'Acciones') }}</span></th>
            </tr>
          </thead>
          <tbody>
            <!-- Until the lists arrive: an empty table under its header read
            as "there are none" for the second it took. -->
            <template v-if="!loaded">
              <tr v-for="row in 3" :key="`skeleton-${row}`" class="border-b border-line-row last:border-b-0">
                <td class="px-5 py-3"><UiSkeleton class="h-3 w-40 rounded-ctlSm" /></td>
                <td class="px-3 py-3"><UiSkeleton class="ml-auto h-3 w-8 rounded-ctlSm" /></td>
                <td v-if="kind === 'list'" class="px-3 py-3"><UiSkeleton class="h-3 w-28 rounded-ctlSm" /></td>
                <td class="px-3 py-3" />
              </tr>
            </template>
            <tr
              v-for="row in rows"
              :key="row.id"
              :data-cy="`${kind}-row`"
              class="cursor-pointer border-b border-line-row last:border-b-0 hover:bg-surface-subtle"
              @click="emit('open', row.id)"
            >
              <td class="px-5 py-2.5">
                <p class="flex items-center gap-1.5 text-[13.5px] font-[560] text-ink-900">
                  <button type="button" :data-cy="`${kind}-open`" class="truncate text-left outline-none hover:underline focus-visible:shadow-focus" @click.stop="emit('open', row.id)">
                    {{ row.name }}
                  </button>
                  <UiPill v-if="!row.shared" class="shrink-0">{{ t('Private', 'Privado') }}</UiPill>
                </p>
                <p v-if="row.detail" class="truncate text-[11.5px] text-ink-muted2">{{ row.detail }}</p>
              </td>
              <td class="px-3 py-2.5 text-right">
                <span :data-cy="`${kind}-count`" class="font-mono text-[12.5px] text-ink-700 transition-opacity" :class="counting ? 'opacity-50' : ''">{{ row.count ?? '…' }}</span>
              </td>
              <td v-if="kind === 'list'" class="px-3 py-2.5 text-[12px] text-ink-muted">
                <template v-if="row.count !== undefined">
                  <span data-cy="list-email-count">{{ row.email ?? 0 }}</span> {{ t('email', 'correo') }}
                  · <span data-cy="list-whatsapp-count">{{ row.whatsapp ?? 0 }}</span> WhatsApp
                </template>
              </td>
              <td class="px-3 py-2.5 text-right" @click.stop>
                <div v-if="row.manageable" class="flex items-center justify-end gap-1">
                  <UiBtn v-if="kind === 'list' && canImport" variant="ghost" size="sm" data-cy="list-row-import" @click="emit('import', row.id)">{{ t('Import', 'Importar') }}</UiBtn>
                  <UiBtn variant="ghost" size="sm" :data-cy="`${kind}-row-rename`" @click="emit('rename', row.id)">{{ t('Rename', 'Renombrar') }}</UiBtn>
                  <UiBtn variant="ghost" size="sm" :data-cy="`${kind}-row-delete`" @click="emit('delete', row.id)">{{ t('Delete', 'Eliminar') }}</UiBtn>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
