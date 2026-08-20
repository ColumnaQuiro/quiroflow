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
  const token = config.netlifyAuthToken
  const siteId = config.netlifySiteId
  const appDomain = config.public.appDomain
  if (!token || !siteId || !appDomain) {
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
