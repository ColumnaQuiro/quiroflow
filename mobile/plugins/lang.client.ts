// The staff and patient app had no language at all: nothing called
// useLang().initFromStorage, so every t('en', 'es') in it rendered English,
// whatever the phone was set to and although every clinic using it is in
// Spain. The web does this in plugins/lang.client.ts; this is the app's copy
// of that, with one difference.
//
// A language stored on this device (Profile > Language) wins; otherwise the
// phone's own: Spanish when the phone is in Spanish, English for anything
// else. It used to fall back to Spanish for every non-English phone, which
// was a guess on someone else's behalf; the setting is one tap away now.
// (team_members.language_preference defaults to 'en' for everyone who never
// opened Settings > Appearance, so it cannot tell "chose English" from
// "never chose" -- which is why the app does not read it.)
export default defineNuxtPlugin(() => {
  useLang().initFromStorage(deviceLanguage())
})

function deviceLanguage(): 'en' | 'es' {
  const tag = (navigator.languages?.[0] ?? navigator.language ?? '').toLowerCase()
  return tag.startsWith('es') ? 'es' : 'en'
}
