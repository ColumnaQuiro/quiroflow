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
  canImport?: boolean
}>()
const emit = defineEmits<{
  open: [id: string]
  create: []
  rename: [id: string]
  delete: [id: string]
  import: [id: string | null]
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

    <div class="overflow-hidden rounded-card border border-line bg-surface shadow-card">
      <div class="overflow-x-auto">
        <table class="w-full min-w-[640px] border-collapse text-[13px]">
          <caption class="sr-only">{{ kind === 'list' ? t('Lists', 'Listas') : t('Segments', 'Segmentos') }}</caption>
          <thead>
            <tr class="border-b border-line-row bg-surface-subtle2 text-[11px] font-[640] uppercase tracking-[.04em] text-ink-faint">
              <th scope="col" class="px-5 py-2.5 text-left">{{ t('Name', 'Nombre') }}</th>
              <th scope="col" class="w-[110px] px-3 py-2.5 text-right">{{ t('Patients', 'Pacientes') }}</th>
              <th v-if="kind === 'list'" scope="col" class="w-[190px] px-3 py-2.5 text-left">{{ t('Accept marketing', 'Aceptan publicidad') }}</th>
              <th scope="col" class="w-[200px] px-3 py-2.5"><span class="sr-only">{{ t('Actions', 'Acciones') }}</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loaded && rows.length === 0">
              <td :colspan="kind === 'list' ? 4 : 3" class="px-5 py-10 text-center text-[13px] text-ink-faint">
                {{ kind === 'list'
                  ? t('No lists yet. Create one, or select patients on the list and add them to a new one.', 'Todavía no hay listas. Crea una, o selecciona pacientes en la lista y añádelos a una nueva.')
                  : t('No segments yet. Filter the patient list and save it as a segment.', 'Todavía no hay segmentos. Filtra la lista de pacientes y guárdala como segmento.') }}
              </td>
            </tr>
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
                  <span v-if="!row.shared" class="shrink-0 rounded-pill bg-chip-bg2 px-1.5 py-0.5 text-[11px] font-[600] text-chip-text">{{ t('Private', 'Privado') }}</span>
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
