import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'data_admin')

  const path = join(process.cwd(), 'scripts', 'migrate-practicehub-attachments.mjs')
  const content = readFileSync(path, 'utf8')
  setHeader(event, 'Content-Type', 'text/javascript; charset=utf-8')
  setHeader(event, 'Content-Disposition', 'attachment; filename="migrate-practicehub-attachments.mjs"')
  return content
})
