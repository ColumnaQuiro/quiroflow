export function usePermission() {
  const store = useAccountStore()

  function can(key: string): boolean {
    return store.isOwner || store.permissions[key] === true
  }

  function scope(key: string): 'all' | 'own' | 'none' {
    if (store.isOwner) return 'all'
    const value = store.permissions[key]
    return value === 'all' || value === 'own' ? value : 'none'
  }

  // For the keys that TAKE something away when true -- calendar_read_only,
  // reports_own_only. can() is the wrong question for them: it answers true
  // for every owner, which would make every owner's calendar read-only. An
  // owner is never restricted, matching has_restriction() in the database (0047).
  function restricted(key: string): boolean {
    return !store.isOwner && store.permissions[key] === true
  }

  return { can, scope, restricted }
}
