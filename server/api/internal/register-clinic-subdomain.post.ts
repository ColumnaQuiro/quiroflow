interface NetlifySite {
  domain_aliases: string[]
}

// Called once right after a new account is created (pages/onboarding.vue)
// so <slug>.<appDomain> starts routing to the booking page immediately,
// without anyone touching the Netlify dashboard. Netlify's domain_aliases
// field only accepts literal hostnames (no wildcard syntax), so each
// clinic's subdomain has to be registered individually -- this is that
// registration, done automatically instead of manually per new clinic.
export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requireTeamMember(event)

  const { data: account } = await supabase.from('accounts').select('slug').eq('id', teamMember.account_id).maybeSingle()
  if (!account?.slug) {
    throw createError({ statusCode: 400, statusMessage: 'Account has no slug yet' })
  }

  const config = useRuntimeConfig()
  // Nuxt only overrides runtimeConfig from NUXT_-prefixed variables, and the
  // site has these as plain NETLIFY_AUTH_TOKEN / NETLIFY_SITE_ID. So from
  // August to 16 Nov 2026 every sign-up landed in `skipped`, silently: eleven
  // clinics' "Open page" links were 404s and only the one added by hand
  // worked. Read at request time, so the token never lands in the bundle.
  const token = config.netlifyAuthToken || process.env.NETLIFY_AUTH_TOKEN
  const siteId = config.netlifySiteId || process.env.NETLIFY_SITE_ID
  const appDomain = config.public.appDomain
  if (!token || !siteId || !appDomain) {
    if (appDomain && !import.meta.dev) {
      console.warn(`[register-clinic-subdomain] no Netlify token/site id: ${account.slug}.${appDomain} was not registered and its booking link will 404`)
    }
    return { skipped: true }
  }

  const hostname = `${account.slug}.${appDomain}`
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const site = await $fetch<NetlifySite>(`https://api.netlify.com/api/v1/sites/${siteId}`, { headers })
  if (site.domain_aliases?.includes(hostname)) {
    return { success: true, hostname, already: true }
  }

  await $fetch(`https://api.netlify.com/api/v1/sites/${siteId}`, {
    method: 'PATCH',
    headers,
    body: { domain_aliases: [...(site.domain_aliases ?? []), hostname] },
  })

  return { success: true, hostname }
})
