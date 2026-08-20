// PracticeHub's API sends no CORS headers, so the browser can't call it
// directly -- this just forwards one paginated request server-side. Auth
// still requires a signed-in team member so this can't be used as an open
// proxy to arbitrary URLs by anyone who finds the endpoint.
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'data_admin')

  const body = await readBody<{
    baseUrl: string
    apiKey: string
    appDetails: string
    path: string
    page?: number
    pageSize?: number
  }>(event)
  if (!body?.baseUrl || !body?.apiKey || !body?.appDetails || !body?.path) {
    throw createError({ statusCode: 400, statusMessage: 'baseUrl, apiKey, appDetails and path are required' })
  }

  const url = new URL(`${body.baseUrl.replace(/\/$/, '')}/api${body.path}`)
  if (body.page) url.searchParams.set('page', String(body.page))
  url.searchParams.set('page_size', String(body.pageSize ?? 100))

  try {
    const data = await $fetch(url.toString(), {
      headers: { 'x-practicehub-key': body.apiKey, 'x-app-details': body.appDetails },
    })
    return data
  } catch (err: any) {
    throw createError({ statusCode: err?.response?.status ?? 502, statusMessage: err?.data?.message ?? 'PracticeHub API request failed' })
  }
})
