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
// It works four patients at a time by default, in one browser off one login.
// Raise or lower that with --concurrency=N (1-8) -- the work is nearly all
// waiting on PracticeHub, so more tabs is mostly more waiting in parallel,
// but they are someone else's servers and a migration is no reason to hammer
// them:
//   node migrate-practicehub-attachments.mjs file.csv --practicehub-url=... --concurrency=6
//
// --offset/--limit still slice the patient list, which is occasionally useful
// for picking up a specific range by hand. Running several terminals that way
// is no longer how you go faster, and has a catch: every slice reads and
// writes the same not-found file, so staggered starts matter.
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
import { readFileSync, existsSync, appendFileSync, writeFileSync } from 'node:fs'
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

const limitArg = process.argv.find((a) => a.startsWith('--limit='))
const patientLimit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null
const offsetArg = process.argv.find((a) => a.startsWith('--offset='))
const patientOffset = offsetArg ? parseInt(offsetArg.split('=')[1], 10) : 0

// How many patients to work through at once, in one browser and one login.
//
// This used to be a manual job: the instructions told you to open four
// terminals with --offset/--limit, log into PracticeHub four times, and keep
// four windows alive. That still works and is left in place, but it is no
// longer the way to go faster -- and it had a flaw the comment on
// saveNotFoundIds describes, where the slices fight over one shared file.
//
// Four is a deliberate default rather than a maximum. The work is almost
// entirely waiting on PracticeHub, so more tabs mostly means more waiting in
// parallel -- but they are someone else's servers, and a migration is not a
// reason to hammer them.
const concurrencyArg = process.argv.find((a) => a.startsWith('--concurrency='))
const CONCURRENCY = Math.max(1, Math.min(8, concurrencyArg ? parseInt(concurrencyArg.split('=')[1], 10) : 4))

// A patient whose PracticeHub page misbehaves gets another go before being
// counted as failed. 21 of 135 patients failed on one measured run, nearly
// all of them "locator.click: Timeout 30000ms exceeded" on a table that had
// not finished rendering -- transient, and previously fixable only by running
// the whole script again.
const ATTEMPTS_PER_PATIENT = 2

// --offset/--limit let you split the work across several terminals running
// at once, each with its own PracticeHub login -- e.g. 4 windows with
// --offset=0/250/500/750 --limit=250 each, to get through a large backlog
// faster than one browser can alone. Patients are sorted by id before
// slicing (see main()) so every window's slice lines up with the others'
// and nothing gets double-processed or skipped. Each slice gets its own
// log file so concurrent runs don't interleave into one unreadable file.
const LOG_FILE = join(__dirname, patientOffset || patientLimit ? `migrate-attachments-offset${patientOffset}.log` : 'migrate-attachments.log')

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  appendFileSync(LOG_FILE, line + '\n')
}

// Supabase Storage rejects object keys containing certain non-ASCII
// characters outright ("Invalid key") -- PracticeHub filenames are full of
// them (accented Spanish, enye), same fix as utils/storageFilename.ts in
// the main app, duplicated here since this script runs standalone via
// plain `node`, outside the Nuxt build.
const ACCENT_MAP = {
  á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', ñ: 'n',
  Á: 'A', É: 'E', Í: 'I', Ó: 'O', Ú: 'U', Ü: 'U', Ñ: 'N',
}
function sanitizeStorageFilename(name) {
  const transliterated = name.replace(/[áéíóúüñÁÉÍÓÚÜÑ]/g, (c) => ACCENT_MAP[c] ?? c)
  return transliterated.replace(/[^a-zA-Z0-9._-]/g, '_')
}

// Some patient_files rows point at a filename that's genuinely gone from
// PracticeHub (renamed or deleted there since the CSV was exported) -- not a
// bug in this script, just source data that no longer exists to migrate.
// Once a file is confirmed absent on its patient's own Files tab, its id is
// recorded here so every later run (this is meant to be re-run until clean)
// skips it silently instead of re-discovering and re-warning about the same
// permanently-missing file every time. Shared across --offset slices since
// they all read/write the same file; each save is a full rewrite, so run
// slices with staggered starts rather than perfectly simultaneously if you
// want to avoid one run's confirmation briefly clobbering another's.
const NOT_FOUND_FILE = join(__dirname, 'migrate-attachments-not-found.json')
function loadNotFoundIds() {
  if (!existsSync(NOT_FOUND_FILE)) return new Set()
  try {
    return new Set(JSON.parse(readFileSync(NOT_FOUND_FILE, 'utf8')))
  } catch {
    return new Set()
  }
}
function saveNotFoundIds(ids) {
  writeFileSync(NOT_FOUND_FILE, JSON.stringify([...ids], null, 2))
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

  if (patientOffset || patientLimit) {
    log(`--offset=${patientOffset}${patientLimit ? ` --limit=${patientLimit}` : ''}: processing a slice of patients this run.`)
  }

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
  const allPending = await fetchAll('patient_files', 'id, patient_id, file_name, external_reference', (q) =>
    q.eq('account_id', accountId).is('storage_path', null).not('external_reference', 'is', null),
  )

  const notFoundIds = loadNotFoundIds()
  const pending = allPending.filter((f) => !notFoundIds.has(f.id))
  const alreadyConfirmedMissing = allPending.length - pending.length

  log(`${allPending.length} files still pending${alreadyConfirmedMissing > 0 ? ` (${alreadyConfirmedMissing} already confirmed missing from PracticeHub in a previous run, excluded)` : ''}.`)
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

  const sortedEntries = [...byPatient.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const patientEntries = patientLimit
    ? sortedEntries.slice(patientOffset, patientOffset + patientLimit)
    : sortedEntries.slice(patientOffset)
  const totalFiles = patientEntries.reduce((n, [, f]) => n + f.length, 0)
  log(`Processing ${patientEntries.length} patient(s), ${totalFiles} file(s).`)

  log(`Launching browser. Log into PracticeHub in the window that opens, then come back here.`)
  const browser = await chromium.launch({ headless: false })
  const loginContext = await browser.newContext()
  const loginPage = await loginContext.newPage()
  await loginPage.goto(`${PRACTICEHUB_URL}/patients`)
  await prompt('\nPress Enter once you are logged in and can see the Patients list: ')

  // One login, several workers. The session cookies are copied out of the
  // window you logged into and handed to the other contexts, so you are not
  // asked to log in once per tab.
  //
  // A context each, rather than several pages in one: waitForEvent('page')
  // and waitForEvent('download') below are CONTEXT-scoped, so workers sharing
  // a context would race to claim each other's "View" popups and attach the
  // wrong bytes to the wrong patient's file. Separate contexts make that
  // impossible rather than unlikely.
  const storageState = await loginContext.storageState()
  const workerContexts = [loginContext]
  for (let i = 1; i < CONCURRENCY; i++) workerContexts.push(await browser.newContext({ storageState }))
  if (CONCURRENCY > 1) log(`Working ${CONCURRENCY} patients at a time.`)

  let succeeded = 0
  let failed = 0
  let skipped = 0
  const progress = () => `[${succeeded + failed + skipped}/${totalFiles}]`

  // Opens a patient's record and returns true once their Files tab is showing.
  //
  // Searches on the PracticeHub patient number first -- the CSV carries it as
  // "Patient Unique Identifier" and it is unique, which a surname is not. The
  // old path searched the surname, then clicked through every same-name match
  // comparing phone numbers to work out which one it meant; on a list with
  // four Cañamas that is four page loads to find one patient, and it gave up
  // ("couldn't disambiguate by phone") often enough to matter.
  //
  // The name search is kept as a fallback for a row whose CSV has no number,
  // or a clinic whose patient list does not show the number as a searchable
  // column.
  async function openPatientFiles(page, csvRow, phFirstName, phLastName, phName) {
    const patientNumber = csvRow['Patient Unique Identifier']?.trim()

    async function findRow(term, narrowBy) {
      const searchBox = page.locator('input[type="search"]').first()
      await searchBox.click()
      await searchBox.fill('')
      // .fill() sets the value directly and doesn't reliably fire the keyup
      // DataTables listens for, so the table never actually filters. Typed
      // out, it does. No per-character delay: the listener is debounced on
      // its own and the waits below are what make this deterministic.
      await searchBox.pressSequentially(term)
      let rows = page.locator('table tbody tr', { hasText: term })
      if (narrowBy) rows = rows.filter({ hasText: narrowBy })
      // Wait for the filtered row to exist rather than sleeping and hoping.
      // This is both quicker when the table is fast and reliable when it is
      // slow -- the fixed 800ms it replaces was the cause of a good share of
      // the "Timeout 30000ms" clicks, which were really clicks fired before
      // the table had re-rendered.
      await rows.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
      return rows
    }

    let rows = patientNumber ? await findRow(patientNumber, null) : null
    let rowCount = rows ? await rows.count() : 0

    if (rowCount === 0) {
      // PracticeHub displays (and filters on) "Last, First", not "First
      // Last", so the full name as one ordered string never matches.
      const searchTerm = phLastName || phFirstName
      if (!searchTerm) return false
      rows = await findRow(searchTerm, phLastName && phFirstName ? phFirstName : null)
      rowCount = await rows.count()
    }

    if (rowCount === 0) {
      log(`${progress()} WARN "${phName}" not found in PracticeHub search`)
      return false
    }

    if (rowCount > 1) {
      // Only reachable via the name fallback now -- a patient number matches
      // one row or none. Disambiguate by phone, as before.
      const expectedPhones = phoneByPatientId.get(csvRow.__patientId) ?? []
      let matched = false
      for (let i = 0; i < rowCount; i++) {
        await rows.nth(i).click()
        const contactText = await page
          .locator('text=Mobile')
          .locator('..')
          .innerText({ timeout: 5000 })
          .catch(() => '')
        const digits = contactText.replace(/\D/g, '')
        if (expectedPhones.some((p) => p && digits.includes(p))) {
          matched = true
          break
        }
        await page.locator('button:has-text("✕"), [aria-label="Close"]').first().click().catch(() => {})
      }
      if (!matched) return false
    } else {
      await rows.first().click()
    }

    // Each click waits for what it is about to need, instead of a blanket
    // sleep: .click() already waits for the element to be actionable, so
    // reaching for the next thing is the wait.
    await page.locator('text=Forms & Files').first().click({ timeout: 15000 })
    await page.locator('text=Files').first().click({ timeout: 15000 }).catch(() => {})
    return true
  }

  // One patient, start to finish. Returns counts rather than touching the
  // shared totals, so a retried attempt cannot count the same file twice.
  async function processPatient(context, page, patientId, files) {
    const patient = patientById.get(patientId)
    const csvRow0 = files[0].csvRow
    const phFirstName = csvRow0['Patient First Name']?.trim() ?? ''
    const phLastName = csvRow0['Patient Last Name']?.trim() ?? ''
    const phName = `${phFirstName} ${phLastName}`.trim()
    csvRow0.__patientId = patientId
    const counts = { ok: 0, bad: 0, skip: 0 }

    log(`${progress()} --- ${phName} (QuiroFlow: ${patient.first_name} ${patient.last_name ?? ''}) — ${files.length} file(s)`)
    await page.goto(`${PRACTICEHUB_URL}/patients`)

    const opened = await openPatientFiles(page, csvRow0, phFirstName, phLastName, phName)
    if (!opened) {
      counts.skip += files.length
      log(`${progress()} WARN could not open "${phName}" in PracticeHub, skipping ${files.length} file(s)`)
      return counts
    }

    // A patient can legitimately have zero files in PracticeHub (the CSV's
    // per-file metadata rows sometimes outlive the files themselves being
    // removed there) -- not a mismatch worth a WARN. DataTables renders one
    // placeholder row ("No data available in table") rather than zero rows
    // when empty, so check for that too.
    const filesTableRows = page.locator('table tbody tr')
    const filesTableRowCount = await filesTableRows.count()
    const filesTableEmpty =
      filesTableRowCount === 0 ||
      (filesTableRowCount === 1 && /no (data|files|records)/i.test(await filesTableRows.first().innerText().catch(() => '')))
    if (filesTableEmpty) {
      counts.skip += files.length
      log(`${progress()} ${phName} has no attachments in PracticeHub, skipping ${files.length} file(s) (nothing to migrate, not an error)`)
      return counts
    }

    for (const { file, csvRow } of files) {
      // Already done on an earlier attempt for this same patient. Patient-level
      // failures are raised before any upload starts, so this should not
      // trigger -- but a retry that re-uploaded would leave two copies in
      // storage and no way to tell which the patient_files row points at.
      if (file.storage_path) continue
      try {
        const fileRow = page.locator('tr', { hasText: csvRow['Filename'].trim() }).first()
        const viewLink = fileRow.locator('a:has-text("View")').first()
        if ((await viewLink.count()) === 0) {
          counts.skip++
          notFoundIds.add(file.id)
          saveNotFoundIds(notFoundIds)
          log(`${progress()} WARN "${csvRow['Filename']}" not found on ${phName}'s Files tab -- recording as permanently missing, future runs won't re-check it`)
          continue
        }

        // "View" usually opens a new tab at a signed URL the browser can
        // render (PDF, JPG...), but for a format Chromium can't display
        // inline -- HEIC being the one that's shown up -- it instead
        // triggers a native download and the tab never navigates anywhere
        // fetchable. Race both possible events and branch on whichever fires.
        const [event] = await Promise.all([
          Promise.race([
            context.waitForEvent('page').then((value) => ({ kind: 'page', value })),
            context.waitForEvent('download').then((value) => ({ kind: 'download', value })),
          ]),
          viewLink.click(),
        ])

        let buffer
        if (event.kind === 'download') {
          const downloadPath = await event.value.path()
          buffer = readFileSync(downloadPath)
        } else {
          const newPage = event.value
          await newPage.waitForLoadState('domcontentloaded').catch(() => {})
          const signedUrl = newPage.url()
          await newPage.close()
          if (!signedUrl || signedUrl === 'about:blank') throw new Error('no viewable URL opened for this file')

          const res = await fetch(signedUrl)
          if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
          buffer = Buffer.from(await res.arrayBuffer())
        }

        const storagePath = `${accountId}/${patientId}/${Date.now()}-${sanitizeStorageFilename(file.file_name)}`
        const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, buffer, {
          contentType: csvRow['Mime Type']?.trim() || 'application/octet-stream',
        })
        if (uploadError) throw new Error(`upload failed: ${uploadError.message}`)

        const { error: updateError } = await supabase.from('patient_files').update({ storage_path: storagePath }).eq('id', file.id)
        if (updateError) throw new Error(`db update failed: ${updateError.message}`)

        file.storage_path = storagePath
        counts.ok++
        log(`${progress()} OK ${phName}: ${file.file_name} (${buffer.length} bytes)`)
      } catch (err) {
        counts.bad++
        log(`${progress()} ERROR ${phName}: ${file.file_name}: ${err.message}`)
      }
    }

    await page.locator('button:has-text("✕"), [aria-label="Close"]').first().click().catch(() => {})
    return counts
  }

  // Shared queue. JavaScript is single-threaded, so handing out the next
  // index needs no lock -- nothing can interleave between reading and
  // incrementing it.
  let nextIndex = 0
  async function worker(context) {
    const page = context.pages()[0] ?? (await context.newPage())
    while (nextIndex < patientEntries.length) {
      const [patientId, files] = patientEntries[nextIndex++]
      let counts = null
      for (let attempt = 1; attempt <= ATTEMPTS_PER_PATIENT; attempt++) {
        try {
          counts = await processPatient(context, page, patientId, files)
          break
        } catch (err) {
          if (attempt < ATTEMPTS_PER_PATIENT) {
            log(`${progress()} RETRY ${files.length} file(s) for patient ${patientId}: ${err.message}`)
            continue
          }
          failed += files.length
          log(`${progress()} ERROR processing patient ${patientId} after ${ATTEMPTS_PER_PATIENT} attempts: ${err.message}`)
        }
      }
      if (counts) {
        succeeded += counts.ok
        failed += counts.bad
        skipped += counts.skip
      }
    }
  }

  await Promise.all(workerContexts.map((context) => worker(context)))

  await browser.close()
  log(`Done. Succeeded: ${succeeded}, Failed: ${failed}, Skipped: ${skipped}. See ${LOG_FILE} for details.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
