// Downloads the actual file content for every "Not migrated yet" patient_files
// record (imported earlier from PracticeHub's File Attachments CSV export,
// which only carries metadata) and uploads it into QuiroFlow's Supabase
// Storage. PracticeHub has no bulk file-download API -- the only way to get
// a file's bytes is the signed S3 URL its "View" button generates in the
// browser -- so this drives a real, visible browser window through your own
// PracticeHub session to click "View" for each pending file, the same way
// you would by hand, just automated.
//
// You stay in control of the two sensitive steps: you type your QuiroFlow
// login into this terminal, and you log into PracticeHub yourself in the
// browser window this script opens. The script never sees either password.
//
// Works for any clinic on QuiroFlow, not just one account -- it signs in as
// whoever runs it and only ever touches that account's own data (same RLS
// the web app itself is bound by), and PracticeHub's URL is passed in, not
// hardcoded.
//
// Setup (once):
//   npm install playwright @supabase/supabase-js papaparse ws
//   npx playwright install chromium
//
// Usage:
//   node migrate-practicehub-attachments.mjs <path-to-csv> --practicehub-url=https://<your-clinic>.practicehub.io
//
// <path-to-csv> is PracticeHub's "File Attachments - List" export (Reports
// -> Data Exports), and must already have been imported as patient_files
// placeholders through QuiroFlow's Settings -> Import Data first.
//
// Safe to re-run: it only processes patient_files rows where storage_path
// is still null, so an interrupted run picks up where it left off.

import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'
import Papa from 'papaparse'
import { readFileSync, existsSync, appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// The Supabase URL and publishable (anon) key are not secrets -- they're the
// same values already shipped to every browser in QuiroFlow's own web app
// bundle, safe to embed here so this script works standalone for any clinic
// without needing a copy of the QuiroFlow repo. Override via env vars if
// you're pointing at a different deployment (e.g. local dev).
const SUPABASE_URL = process.env.NUXT_PUBLIC_SUPABASE_URL || 'https://oyaprkfurtuujdfafptw.supabase.co'
const SUPABASE_KEY = process.env.NUXT_PUBLIC_SUPABASE_KEY || 'sb_publishable_YcvVhzmzvUvhf4vfv2edKg_PmQrl7To'
const BUCKET = 'patient-files'
const LOG_FILE = join(__dirname, 'migrate-attachments.log')

const practicehubUrlArg = process.argv.find((a) => a.startsWith('--practicehub-url='))
if (!practicehubUrlArg) {
  console.error('Missing required --practicehub-url=https://<your-clinic>.practicehub.io')
  process.exit(1)
}
const PRACTICEHUB_URL = practicehubUrlArg.split('=')[1].replace(/\/$/, '')

const positionalArg = process.argv.slice(2).find((a) => !a.startsWith('--'))
if (!positionalArg) {
  console.error('Missing required <path-to-csv> argument: your clinic\'s PracticeHub "File Attachments - List" export.')
  process.exit(1)
}
const csvPath = positionalArg

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  appendFileSync(LOG_FILE, line + '\n')
}

async function prompt(question, { hidden = false } = {}) {
  const rl = createInterface({ input: stdin, output: stdout })
  if (!hidden) {
    const answer = await rl.question(question)
    rl.close()
    return answer.trim()
  }
  // Minimal masked input: mute the terminal's echo while the user types.
  return new Promise((resolve) => {
    stdout.write(question)
    let value = ''
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    const onData = (char) => {
      if (char === '\n' || char === '\r' || char === '') {
        stdin.setRawMode(false)
        stdin.pause()
        stdin.removeListener('data', onData)
        stdout.write('\n')
        rl.close()
        resolve(value)
        return
      }
      if (char === '') process.exit(1) // Ctrl+C
      if (char === '') { value = value.slice(0, -1); return } // backspace
      value += char
    }
    stdin.on('data', onData)
  })
}

async function main() {
  if (!existsSync(csvPath)) {
    console.error(`CSV not found at ${csvPath}. Pass the path as an argument.`)
    process.exit(1)
  }

  log(`Reading ${csvPath}`)
  const csvText = readFileSync(csvPath, 'utf8')
  const { data: csvRows } = Papa.parse(csvText, { header: true, skipEmptyLines: true })
  const csvByFileId = new Map(csvRows.map((r) => [r['File ID']?.trim(), r]))

  const email = process.env.QUIROFLOW_EMAIL || (await prompt('QuiroFlow email: '))
  const password = process.env.QUIROFLOW_PASSWORD || (await prompt('QuiroFlow password: ', { hidden: true }))

  // Node 20 has no native WebSocket; supabase-js sets up a realtime client
  // unconditionally even though this script never subscribes to anything,
  // so it needs an explicit WebSocket implementation to avoid crashing.
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { realtime: { transport: WebSocket } })
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password })
  if (authError) {
    console.error(`Login failed: ${authError.message}`)
    process.exit(1)
  }
  log(`Signed in as ${authData.user.email}`)

  const { data: teamMember, error: teamMemberError } = await supabase
    .from('team_members')
    .select('account_id')
    .eq('user_id', authData.user.id)
    .single()
  if (teamMemberError) {
    console.error(`Couldn't load your team member record: ${teamMemberError.message}`)
    process.exit(1)
  }
  const accountId = teamMember.account_id

  const limitArg = process.argv.find((a) => a.startsWith('--limit='))
  const patientLimit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null
  if (patientLimit) log(`--limit=${patientLimit}: only processing the first ${patientLimit} patients this run.`)

  const PAGE_SIZE = 1000

  async function fetchAll(table, select, filter) {
    const rows = []
    for (let page = 0; ; page++) {
      let query = supabase.from(table).select(select).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      if (filter) query = filter(query)
      const { data, error } = await query
      if (error) {
        console.error(`Query failed on ${table}: ${error.message}`)
        process.exit(1)
      }
      rows.push(...data)
      if (data.length < PAGE_SIZE) break
    }
    return rows
  }

  // Every patient_files row still missing content, joined back to its CSV
  // row to recover the PracticeHub patient name (needed to search PH's UI --
  // PH's own patient ID isn't stored anywhere in QuiroFlow) and filename.
  const pending = await fetchAll('patient_files', 'id, patient_id, file_name, external_reference', (q) =>
    q.eq('account_id', accountId).is('storage_path', null).not('external_reference', 'is', null),
  )

  log(`${pending.length} files still pending.`)
  if (pending.length === 0) {
    log('Nothing to do.')
    return
  }

  // Fetched in full (paginated) rather than via `.in(patientIds)` -- with
  // hundreds of patients that IN-list can blow past PostgREST's URL length
  // limits and fail silently.
  const patients = await fetchAll('patients', 'id, first_name, last_name', (q) => q.eq('account_id', accountId))
  const patientById = new Map(patients.map((p) => [p.id, p]))

  const contactNumbers = await fetchAll('patient_contact_numbers', 'patient_id, number', (q) => q.eq('account_id', accountId))
  const phoneByPatientId = new Map()
  for (const c of contactNumbers) {
    const list = phoneByPatientId.get(c.patient_id) ?? []
    list.push(c.number.replace(/\D/g, ''))
    phoneByPatientId.set(c.patient_id, list)
  }

  // Group pending files by patient so we only open each PracticeHub record once.
  const byPatient = new Map()
  for (const file of pending) {
    const csvRow = csvByFileId.get(file.external_reference)
    if (!csvRow) {
      log(`WARN file ${file.id} (${file.file_name}): no matching CSV row for File ID ${file.external_reference}, skipping`)
      continue
    }
    const list = byPatient.get(file.patient_id) ?? []
    list.push({ file, csvRow })
    byPatient.set(file.patient_id, list)
  }

  const patientEntries = patientLimit ? [...byPatient.entries()].slice(0, patientLimit) : [...byPatient.entries()]
  log(`Processing ${patientEntries.length} patient(s), ${patientEntries.reduce((n, [, f]) => n + f.length, 0)} file(s).`)

  log(`Launching browser. Log into PracticeHub in the window that opens, then come back here.`)
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${PRACTICEHUB_URL}/patients`)
  await prompt('\nPress Enter once you are logged in and can see the Patients list: ')

  let succeeded = 0
  let failed = 0
  let skipped = 0

  for (const [patientId, files] of patientEntries) {
    const patient = patientById.get(patientId)
    const phFirstName = files[0].csvRow['Patient First Name']?.trim() ?? ''
    const phLastName = files[0].csvRow['Patient Last Name']?.trim() ?? ''
    const phName = `${phFirstName} ${phLastName}`.trim()
    log(`--- ${phName} (QuiroFlow: ${patient.first_name} ${patient.last_name ?? ''}) — ${files.length} file(s)`)

    try {
      await page.goto(`${PRACTICEHUB_URL}/patients`)
      const searchBox = page.locator('input[type="search"]').first()
      // PracticeHub displays (and its own search filters on) "Last, First",
      // not "First Last" -- searching/matching the full name as one ordered
      // string never matches a two-word name. Search on whichever name part
      // is more likely unique, then narrow further by the other part.
      const searchTerm = phLastName || phFirstName
      // .fill() sets the value directly and doesn't reliably fire the
      // keyup DataTables listens for to actually filter -- without a real
      // filter the table just shows its default first page, which is why
      // only the one patient who happens to sort first ever "matched".
      // Typing it out keystroke-by-keystroke fires real keyboard events.
      await searchBox.click()
      await searchBox.fill('')
      await searchBox.pressSequentially(searchTerm, { delay: 50 })
      await page.waitForTimeout(800)

      let rows = page.locator('table tbody tr', { hasText: searchTerm })
      if (phLastName && phFirstName) rows = rows.filter({ hasText: phFirstName })
      const rowCount = await rows.count()
      if (rowCount === 0) {
        log(`WARN "${phName}" not found in PracticeHub search, skipping ${files.length} file(s)`)
        skipped += files.length
        continue
      }

      let rowToOpen = rows.first()
      if (rowCount > 1) {
        // Disambiguate same-name patients by phone number shown in the panel.
        const expectedPhones = phoneByPatientId.get(patientId) ?? []
        let matched = false
        for (let i = 0; i < rowCount; i++) {
          await rows.nth(i).click()
          await page.waitForTimeout(500)
          const contactText = await page.locator('text=Mobile').locator('..').innerText().catch(() => '')
          const digits = contactText.replace(/\D/g, '')
          if (expectedPhones.some((p) => p && digits.includes(p))) {
            matched = true
            break
          }
          await page.locator('button:has-text("✕"), [aria-label="Close"]').first().click().catch(() => {})
        }
        if (!matched) {
          log(`WARN ${rowCount} patients named "${phName}" in PracticeHub, couldn't disambiguate by phone, skipping ${files.length} file(s)`)
          skipped += files.length
          continue
        }
      } else {
        await rowToOpen.click()
        await page.waitForTimeout(500)
      }

      await page.locator('text=Forms & Files').first().click()
      await page.waitForTimeout(500)
      await page.locator('text=Files').first().click().catch(() => {})
      await page.waitForTimeout(500)

      for (const { file, csvRow } of files) {
        try {
          const fileRow = page.locator('tr', { hasText: csvRow['Filename'].trim() }).first()
          const viewLink = fileRow.locator('a:has-text("View")').first()
          if ((await viewLink.count()) === 0) {
            log(`WARN "${csvRow['Filename']}" not found on ${phName}'s Files tab, skipping`)
            skipped++
            continue
          }

          const [newPage] = await Promise.all([context.waitForEvent('page'), viewLink.click()])
          await newPage.waitForLoadState('domcontentloaded').catch(() => {})
          const signedUrl = newPage.url()
          await newPage.close()

          const res = await fetch(signedUrl)
          if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
          const buffer = Buffer.from(await res.arrayBuffer())

          const storagePath = `${accountId}/${patientId}/${Date.now()}-${file.file_name}`
          const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, buffer, {
            contentType: csvRow['Mime Type']?.trim() || 'application/octet-stream',
          })
          if (uploadError) throw new Error(`upload failed: ${uploadError.message}`)

          const { error: updateError } = await supabase.from('patient_files').update({ storage_path: storagePath }).eq('id', file.id)
          if (updateError) throw new Error(`db update failed: ${updateError.message}`)

          log(`OK ${phName}: ${file.file_name} (${buffer.length} bytes)`)
          succeeded++
        } catch (err) {
          log(`ERROR ${phName}: ${file.file_name}: ${err.message}`)
          failed++
        }
        await page.waitForTimeout(300)
      }

      await page.locator('button:has-text("✕"), [aria-label="Close"]').first().click().catch(() => {})
    } catch (err) {
      log(`ERROR processing ${phName}: ${err.message}`)
      failed += files.length
    }
  }

  await browser.close()
  log(`Done. Succeeded: ${succeeded}, Failed: ${failed}, Skipped: ${skipped}. See ${LOG_FILE} for details.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
