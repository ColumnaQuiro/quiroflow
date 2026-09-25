<script setup lang="ts">
import type { ReceptionistType } from '~/composables/useGrowthReceptionist'

// Which appointment types the receptionist may offer.
//
// The column behind this existed from the start and nothing could set it, so
// every clinic has the empty list, which means "any active type" (see
// utils/receptionistTypes.ts for why it is not "none"). So the choice is
// stated as two modes rather than as a bare list of ticks: a list with every
// tick removed would save as empty and silently mean everything, the opposite
// of what unticking says. "Only these" therefore needs at least one.
//
// Local draft and one Save, rather than saving on each tick: each save is a
// different prompt for every reply drafted from then on, and three clicks in
// a row would be three.

const props = defineProps<{
  /** The clinic's active types, in its own order. */
  types: ReceptionistType[]
  /** As stored. May name archived types, which are never offered. */
  selectedIds: string[]
  /** What the drafts are given now, as the server computed it. */
  offered: ReceptionistType[]
  saving: boolean
  save: (ids: string[]) => Promise<boolean>
}>()

const t = useT()

type Mode = 'any' | 'only'
const mode = ref<Mode>('any')
const picked = ref<string[]>([])
const saveError = ref<string | null>(null)
const confirmWiden = ref(false)

const activeIds = computed(() => new Set(props.types.map((type) => type.id)))

function reset() {
  mode.value = props.selectedIds.length ? 'only' : 'any'
  // Archived ids are dropped from the draft: they cannot be offered, and the
  // server refuses to save them, so keeping them would make Save fail.
  picked.value = props.selectedIds.filter((id) => activeIds.value.has(id))
  saveError.value = null
}
watch(() => [props.selectedIds, props.types], reset, { immediate: true })

const storedAsDraft = computed(() => (props.selectedIds.length ? props.selectedIds.filter((id) => activeIds.value.has(id)) : []))
const draftIds = computed(() => (mode.value === 'any' ? [] : props.types.filter((type) => picked.value.includes(type.id)).map((type) => type.id)))
const dirty = computed(() => {
  if ((mode.value === 'any') !== (props.selectedIds.length === 0)) return true
  if (mode.value === 'any') return false
  // Compared as sets of active ids, so an archived id still stored does not
  // make an untouched editor look edited.
  const stored = new Set(storedAsDraft.value)
  return draftIds.value.length !== stored.size || draftIds.value.some((id) => !stored.has(id))
})
const needsOne = computed(() => mode.value === 'only' && draftIds.value.length === 0)
const archivedStored = computed(() => props.selectedIds.filter((id) => !activeIds.value.has(id)).length)

function toggle(id: string) {
  picked.value = picked.value.includes(id) ? picked.value.filter((x) => x !== id) : [...picked.value, id]
}

function onSave() {
  if (needsOne.value || !dirty.value) return
  // Going from a chosen list to "any" widens what goes to patients, which is
  // the one change here worth a second look.
  if (mode.value === 'any' && props.selectedIds.length) {
    confirmWiden.value = true
    return
  }
  commit()
}

async function commit() {
  confirmWiden.value = false
  saveError.value = null
  const ok = await props.save(draftIds.value)
  if (!ok) saveError.value = t('Not saved. The list is as it was.', 'No se ha guardado. La lista sigue como estaba.')
}

const modeClass = (value: Mode) =>
  mode.value === value
    ? 'border-brand-tintBorder bg-brand-tint text-brand-text'
    : 'border-line-control bg-surface text-ink-700 hover:bg-surface-subtle'
</script>

<template>
  <GrowthSettingCard id="bookable-types" :title="t('Appointment types it may offer', 'Tipos de cita que puede ofrecer')" class="scroll-mt-4">
    <div data-test="bookable-types">
      <p v-if="!types.length" class="text-[11.5px] leading-[1.5] text-ink-muted" data-test="bookable-types-none-active">
        {{ t('The clinic has no active appointment types, so there is nothing to offer.', 'La clínica no tiene tipos de cita activos, así que no hay nada que ofrecer.') }}
        <NuxtLink to="/settings/appointment-types" class="font-medium text-brand-text hover:underline">{{ t('Appointment types', 'Tipos de cita') }} →</NuxtLink>
      </p>

      <div v-else class="flex flex-col gap-2.5">
        <div role="radiogroup" :aria-label="t('Which types', 'Qué tipos')" class="grid gap-1.5 sm:grid-cols-2">
          <label class="flex min-h-9 touch:min-h-11 cursor-pointer items-center gap-2 rounded-ctl border px-3 text-[12px]" :class="modeClass('any')" data-test="bookable-mode-any">
            <input v-model="mode" type="radio" name="bookable-mode" value="any" class="accent-brand" :disabled="saving">
            <span>{{ t('Any active type', 'Cualquier tipo activo') }}</span>
          </label>
          <label class="flex min-h-9 touch:min-h-11 cursor-pointer items-center gap-2 rounded-ctl border px-3 text-[12px]" :class="modeClass('only')" data-test="bookable-mode-only">
            <input v-model="mode" type="radio" name="bookable-mode" value="only" class="accent-brand" :disabled="saving">
            <span>{{ t('Only the ones I choose', 'Solo los que elija') }}</span>
          </label>
        </div>

        <ul v-if="mode === 'only'" class="flex flex-col gap-1" data-test="bookable-type-list">
          <li v-for="type in types" :key="type.id">
            <label class="flex min-h-9 touch:min-h-11 cursor-pointer items-center gap-2.5 rounded-ctl border border-line bg-surface-subtle px-3 text-[12px] text-ink-700 hover:bg-surface" :data-test="`bookable-type-${type.id}`">
              <input type="checkbox" class="h-4 w-4 accent-brand" :checked="picked.includes(type.id)" :disabled="saving" @change="toggle(type.id)">
              <span class="min-w-0 flex-1 truncate">{{ type.name }}</span>
              <span class="shrink-0 text-[11px] text-ink-faint">{{ type.durationMinutes }} min</span>
            </label>
          </li>
        </ul>

        <p v-if="needsOne" class="text-[11px] leading-[1.5] text-warning-text" data-test="bookable-needs-one">
          {{ t('Choose at least one, or pick “Any active type”.', 'Elige al menos uno, o marca «Cualquier tipo activo».') }}
        </p>
        <p v-if="archivedStored && !dirty" class="text-[11px] leading-[1.5] text-ink-muted" data-test="bookable-archived-note">
          {{ archivedStored === 1
            ? t('1 type on this list is archived and is not offered.', '1 tipo de esta lista está archivado y no se ofrece.')
            : t(`${archivedStored} types on this list are archived and are not offered.`, `${archivedStored} tipos de esta lista están archivados y no se ofrecen.`) }}
        </p>

        <div v-if="dirty" class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="h-9 touch:h-11 rounded-ctl bg-brand px-4 text-[12.5px] font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
            :disabled="saving || needsOne"
            data-test="bookable-save"
            @click="onSave"
          >{{ saving ? t('Saving…', 'Guardando…') : t('Save types', 'Guardar tipos') }}</button>
          <button
            type="button"
            class="h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-4 text-[12.5px] font-medium text-ink-700 hover:bg-surface-subtle"
            :disabled="saving"
            data-test="bookable-discard"
            @click="reset"
          >{{ t('Discard', 'Descartar') }}</button>
        </div>
        <p v-if="saveError" role="alert" class="text-[11px] text-danger-text" data-test="bookable-error">{{ saveError }}</p>

        <!-- The server's own reading, the one the drafts get, rather than the
        ticks above: they differ while unsaved and when a chosen type has
        since been archived. -->
        <p class="border-t border-line-divider pt-2.5 text-[11px] leading-[1.5] text-ink-muted" data-test="offered-types">
          <template v-if="offered.length">
            {{ t('Offers now:', 'Ofrece ahora:') }} <span class="text-ink-700">{{ offered.map((type) => type.name).join(', ') }}</span>
          </template>
          <template v-else>{{ t('Offers no appointment type now, and hands booking to a colleague.', 'Ahora no ofrece ningún tipo de cita y pasa la reserva a un compañero.') }}</template>
        </p>
      </div>
    </div>

    <UiConfirmDialog
      v-if="confirmWiden"
      :title="t('Offer any active type?', '¿Ofrecer cualquier tipo activo?')"
      :confirm-label="t('Offer any type', 'Ofrecer cualquiera')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :busy="saving"
      @confirm="commit"
      @cancel="confirmWiden = false"
    >
      <p class="text-[13px] leading-relaxed text-ink-500">
        {{ t(
          `Replies drafted from now on may offer all ${types.length} active types, including any you add later — not only the ${storedAsDraft.length} chosen now.`,
          `Las respuestas redactadas a partir de ahora podrán ofrecer los ${types.length} tipos activos, incluidos los que añadas después, y no solo los ${storedAsDraft.length} elegidos ahora.`,
        ) }}
      </p>
    </UiConfirmDialog>
  </GrowthSettingCard>
</template>
