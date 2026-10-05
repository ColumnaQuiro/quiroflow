// Whether layouts/patient.vue shows its tab bar. Only pages/index.vue turns
// it off -- while identity loads, two-factor is owed, or the account is linked
// to nobody -- so every other patient page keeps its tabs.
export function usePatientTabsVisible() {
  return useState('patient-tabs-visible', () => true)
}
