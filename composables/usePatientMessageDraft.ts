// Text another screen wants waiting in the patient's message box: "Ask to
// change this time" on the care plan card opens Messages with the request
// already written, for them to edit and send. Kept in app state rather than
// the URL, and taken once, so it does not come back on the next visit.
export function usePatientMessageDraft() {
  const draft = useState<string>('patient-message-draft', () => '')
  function take(): string {
    const text = draft.value
    draft.value = ''
    return text
  }
  return { draft, take }
}
