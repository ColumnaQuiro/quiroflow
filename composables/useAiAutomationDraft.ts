import type { AiAutomationDraft } from '~/utils/aiAutomationDraft'

// The automation "Create with AI" drafted, on its way from the dialog on the
// Automations page to the builder at /automations/new?from=ai, which takes it
// once (pages/automations/[id].vue). Client state only: nothing is saved
// until the builder's own Save.
export function useAiAutomationDraft() {
  return useState<AiAutomationDraft | null>('ai-automation-draft', () => null)
}
