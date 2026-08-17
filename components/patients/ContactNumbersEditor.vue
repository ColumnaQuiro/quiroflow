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
    <h3 class="text-sm font-medium text-gray-700">Contact Numbers</h3>

    <ul v-if="!loading && numbers.length > 0" class="mt-2 space-y-2">
      <li
        v-for="n in numbers"
        :key="n.id"
        class="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2 text-sm"
      >
        <span>
          {{ countryByCode(n.country_code).flag }} {{ countryByCode(n.country_code).dial }} {{ n.number }}
          <span v-if="n.is_whatsapp" class="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700">
            WhatsApp
          </span>
        </span>
        <button type="button" class="text-gray-400 hover:text-red-600" @click="removeNumber(n.id)">✕</button>
      </li>
    </ul>
    <p v-else-if="!loading" class="mt-2 text-sm text-gray-400">No numbers yet.</p>

    <div class="mt-3 flex flex-wrap items-center gap-2">
      <select v-model="newCountry" class="rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
        <option v-for="c in COUNTRIES" :key="c.code" :value="c.code">{{ c.flag }} {{ c.dial }}</option>
      </select>
      <input
        v-model="newNumber"
        type="tel"
        placeholder="612 34 56 78"
        class="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
      <label class="flex items-center gap-1.5 text-sm text-gray-600">
        <input v-model="newIsWhatsapp" type="checkbox" class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
        WhatsApp
      </label>
      <button
        type="button"
        :disabled="adding || !newNumber.trim()"
        class="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
        @click="addNumber"
      >
        Add Number
      </button>
    </div>
  </div>
</template>
