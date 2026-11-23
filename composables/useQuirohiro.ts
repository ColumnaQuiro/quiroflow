// The QuiroHiro importer's saved connection, shared by its screens. The token
// itself never comes back to the browser (quirohiro-connection.get.ts): the
// import runs on the server as an import job (server/utils/quirohiroImportJob.ts),
// watched through useImportJob('quirohiro').

export interface QuirohiroConnectionInfo { locationId: string | null; locationName: string | null; hasToken: boolean }

const connection = ref<QuirohiroConnectionInfo | null>(null)

export function useQuirohiroConnection() {
  return connection
}

export async function loadQuirohiroConnection(force = false) {
  if (connection.value && !force) return connection.value
  connection.value = await useStaffFetch<QuirohiroConnectionInfo>('/api/import/quirohiro-connection').catch(() => null)
  return connection.value
}

export const quirohiroConnected = (c: QuirohiroConnectionInfo | null) => Boolean(c?.locationId && c.hasToken)
