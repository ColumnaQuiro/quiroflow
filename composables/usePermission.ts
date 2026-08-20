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

  return { can, scope }
}
