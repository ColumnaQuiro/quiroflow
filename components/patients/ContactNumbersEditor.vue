<script setup lang="ts">
import type { Tables } from '~/types/database.types'
import { splitDialPrefix } from '~/utils/phone'

const props = withDefaults(defineProps<{ patientId: string; editable?: boolean }>(), { editable: false })

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const numbers = ref<Tables<'patient_contact_numbers'>[]>([])
const loading = ref(true)

const newCountry = ref(store.defaultPhoneCountry)
const newNumber = ref('')
const newIsWhatsapp = ref(false)
const adding = ref(false)

const { phoneProblem } = usePhoneValidation()
const addError = ref('')
// Per row, because these fields commit on blur one at a time and a message
// has to belong to the number it is about.
const rowError = ref<Record<string, string>>({})
// Cleared as soon as the number changes, so the message is about what is in
// the field now rather than about the last thing Add was pressed on.
watch([newNumber, newCountry], () => {
  addError.value = ''
})

async function load() {
  loading.value = true
  const { data } = await supabase
    .from('patient_contact_numbers')
    .select('*')
    .eq('patient_id', props.patientId)
    .order('created_at')
  numbers.value = data ?? []
  loading.value = false
}
onMounted(load)

async function addNumber() {
  if (!newNumber.value.trim()) return
  addError.value = phoneProblem(newNumber.value, newCountry.value)
  if (addError.value) return
  adding.value = true
  // A typed "+34 600…" wins over the dropdown, so the prefix isn't stored
  // twice -- once in the number and again as the country code.
  const { countryCode, number } = splitDialPrefix(newNumber.value, newCountry.value)
  await supabase.from('patient_contact_numbers').insert({
    account_id: store.accountId!,
    patient_id: props.patientId,
    country_code: countryCode,
    number,
    is_whatsapp: newIsWhatsapp.value,
  })
  newNumber.value = ''
  newIsWhatsapp.value = false
  adding.value = false
  await load()
}

async function removeNumber(id: string) {
  await supabase.from('patient_contact_numbers').delete().eq('id', id)
  await load()
}

// Edits persist immediately (no outer Save button for this widget -- see the
// comment where it's embedded in OverviewTab.vue), so each field commits on
// its own change/blur rather than waiting on a submit action.
async function updateNumber(n: Tables<'patient_contact_numbers'>, patch: Partial<Pick<Tables<'patient_contact_numbers'>, 'country_code' | 'number' | 'is_whatsapp'>>) {
  // Only when the number itself changed. Rows already in the database can
  // hold a number this rule would refuse -- production has three, one of them
  // a single digit -- and checking on every blur would flag a row nobody
  // touched, while checking on a WhatsApp toggle or a country change would
  // make those rows uneditable rather than fixable.
  if (patch.number !== undefined && patch.number !== n.number) {
    const problem = !patch.number.trim()
      ? t('use ✕ to remove a number.', 'usa ✕ para eliminar un número.')
      : phoneProblem(patch.number, patch.country_code ?? n.country_code)
    if (problem) {
      // Deliberately without the Object.assign below: the input keeps what
      // was typed, the row keeps what is actually stored, and the message
      // says which of the two is in the database. Assigning first -- which
      // is what the blank case used to do before returning -- showed the
      // typed value as though it had been saved when it had not.
      rowError.value = { ...rowError.value, [n.id]: t('Not saved', 'No guardado') + ' — ' + problem }
      return
    }
  }
  const { [n.id]: _cleared, ...rest } = rowError.value
  rowError.value = rest
  Object.assign(n, patch)
  await supabase.from('patient_contact_numbers').update(patch).eq('id', n.id)
}
</script>

<template>
  <div>
    <p class="text-[12px] font-medium text-ink-muted">{{ t('Phone numbers', 'Números de teléfono') }}</p>

    <ul v-if="!loading && numbers.length > 0" class="mt-1.5 space-y-1.5">
      <li v-for="n in numbers" :key="n.id" class="flex flex-wrap items-center gap-2">
        <template v-if="editable">
          <select
            :value="n.country_code"
            class="h-9 w-[120px] shrink-0 rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none"
            @change="updateNumber(n, { country_code: ($event.target as HTMLSelectElement).value })"
          >
            <option v-for="c in COUNTRIES_BY_NAME" :key="c.code" :value="c.code">{{ c.flag }} {{ c.dial }} {{ c.name }}</option>
          </select>
          <input
            :value="n.number"
            type="tel"
            data-cy="contact-number"
            class="h-9 flex-1 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none"
            @blur="updateNumber(n, { number: ($event.target as HTMLInputElement).value })"
          />
          <label class="flex shrink-0 items-center gap-1.5 text-[12.5px] text-ink-muted2">
            <input
              :checked="n.is_whatsapp"
              type="checkbox"
              data-cy="contact-whatsapp"
              class="h-4 w-4 rounded border-line-control text-brand focus:ring-brand"
              @change="updateNumber(n, { is_whatsapp: ($event.target as HTMLInputElement).checked })"
            />
            WhatsApp
          </label>
          <button type="button" class="shrink-0 text-ink-faint hover:text-danger-text" @click="removeNumber(n.id)">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke-linecap="round" />
            </svg>
          </button>
        </template>
        <span v-else class="rounded-ctl border border-line-control px-3 py-1.5 text-[13px] text-ink-700">
          {{ countryByCode(n.country_code).flag }} {{ formatPhoneDisplay(n.number, n.country_code) }}
          <UiPill v-if="n.is_whatsapp" tone="success" class="ml-1.5">WhatsApp</UiPill>
        </span>
        <p v-if="rowError[n.id]" class="w-full text-[12px] text-danger-text">{{ rowError[n.id] }}</p>
      </li>
    </ul>
    <p v-else-if="!loading" class="mt-1.5 text-[13px] text-ink-faint">{{ t('No numbers yet.', 'Aún no hay números.') }}</p>

    <div v-if="editable" class="mt-2 flex flex-wrap items-center gap-2">
      <!-- See NewAppointmentPanel for why the width is pinned. -->
      <select v-model="newCountry" class="h-9 w-[120px] shrink-0 rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none">
        <option v-for="c in COUNTRIES_BY_NAME" :key="c.code" :value="c.code">{{ c.flag }} {{ c.dial }} {{ c.name }}</option>
      </select>
      <input
        v-model="newNumber"
        type="tel"
        data-cy="new-contact-number"
        placeholder="612 34 56 78"
        class="h-9 flex-1 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none"
      />
      <label class="flex items-center gap-1.5 text-[12.5px] text-ink-muted2">
        <input v-model="newIsWhatsapp" type="checkbox" class="h-4 w-4 rounded border-line-control text-brand focus:ring-brand" />
        WhatsApp
      </label>
      <UiBtn variant="secondary" size="sm" data-cy="add-contact-number" :disabled="adding || !newNumber.trim()" @click="addNumber">{{ t('Add', 'Añadir') }}</UiBtn>
      <p v-if="addError" class="w-full text-[12px] text-danger-text">{{ addError }}</p>
    </div>
  </div>
</template>
