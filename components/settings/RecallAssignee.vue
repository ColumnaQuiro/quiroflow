<script setup lang="ts">
// Settings > Recalls: who a patient is assigned to when they land on the
// Recalls list and nobody has picked anyone yet (accounts.
// recall_assignee_default, 20261022185125). PracticeHub calls it "Unassigned
// Recall Assignation". Applied by the recall_candidates view when it is read,
// so changing it moves every recall nobody has assigned by hand, at once, and
// none that somebody has.
//
// Saved on each change, like a switch: there is nothing else on the card to
// save alongside it.

type Mode = 'practitioner' | 'nobody' | 'member'

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

const mode = ref<Mode>('nobody')
const memberId = ref('')
const members = ref<{ id: string; full_name: string }[]>([])
const loading = ref(true)
const saving = ref(false)

onMounted(async () => {
  const [{ data: account }, { data: team }] = await Promise.all([
    supabase.from('accounts').select('recall_assignee_default, recall_assignee_member_id').eq('id', store.accountId!).single(),
    supabase.from('team_members').select('id, full_name').is('deleted_at', null).order('full_name'),
  ])
  members.value = team ?? []
  mode.value = (account?.recall_assignee_default as Mode | undefined) ?? 'nobody'
  // A colleague who has since left reads as not chosen yet.
  memberId.value = members.value.some((m) => m.id === account?.recall_assignee_member_id) ? account!.recall_assignee_member_id! : ''
  loading.value = false
})

async function save() {
  // "A chosen person" with nobody chosen yet waits for the choice.
  if (mode.value === 'member' && !memberId.value) return
  saving.value = true
  const { error } = await supabase
    .from('accounts')
    .update({ recall_assignee_default: mode.value, recall_assignee_member_id: mode.value === 'member' ? memberId.value : null })
    .eq('id', store.accountId!)
  saving.value = false
  if (error) {
    showToast(error.message, 'error')
    return
  }
  showToast(t('Saved', 'Guardado'))
}

const options = computed(() => [
  {
    value: 'practitioner' as const,
    title: t('Their practitioner', 'Su profesional'),
    text: t("The patient's default practitioner, who knows them best. Patients with none stay unassigned.", 'El profesional habitual del paciente, que es quien mejor le conoce. Los que no tienen quedan sin asignar.'),
  },
  {
    value: 'nobody' as const,
    title: t('Nobody', 'Nadie'),
    text: t('They wait unassigned, and whoever takes one picks it up.', 'Esperan sin asignar y quien coge uno se lo asigna.'),
  },
  {
    value: 'member' as const,
    title: t('One person', 'Una persona'),
    text: t('Everyone new goes to the same person, say reception.', 'Todos los nuevos van a la misma persona, por ejemplo recepción.'),
  },
])
const inputClass = 'h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
</script>

<template>
  <section aria-labelledby="h-recall-assignee" class="overflow-hidden rounded-card border border-line bg-surface" data-cy="recall-assignee-settings" :data-ready="loading ? undefined : 'true'">
    <div class="px-[18px] pb-3 pt-4">
      <h2 id="h-recall-assignee" class="text-[16px] font-bold text-ink-900">{{ t('Who follows up new recalls', 'Quién hace el seguimiento de los nuevos') }}</h2>
      <p class="mt-1 text-[13px] leading-snug text-ink-muted">
        {{ t('When a patient joins the Recalls list and nobody has assigned them yet. Assigning someone by hand on Recalls always wins.', 'Cuando un paciente entra en Recordatorios y nadie lo ha asignado todavía. Asignarlo a mano en Recordatorios siempre prevalece.') }}
      </p>
    </div>
    <div v-if="loading" class="border-t border-line-row px-[18px] py-4"><UiSkeleton class="h-4 w-48 rounded-ctlSm" /></div>
    <div v-else role="radiogroup" :aria-label="t('Who follows up new recalls', 'Quién hace el seguimiento de los nuevos')" class="flex flex-col border-t border-line-row">
      <label
        v-for="(opt, i) in options"
        :key="opt.value"
        class="flex cursor-pointer items-start gap-3 px-[18px] py-3.5"
        :class="[mode === opt.value ? 'bg-brand-tint' : '', i > 0 ? 'border-t border-line-row' : '']"
      >
        <input v-model="mode" type="radio" :value="opt.value" :data-cy="`recall-assignee-default-${opt.value}`" :disabled="saving" class="mt-1 h-4 w-4 accent-brand" @change="save" />
        <span class="flex min-w-0 flex-1 flex-col gap-1.5">
          <strong class="text-[14.5px] text-ink-900">{{ opt.title }}</strong>
          <span class="text-[13px] text-ink-500">{{ opt.text }}</span>
          <select
            v-if="opt.value === 'member' && mode === 'member'"
            v-model="memberId"
            data-cy="recall-assignee-member"
            :disabled="saving"
            :aria-label="t('Person', 'Persona')"
            :class="[inputClass, 'w-full max-w-[320px]']"
            @change="save"
          >
            <option value="" disabled>{{ t('Choose someone…', 'Elige a alguien…') }}</option>
            <option v-for="m in members" :key="m.id" :value="m.id">{{ m.full_name }}</option>
          </select>
        </span>
      </label>
    </div>
  </section>
</template>
