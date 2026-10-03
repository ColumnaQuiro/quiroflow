// The staff and patient app had no language at all: nothing called
// useLang().initFromStorage, so every t('en', 'es') in it rendered English,
// whatever the phone was set to and although every clinic using it is in
// Spain. The web does this in plugins/lang.client.ts; this is the app's copy
// of that, with one difference.
//
// The web falls back to its account store, which reads the staff member's
// saved language once they are signed in. The app has no store, and
// team_members.language_preference defaults to 'en' for everyone who never
// opened Settings > Appearance, so it cannot tell "chose English" from "never
// chose". So: a language stored on this device if there is one, else the
// device's own language -- English only when the phone is in English -- else
// Spanish.
export default defineNuxtPlugin(() => {
  useLang().initFromStorage(deviceLanguage())
})

function deviceLanguage(): 'en' | 'es' {
  const tag = (navigator.languages?.[0] ?? navigator.language ?? '').toLowerCase()
  return tag.startsWith('en') ? 'en' : 'es'
}
