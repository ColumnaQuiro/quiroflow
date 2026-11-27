import { serverMessage } from '~/utils/serverMessage'

// The second half of "switch on, and also everyone who already meets it":
// once the automation is on, the one-off pass over who already did
// (/api/automations/:id/backfill). Shared by the list's toggle and the
// builder's switch, which reach "on" by different requests.
export function useAutomationBackfill() {
  const t = useT()
  const { showToast } = useToast()
  return async function includeExisting(ruleId: string, name: string, days: number): Promise<number | null> {
    try {
      const res = await useStaffFetch<{ enrolled: number; more: boolean }>(`/api/automations/${ruleId}/backfill`, { method: 'POST', body: { days } })
      const n = res.enrolled
      showToast(
        n === 0
          ? t(`"${name}" is on. Nobody else met it.`, `«${name}» activada. Nadie más la cumplía.`)
          : n === 1
            ? t(`"${name}" is on, with 1 patient who already met it.`, `«${name}» activada, con 1 paciente que ya la cumplía.`)
            : t(`"${name}" is on, with ${n} patients who already met it.`, `«${name}» activada, con ${n} pacientes que ya la cumplían.`),
      )
      return n
    } catch (e) {
      showToast(serverMessage(e) ?? t('It is on, but those who already met it could not be included.', 'Está activada, pero no se ha podido incluir a quienes ya la cumplían.'), 'error')
      return null
    }
  }
}
