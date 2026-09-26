<script setup lang="ts">
import { DEFAULT_QUIET_HOURS, EXIT_EVENTS, quietHoursText, say, weekdayName } from '~/utils/automationCatalog'
import { FIELD } from '~/utils/automationUi'

// Settings of one automation: when people leave early, when messages may go
// out, whether it is marketing, test mode, and the one-off actions -- send a
// test to me, launch it for one patient, pause, delete. Everything but the
// buttons is part of the draft and saved with the page's one Save.

const emit = defineEmits<{ sendTest: []; launch: []; toggleEnabled: []; remove: [] }>()
const b = useBuilder()
const t = useT()
const rule = computed(() => b.draft.value.rule)

const exits = computed(() => EXIT_EVENTS.filter((e) => !e.leadOnly || b.isLead.value))
function toggleExit(value: string, on: boolean) {
  const next = new Set(rule.value.exit_on)
  if (on) next.add(value)
  else next.delete(value)
  b.updateRule({ exit_on: [...next] })
}

const quiet = computed(() => rule.value.quiet_hours)
function setQuiet(patch: Partial<{ from: string; to: string; days: number[] }>) {
  b.updateRule({ quiet_hours: { ...(quiet.value ?? DEFAULT_QUIET_HOURS), ...patch } })
}
function toggleDay(d: number) {
  const days = new Set(quiet.value?.days ?? [])
  if (days.has(d)) days.delete(d)
  else days.add(d)
  setQuiet({ days: [...days].sort() })
}
const TIMES = Array.from({ length: 33 }, (_, i) => `${String(6 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`)
const CARD = 'flex scroll-mt-4 flex-col rounded-card border border-line bg-surface px-6 pb-3 pt-5 shadow-card'
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto p-4 pb-32 sm:p-6 sm:pb-32" data-test="settings">
    <div class="mx-auto flex max-w-[720px] flex-col gap-5">
      <section id="salida" aria-labelledby="h-salida" :class="CARD">
        <h2 id="h-salida" class="text-[16px] font-bold text-ink-900">{{ t('Leave before the end', 'Salir antes de terminar') }}</h2>
        <p class="mb-2 mt-0.5 text-[13px] text-ink-500">{{ t('The person leaves the automation as soon as any of these happens, whatever step they are on.', 'La persona deja la automatización en cuanto pase algo de esto, esté en el paso que esté.') }}</p>
        <SettingsSwitchRow
          v-for="e in exits"
          :key="e.value"
          :model-value="rule.exit_on.includes(e.value)"
          :title="say(t, e.label)"
          :description="say(t, e.hint)"
          :data-test="`exit-${e.value}`"
          @update:model-value="toggleExit(e.value, $event)"
        />
      </section>

      <section id="horario" aria-labelledby="h-horario" :class="CARD">
        <h2 id="h-horario" class="text-[16px] font-bold text-ink-900">{{ t('When it sends', 'Cuándo se envía') }}</h2>
        <p class="mb-2 mt-0.5 text-[13px] text-ink-500">{{ t('Messages never go out at night.', 'Los mensajes nunca salen de noche.') }}</p>
        <SettingsSwitchRow
          :model-value="!!quiet"
          :title="quietHoursText(t, quiet ?? DEFAULT_QUIET_HOURS)"
          :description="t('In the clinic\'s time zone. Anything due outside it waits for the next window.', 'En la zona horaria de la sede. Lo que caiga fuera espera al siguiente hueco.')"
          data-test="quiet-hours-toggle"
          @update:model-value="b.updateRule({ quiet_hours: $event ? { ...DEFAULT_QUIET_HOURS } : null })"
        />
        <div v-if="quiet" class="flex flex-col gap-3 border-t border-line-row py-3">
          <div class="flex flex-wrap items-center gap-2 text-[13px] text-ink-700">
            {{ t('Between', 'Entre') }}
            <select :class="[FIELD, 'w-24']" :value="quiet.from" :aria-label="t('From', 'Desde')" @change="setQuiet({ from: ($event.target as HTMLSelectElement).value })">
              <option v-for="tm in TIMES" :key="tm" :value="tm">{{ tm }}</option>
            </select>
            {{ t('and', 'y') }}
            <select :class="[FIELD, 'w-24']" :value="quiet.to" :aria-label="t('To', 'Hasta')" @change="setQuiet({ to: ($event.target as HTMLSelectElement).value })">
              <option v-for="tm in TIMES" :key="tm" :value="tm">{{ tm }}</option>
            </select>
          </div>
          <div class="flex flex-wrap gap-1.5" role="group" :aria-label="t('Days', 'Días')">
            <button
              v-for="d in 7"
              :key="d"
              type="button"
              class="h-8 rounded-pill border px-3 text-[12.5px] font-semibold capitalize touch:h-11"
              :class="(quiet.days ?? []).includes(d) ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line bg-surface text-ink-muted'"
              :aria-pressed="(quiet.days ?? []).includes(d)"
              @click="toggleDay(d)"
            >{{ weekdayName(t, d).slice(0, 3) }}</button>
          </div>
        </div>
      </section>

      <section id="marketing" aria-labelledby="h-marketing" :class="CARD">
        <h2 id="h-marketing" class="text-[16px] font-bold text-ink-900">{{ t('Marketing', 'Marketing') }}</h2>
        <p class="mb-2 mt-0.5 text-[13px] text-ink-500">{{ t('Decides who receives the messages.', 'Afecta a quién recibe los mensajes.') }}</p>
        <SettingsSwitchRow
          :model-value="rule.is_marketing"
          :title="t('It is a marketing message', 'Es una comunicación comercial')"
          :description="t('Each channel only reaches patients who accepted it (Marketing channels, on their record). Reminders and confirmations are not marketing.', 'Cada canal solo llega a quien lo aceptó (Canales de marketing, en su ficha). Los recordatorios y confirmaciones no lo son.') + (rule.trigger_event === 'patient.birthday' && !rule.is_marketing ? ' ' + t('Birthday messages usually are.', 'Las felicitaciones de cumpleaños suelen serlo.') : '')"
          data-test="marketing-toggle"
          @update:model-value="b.updateRule({ is_marketing: $event })"
        />
      </section>

      <section id="prueba" aria-labelledby="h-prueba" :class="CARD">
        <h2 id="h-prueba" class="text-[16px] font-bold text-ink-900">{{ t('Test mode', 'Modo prueba') }}</h2>
        <p class="mb-2 mt-0.5 text-[13px] text-ink-500">{{ t('To try it with real patients without sending them anything.', 'Para probarla con pacientes reales sin enviarles nada.') }}</p>
        <SettingsSwitchRow
          :model-value="rule.dry_run"
          :title="t('Record without sending', 'Registrar sin enviar')"
          :description="t('It runs for real -- picks the right people, fills in the template, follows every step -- but records what it would have sent instead of sending it. The messages appear in History and in the Inbox marked as not sent, and webhooks are not called.', 'Se ejecuta de verdad -- elige a las personas, rellena la plantilla, sigue cada paso -- pero registra lo que habría enviado en lugar de enviarlo. Los mensajes aparecen en Historial y en la Bandeja marcados como no enviados, y los webhooks no se llaman.')"
          data-test="dry-run-toggle"
          @update:model-value="b.updateRule({ dry_run: $event })"
        />
        <div class="flex flex-wrap gap-2 border-t border-line-row py-3">
          <UiBtn data-test="settings-send-test" @click="emit('sendTest')">{{ t('Send a test to me', 'Enviar prueba a mí') }}</UiBtn>
          <UiBtn :disabled="!b.ruleId.value || b.isLead.value" data-test="settings-launch" @click="emit('launch')">{{ t('Launch for one patient…', 'Lanzar para un paciente…') }}</UiBtn>
        </div>
      </section>

      <section v-if="b.ruleId.value" id="peligro" aria-labelledby="h-peligro" :class="CARD">
        <h2 id="h-peligro" class="text-[16px] font-bold text-ink-900">{{ t('Pause or delete', 'Pausar o eliminar') }}</h2>
        <p class="mb-3 mt-0.5 text-[13px] text-ink-500">{{ t('Paused, nobody new enters and the people inside stay where they are.', 'Pausada, nadie nuevo entra y quienes están dentro se quedan donde están.') }}</p>
        <div class="flex flex-wrap gap-2 pb-3">
          <UiBtn data-test="settings-toggle-enabled" @click="emit('toggleEnabled')">{{ b.draft.value.enabled ? t('Pause', 'Pausar') : t('Switch on', 'Activar') }}</UiBtn>
          <button type="button" class="h-9 rounded-ctl border border-danger-border bg-surface px-3.5 text-[13px] font-semibold text-danger-text hover:bg-danger-bg touch:h-11" data-test="settings-delete" @click="emit('remove')">
            {{ t('Delete automation', 'Eliminar automatización') }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
