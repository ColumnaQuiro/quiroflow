<script setup lang="ts">
import type { Tables } from '~/types/database.types'

// Settings > Recalls: the reasons a patient can be recorded as having stopped
// care for (20261022171626). Offered when someone is dismissed from Recalls
// and on the patient's record, and counted in Reports > Retention.
//
// Seeded with six defaults per account. Deleting one is allowed: the stops
// recorded with it stay counted, under "No reason" -- said in the dialog
// before it happens, with how many there are.
//
// Above them, who a new recall is assigned to (SettingsRecallAssignee,
// 20261022185125).

type Reason = Tables<'care_stop_reasons'>

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

const reasons = ref<Reason[]>([])
const uses = ref<Record<string, number>>({})
const loading = ref(true)

async function load() {
  const { data } = await supabase.from('care_stop_reasons').select('*').order('sort_order').order('name')
  reasons.value = data ?? []
  loading.value = false
  const counts = await Promise.all(reasons.value.map((r) => supabase.from('patient_care_stops').select('id', { count: 'exact', head: true }).eq('reason_id', r.id)))
  uses.value = Object.fromEntries(reasons.value.map((r, i) => [r.id, counts[i].count ?? 0]))
}
onMounted(load)

function usesLabel(id: string) {
  const n = uses.value[id]
  if (n === undefined) return ''
  if (n === 0) return t('Not used yet', 'Aún sin usar')
  return n === 1 ? t('1 patient', '1 paciente') : t(`${n} patients`, `${n} pacientes`)
}

const nameTaken = (name: string, except?: string) => reasons.value.some((r) => r.id !== except && r.name.toLowerCase() === name.toLowerCase())

const newReason = ref('')
const adding = ref(false)
const reasonError = ref('')
async function addReason() {
  reasonError.value = ''
  const name = newReason.value.trim()
  if (!name) return
  if (nameTaken(name)) {
    reasonError.value = t('There is already a reason with that name.', 'Ya hay un motivo con ese nombre.')
    return
  }
  adding.value = true
  const sortOrder = Math.max(0, ...reasons.value.map((r) => r.sort_order)) + 10
  const { error } = await supabase.from('care_stop_reasons').insert({ account_id: store.accountId!, name, sort_order: sortOrder })
  adding.value = false
  if (error) {
    reasonError.value = error.message
    return
  }
  newReason.value = ''
  await load()
}

const renamingId = ref<string | null>(null)
const renameValue = ref('')
function startRename(r: Reason) {
  renamingId.value = r.id
  renameValue.value = r.name
}
async function saveRename(r: Reason) {
  const name = renameValue.value.trim()
  if (!name || name === r.name) {
    renamingId.value = null
    return
  }
  if (nameTaken(name, r.id)) {
    showToast(t('There is already a reason with that name.', 'Ya hay un motivo con ese nombre.'), 'error')
    return
  }
  const { error } = await supabase.from('care_stop_reasons').update({ name }).eq('id', r.id)
  if (error) {
    showToast(error.message, 'error')
    return
  }
  r.name = name
  renamingId.value = null
}

// Up or down one place: the order is the order Recalls and the record offer them in.
async function move(index: number, by: -1 | 1) {
  const target = index + by
  if (target < 0 || target >= reasons.value.length) return
  const list = [...reasons.value]
  const [moved] = list.splice(index, 1)
  list.splice(target, 0, moved!)
  // Renumbered 10, 20, 30...: only the rows whose number changes are written.
  const changed = list.flatMap((r, i) => (r.sort_order === (i + 1) * 10 ? [] : [{ id: r.id, sort_order: (i + 1) * 10 }]))
  reasons.value = list.map((r, i) => ({ ...r, sort_order: (i + 1) * 10 }))
  const results = await Promise.all(changed.map((u) => supabase.from('care_stop_reasons').update({ sort_order: u.sort_order }).eq('id', u.id)))
  const failed = results.find((r) => r.error)
  if (failed?.error) {
    showToast(failed.error.message, 'error')
    await load()
  }
}

const deleting = ref<Reason | null>(null)
async function confirmDelete() {
  if (!deleting.value) return
  const { error } = await supabase.from('care_stop_reasons').delete().eq('id', deleting.value.id)
  if (error) {
    showToast(error.message, 'error')
    return
  }
  deleting.value = null
  await load()
}

const inputClass = 'h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
const iconBtn = 'flex h-9 w-9 touch:h-11 touch:w-11 shrink-0 items-center justify-center rounded-ctl text-ink-muted hover:bg-surface-subtle hover:text-ink-700 disabled:opacity-30'
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Recalls', 'Recordatorios')" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-4 pb-24 sm:px-6 sm:pt-6 lg:pb-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[820px] flex-1 flex-col gap-4" data-cy="care-stop-settings" :data-ready="loading ? undefined : 'true'">
          <SettingsRecallAssignee />

          <p class="text-[13.5px] text-ink-muted">
            {{ t('Why patients stop coming. Pick one when you dismiss someone from Recalls, or on their record, and Reports › Retention counts them.', 'Por qué dejan de venir los pacientes. Se elige al descartar a alguien en Recordatorios, o en su ficha, y Informes › Retención los cuenta.') }}
          </p>

          <section aria-labelledby="h-stop-reasons" class="overflow-hidden rounded-card border border-line bg-surface">
            <div class="px-[18px] pb-3 pt-4">
              <h2 id="h-stop-reasons" class="text-[16px] font-bold text-ink-900">{{ t(`Reasons for stopping care · ${reasons.length}`, `Motivos de baja · ${reasons.length}`) }}</h2>
              <p class="mt-1 text-[13px] text-ink-muted">{{ t('Record one only when the patient has told you. The order here is the order they are offered in.', 'Regístralo solo cuando el paciente te lo haya dicho. El orden de aquí es el orden en que se ofrecen.') }}</p>
            </div>
            <template v-if="loading">
              <div v-for="i in 4" :key="i" class="flex items-center gap-4 border-t border-line-row px-[18px] py-4"><UiSkeleton class="h-4 w-40 rounded-ctlSm" /></div>
            </template>
            <p v-else-if="reasons.length === 0" class="border-t border-line-row px-[18px] py-6 text-center text-[14px] text-ink-muted">
              {{ t('No reasons yet. Add the first one below.', 'Aún no hay motivos. Añade el primero abajo.') }}
            </p>
            <div v-for="(r, i) in reasons" :key="r.id" data-cy="stop-reason-row" class="flex min-h-[56px] items-center gap-2 border-t border-line-row py-1.5 pl-[18px] pr-3">
              <form v-if="renamingId === r.id" class="flex min-w-0 flex-1 items-center gap-2" @submit.prevent="saveRename(r)">
                <input v-model="renameValue" data-cy="stop-reason-rename" type="text" maxlength="60" :aria-label="t('Reason', 'Motivo')" :class="[inputClass, 'min-w-0 flex-1']" @keydown.esc="renamingId = null" />
                <UiBtn variant="ghost" @click="renamingId = null">{{ t('Cancel', 'Cancelar') }}</UiBtn>
                <UiBtn variant="primary" type="submit">{{ t('Save', 'Guardar') }}</UiBtn>
              </form>
              <template v-else>
                <strong class="min-w-0 flex-1 truncate text-[15px] text-ink-900" data-cy="stop-reason-name">{{ r.name }}</strong>
                <span class="mr-2 text-[13px] text-ink-500 max-sm:hidden">{{ usesLabel(r.id) }}</span>
                <button type="button" :class="iconBtn" :disabled="i === 0" :aria-label="t(`Move ${r.name} up`, `Subir ${r.name}`)" @click="move(i, -1)">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
                </button>
                <button type="button" :class="iconBtn" :disabled="i === reasons.length - 1" :aria-label="t(`Move ${r.name} down`, `Bajar ${r.name}`)" @click="move(i, 1)">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                </button>
                <button type="button" :class="iconBtn" :aria-label="t(`Rename ${r.name}`, `Renombrar ${r.name}`)" @click="startRename(r)">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" /></svg>
                </button>
                <button type="button" data-cy="stop-reason-delete" :class="iconBtn" :aria-label="t(`Delete ${r.name}`, `Eliminar ${r.name}`)" @click="deleting = r">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
                </button>
              </template>
            </div>
            <form class="flex flex-wrap items-center gap-2.5 border-t border-line-row bg-surface-subtle px-[18px] py-3" @submit.prevent="addReason">
              <input
                v-model="newReason"
                data-cy="stop-reason-new-name"
                type="text"
                maxlength="60"
                :placeholder="t('Add a reason, e.g. Pregnancy', 'Añade un motivo, ej. Embarazo')"
                :aria-label="t('New reason', 'Nuevo motivo')"
                :class="[inputClass, 'min-w-0 flex-1']"
              />
              <UiBtn type="submit" data-cy="stop-reason-new-save" :disabled="adding || !newReason.trim()">{{ adding ? t('Adding…', 'Añadiendo…') : t('Add', 'Añadir') }}</UiBtn>
              <p v-if="reasonError" class="w-full text-[12.5px] font-semibold text-danger-text">{{ reasonError }}</p>
            </form>
          </section>
        </div>
      </div>
    </div>

    <UiConfirmDialog
      v-if="deleting"
      tone="danger"
      :title="t(`Delete “${deleting.name}”?`, `¿Eliminar «${deleting.name}»?`)"
      :confirm-label="t('Delete reason', 'Eliminar motivo')"
      :cancel-label="t('Cancel', 'Cancelar')"
      @confirm="confirmDelete"
      @cancel="deleting = null"
    >
      <p class="text-[14px] leading-snug text-ink-700">
        <template v-if="uses[deleting.id]">{{ t(`${uses[deleting.id]} recorded with it stay in the reports, as "No reason". It stops being offered from now on.`, `Los ${uses[deleting.id]} registrados con él siguen en los informes, como «Sin motivo». Deja de ofrecerse a partir de ahora.`) }}</template>
        <template v-else>{{ t('Nobody has been recorded with it. It stops being offered from now on.', 'Nadie tiene este motivo. Deja de ofrecerse a partir de ahora.') }}</template>
      </p>
    </UiConfirmDialog>
  </div>
</template>
