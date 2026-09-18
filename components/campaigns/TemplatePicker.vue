<script setup lang="ts">
// Pick which of the starter campaigns to create.
//
// A picker rather than a single "add them all" button because these are not
// all wanted everywhere: the two birthday ones are marketing and only reach
// patients who opted in, the lapsed-patient one contains a discount the clinic
// has to agree to, and a practice with its own first-visit sequence wants none
// of the first three. Creating eight campaigns someone then has to read and
// delete is worse than creating the two they wanted.
//
// Everything arrives DISABLED. These send to real patients, and a campaign
// that started firing because someone was curious what the button did would be
// a bad way to find out.
import { CAMPAIGN_TEMPLATES, fillClinicPlaceholders, type CampaignTemplate } from '~/utils/campaignTemplates'

const emit = defineEmits<{ close: []; created: [count: number] }>()

const t = useT()
const supabase = useSupabaseClient()
const store = useAccountStore()

const selected = ref<Set<string>>(new Set())
const alreadyAdded = ref<Set<string>>(new Set())
const clinic = ref<{ name: string; address: string | null } | null>(null)
const loading = ref(true)
const saving = ref(false)
const error = ref('')

// Matched on the template's NAME in the clinic's language, because
// automation_rules has no column to record where a rule came from. Renaming a
// created campaign therefore lets it be added again -- which is the
// forgiving way round: offering a duplicate is a nuisance, hiding a template
// someone deliberately renamed and now wants a fresh copy of is a dead end.
async function load() {
  loading.value = true
  const [{ data: clinicRow }, { data: existing }] = await Promise.all([
    supabase.from('clinics').select('name, address').eq('account_id', store.accountId!).order('created_at').limit(1).maybeSingle(),
    supabase.from('automation_rules').select('name').eq('account_id', store.accountId!),
  ])
  clinic.value = clinicRow ?? null
  const names = new Set((existing ?? []).map((r) => r.name.trim().toLowerCase()))
  alreadyAdded.value = new Set(
    CAMPAIGN_TEMPLATES.filter((tpl) => names.has(t(tpl.name.en, tpl.name.es).trim().toLowerCase())).map((tpl) => tpl.key),
  )
  // Pre-tick the ones they don't have, so the common case is one click.
  selected.value = new Set(CAMPAIGN_TEMPLATES.filter((tpl) => !alreadyAdded.value.has(tpl.key)).map((tpl) => tpl.key))
  loading.value = false
}
onMounted(load)

function toggle(key: string) {
  const next = new Set(selected.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selected.value = next
}

const chosen = computed(() => CAMPAIGN_TEMPLATES.filter((tpl) => selected.value.has(tpl.key)))

function bodyFor(tpl: CampaignTemplate) {
  const raw = t(tpl.body.en, tpl.body.es)
  return clinic.value ? fillClinicPlaceholders(raw, clinic.value) : raw
}
function subjectFor(tpl: CampaignTemplate) {
  const raw = t(tpl.subject.en, tpl.subject.es)
  return clinic.value ? fillClinicPlaceholders(raw, clinic.value) : raw
}

async function create() {
  if (chosen.value.length === 0) return
  saving.value = true
  error.value = ''

  // One rule at a time rather than a bulk insert: each needs its action row
  // keyed to the id the insert returns, and a half-created campaign (a rule
  // with no action) is worse than a slower loop -- it would show in the list
  // as a campaign that sends nothing.
  let created = 0
  for (const tpl of chosen.value) {
    const { data: rule, error: ruleError } = await supabase
      .from('automation_rules')
      .insert({
        account_id: store.accountId!,
        name: t(tpl.name.en, tpl.name.es),
        trigger_event: tpl.triggerEvent,
        filters: tpl.filters,
        is_marketing: tpl.isMarketing,
        enabled: false,
        created_by: store.teamMember?.id ?? null,
      })
      .select('id')
      .single()

    if (ruleError || !rule) {
      error.value = ruleError?.message ?? t('Could not create the campaigns.', 'No se han podido crear las campañas.')
      break
    }

    const { error: actionError } = await supabase.from('automation_actions').insert({
      account_id: store.accountId!,
      rule_id: rule.id,
      action_type: 'email',
      position: 0,
      config: { subject: subjectFor(tpl), body: bodyFor(tpl) },
    })
    if (actionError) {
      // Take the rule back out rather than leaving one that sends nothing.
      await supabase.from('automation_rules').delete().eq('id', rule.id)
      error.value = actionError.message
      break
    }
    created++
  }

  saving.value = false
  if (created > 0) emit('created', created)
  if (!error.value) emit('close')
}
</script>

<template>
  <div class="fixed inset-0 z-30 flex justify-end bg-ink-900/40" @click.self="emit('close')">
    <div class="flex h-full w-full max-w-xl flex-col bg-surface shadow-drawer">
      <div class="flex h-14 shrink-0 items-center justify-between border-b border-line px-6">
        <h2 class="text-[15px] font-semibold text-ink-900">{{ t('Start from a template', 'Empezar con plantillas') }}</h2>
        <button type="button" class="flex h-7 w-7 items-center justify-center rounded-ctlSm text-ink-faint2 hover:bg-surface-subtle hover:text-ink-muted" @click="emit('close')">✕</button>
      </div>

      <div class="flex-1 overflow-y-auto px-6 py-4">
        <p class="text-[13px] text-ink-muted2">
          {{ t(
            'A starting set of patient emails, written for a chiropractic clinic. Everything is created switched OFF so you can read it, change the wording, and turn on what you want.',
            'Un conjunto inicial de correos para pacientes, escrito para una clínica quiropráctica. Todo se crea DESACTIVADO para que puedas leerlo, cambiar el texto y activar lo que quieras.',
          ) }}
        </p>
        <p class="mt-2 text-[12px] text-ink-faint">
          {{ t(
            'Your clinic name and address are filled in automatically. None of them are narrowed to a particular appointment type -- add that yourself once created, if you want one to fire only after a specific visit.',
            'El nombre y la dirección de tu clínica se rellenan automáticamente. Ninguna está limitada a un tipo de cita concreto: añádelo tú después de crearlas si quieres que alguna se dispare solo tras una visita concreta.',
          ) }}
        </p>

        <div v-if="loading" class="mt-4 space-y-2">
          <UiSkeleton v-for="i in 5" :key="i" class="h-14 rounded-ctl" />
        </div>

        <ul v-else class="mt-4 space-y-2">
          <li
            v-for="tpl in CAMPAIGN_TEMPLATES"
            :key="tpl.key"
            class="rounded-ctl border p-3"
            :class="selected.has(tpl.key) ? 'border-brand-tintBorder bg-brand-tint' : 'border-line-divider'"
          >
            <label class="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                class="mt-0.5 h-3.5 w-3.5 shrink-0 accent-brand"
                :data-test="`template-${tpl.key}`"
                :checked="selected.has(tpl.key)"
                @change="toggle(tpl.key)"
              />
              <span class="min-w-0">
                <span class="block text-[13px] font-medium text-ink-900">
                  {{ t(tpl.name.en, tpl.name.es) }}
                  <span v-if="tpl.isMarketing" class="ml-1 rounded-pill bg-chip-bg px-1.5 py-0.5 text-[10.5px] font-normal text-chip-text">
                    {{ t('marketing', 'marketing') }}
                  </span>
                  <span v-if="alreadyAdded.has(tpl.key)" class="ml-1 rounded-pill bg-amber-bg px-1.5 py-0.5 text-[10.5px] font-normal text-amber-text">
                    {{ t('already added', 'ya añadida') }}
                  </span>
                </span>
                <span class="mt-0.5 block text-[12.5px] text-ink-muted2">{{ t(tpl.description.en, tpl.description.es) }}</span>
              </span>
            </label>
          </li>
        </ul>

        <p v-if="error" class="mt-3 text-[12.5px] text-danger-text">{{ error }}</p>
      </div>

      <div class="flex shrink-0 items-center justify-between gap-3 border-t border-line-divider bg-surface-subtle2 px-6 py-3.5">
        <p class="text-[12px] text-ink-faint">
          {{ chosen.length }} {{ chosen.length === 1 ? t('selected', 'seleccionada') : t('selected', 'seleccionadas') }}
        </p>
        <div class="flex items-center gap-2">
          <UiBtn variant="secondary" type="button" @click="emit('close')">{{ t('Cancel', 'Cancelar') }}</UiBtn>
          <UiBtn variant="primary" type="button" :disabled="saving || chosen.length === 0" data-test="create-templates" @click="create">
            {{ saving ? t('Creating…', 'Creando…') : t('Create campaigns', 'Crear campañas') }}
          </UiBtn>
        </div>
      </div>
    </div>
  </div>
</template>
