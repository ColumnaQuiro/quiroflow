<script setup lang="ts">
// How a slot freed on the calendar reaches the waitlist (accounts.
// waitlist_auto_offer, waitlist_offer_mode -- see the migration that added
// them). Above the list itself, where the question comes up. Changing it is
// a clinic setting (clinic_config, enforced by accounts_guard_settings);
// everyone else reads it.
//
// It also says when an offer would reach nobody: the message is an
// automation (trigger waitlist.slot_offered), and with none switched on a
// slot is "offered" without anyone being told.
const store = useAccountStore()
const supabase = useSupabaseClient()
const t = useT()
const { showToast } = useToast()

const auto = ref(false)
const mode = ref<'one_by_one' | 'all_at_once'>('one_by_one')
const saved = ref<{ auto: boolean; mode: string } | null>(null)
const messageRules = ref<number | null>(null)
const saving = ref(false)
const canEdit = computed(() => store.isOwner || (store.permissions.settings_access === true && store.permissions.clinic_config === true))
const dirty = computed(() => !!saved.value && (saved.value.auto !== auto.value || saved.value.mode !== mode.value))

onMounted(async () => {
  const [{ data: account }, { count }] = await Promise.all([
    supabase.from('accounts').select('waitlist_auto_offer, waitlist_offer_mode').eq('id', store.accountId!).maybeSingle(),
    supabase.from('automation_rules').select('id', { count: 'exact', head: true }).eq('trigger_event', 'waitlist.slot_offered').eq('enabled', true),
  ])
  auto.value = !!account?.waitlist_auto_offer
  mode.value = account?.waitlist_offer_mode === 'all_at_once' ? 'all_at_once' : 'one_by_one'
  saved.value = { auto: auto.value, mode: mode.value }
  messageRules.value = count ?? 0
})

async function save() {
  if (!canEdit.value || saving.value) return
  saving.value = true
  const { error } = await supabase.from('accounts').update({ waitlist_auto_offer: auto.value, waitlist_offer_mode: mode.value } as never).eq('id', store.accountId!)
  saving.value = false
  if (error) {
    showToast(error.message, 'error')
    return
  }
  saved.value = { auto: auto.value, mode: mode.value }
  showToast(t('Saved', 'Guardado'))
}

const option = (on: boolean) => `flex cursor-pointer items-start gap-3 rounded-[12px] px-3.5 py-3 ${on ? 'border-[1.5px] border-brand bg-brand-tint' : 'border border-line-control bg-surface'} ${canEdit.value ? '' : 'cursor-default opacity-80'}`
</script>

<template>
  <section aria-labelledby="h-waitlist-offers" class="mb-4 rounded-card border border-line bg-surface p-4 shadow-card" data-cy="waitlist-offer-settings" :data-ready="saved ? 'true' : undefined">
    <h2 id="h-waitlist-offers" class="text-[15px] font-bold text-ink-900">{{ t('When a slot frees up', 'Cuando se libera un hueco') }}</h2>

    <label class="mt-3 flex items-start gap-3" :class="canEdit ? 'cursor-pointer' : 'cursor-default'">
      <input v-model="auto" type="checkbox" :disabled="!canEdit" class="mt-0.5 h-5 w-5 shrink-0 accent-brand" data-cy="waitlist-auto-offer" />
      <span>
        <span class="block text-[14px] font-semibold text-ink-900">{{ t('Offer it to the waitlist automatically', 'Ofrecerlo a la lista de espera automáticamente') }}</span>
        <span class="block text-[12.5px] leading-snug text-ink-muted">
          {{ t('Whenever a visit is cancelled or moved — by the desk, by the patient on WhatsApp or from an integration — without anyone having to remember. When a patient cancels from their app or portal it is always offered.', 'Siempre que se cancele o mueva una cita — desde recepción, por el paciente en WhatsApp o desde una integración — sin que nadie tenga que acordarse. Cuando un paciente cancela desde su app o portal se ofrece siempre.') }}
        </span>
      </span>
    </label>

    <p class="mt-4 text-[12.5px] font-semibold text-ink-muted">{{ t('Who gets the offer', 'A quién se ofrece') }}</p>
    <div class="mt-1.5 grid gap-2 sm:grid-cols-2" role="radiogroup" :aria-label="t('Who gets the offer', 'A quién se ofrece')">
      <label :class="option(mode === 'one_by_one')" data-cy="waitlist-mode-one">
        <input v-model="mode" type="radio" value="one_by_one" :disabled="!canEdit" class="mt-1 accent-brand" />
        <span>
          <span class="block text-[14px] font-semibold text-ink-900">{{ t('One by one, in order', 'Uno a uno, por orden') }}</span>
          <span class="block text-[12.5px] leading-snug text-ink-muted">{{ t('The first in line gets it, with a deadline; if they do not accept, the next.', 'El primero de la lista, con un plazo; si no acepta, el siguiente.') }}</span>
        </span>
      </label>
      <label :class="option(mode === 'all_at_once')" data-cy="waitlist-mode-all">
        <input v-model="mode" type="radio" value="all_at_once" :disabled="!canEdit" class="mt-1 accent-brand" />
        <span>
          <span class="block text-[14px] font-semibold text-ink-900">{{ t('Everyone at once', 'A todos a la vez') }}</span>
          <span class="block text-[12.5px] leading-snug text-ink-muted">{{ t('Everyone who fits is told together and the first to accept books it; the rest stay on the list.', 'Se avisa a todos los que encajan y el primero que acepta se lo queda; los demás siguen en la lista.') }}</span>
        </span>
      </label>
    </div>

    <p v-if="messageRules === 0" class="mt-3 rounded-ctl border border-warning-border bg-warning-bg px-3 py-2 text-[12.5px] text-warning-text" data-cy="waitlist-no-message">
      {{ t('Nobody will be told: no automation sends the offer. Switch one on for "Waitlist slot offered" in', 'Nadie recibirá el aviso: ninguna automatización envía la oferta. Activa una para «Hueco ofrecido de la lista de espera» en') }}
      <NuxtLink to="/automations" class="font-semibold underline">{{ t('Automations', 'Automatizaciones') }}</NuxtLink>.
    </p>

    <div v-if="canEdit" class="mt-3 flex justify-end">
      <UiBtn variant="primary" :disabled="!dirty || saving" data-cy="waitlist-offer-save" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</UiBtn>
    </div>
  </section>
</template>
