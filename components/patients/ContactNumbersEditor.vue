<script setup lang="ts">
import type { Tables } from '~/types/database.types'

const props = defineProps<{ patientId: string }>()

const supabase = useSupabaseClient()
const store = useAccountStore()

const numbers = ref<Tables<'patient_contact_numbers'>[]>([])
const loading = ref(true)

const newCountry = ref('ES')
const newNumber = ref('')
const newIsWhatsapp = ref(false)
const adding = ref(false)

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
  adding.value = true
  await supabase.from('patient_contact_numbers').insert({
    account_id: store.accountId!,
    patient_id: props.patientId,
    country_code: newCountry.value,
    number: newNumber.value.trim(),
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
</script>

<template>
  <div>
    <p class="text-[12px] font-medium text-ink-muted">Phone numbers</p>

    <ul v-if="!loading && numbers.length > 0" class="mt-1.5 space-y-1.5">
      <li
        v-for="n in numbers"
        :key="n.id"
        class="flex items-center justify-between rounded-ctl border border-line-control px-3 py-1.5 text-[13px] text-ink-700"
      >
        <span>
          {{ countryByCode(n.country_code).flag }} {{ countryByCode(n.country_code).dial }} {{ n.number }}
          <UiPill v-if="n.is_whatsapp" tone="success" class="ml-1.5">WhatsApp</UiPill>
        </span>
        <button type="button" class="text-ink-faint hover:text-danger-text" @click="removeNumber(n.id)">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke-linecap="round" />
          </svg>
        </button>
      </li>
    </ul>
    <p v-else-if="!loading" class="mt-1.5 text-[13px] text-ink-faint">No numbers yet.</p>

    <div class="mt-2 flex flex-wrap items-center gap-2">
      <select v-model="newCountry" class="h-9 rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none">
        <option v-for="c in COUNTRIES" :key="c.code" :value="c.code">{{ c.flag }} {{ c.dial }}</option>
      </select>
      <input
        v-model="newNumber"
        type="tel"
        placeholder="612 34 56 78"
        class="h-9 flex-1 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none"
      />
      <label class="flex items-center gap-1.5 text-[12.5px] text-ink-muted2">
        <input v-model="newIsWhatsapp" type="checkbox" class="h-4 w-4 rounded border-line-control text-brand focus:ring-brand" />
        WhatsApp
      </label>
      <UiBtn variant="secondary" size="sm" :disabled="adding || !newNumber.trim()" @click="addNumber">Add</UiBtn>
    </div>
  </div>
</template>
