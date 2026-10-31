// Captures the listing screenshots from a running app seeded by
// scripts/seed-demo-clinic.ts (see README.md beside this file):
//
//   BASE_URL=http://localhost:3000 node marketing/screenshots/capture.mjs <outDir> <seed-output.json>
//
// Needs playwright-core (npm i --no-save playwright-core) and a local Chrome;
// CHROME_PATH overrides where it is. The browser's clock is frozen at the
// seed's DEMO_DAY, 10:18, in Madrid, and the locale is Spanish.
import fs from 'node:fs'
import { chromium } from 'playwright-core'
import sharp from 'sharp'

const [out, seedOutput] = process.argv.slice(2)
if (!out || !seedOutput) {
  console.error('usage: node marketing/screenshots/capture.mjs <outDir> <seed-output.json>')
  process.exit(1)
}
const seed = JSON.parse(fs.readFileSync(seedOutput, 'utf8'))
const ids = seed.patients
const BASE = process.env.BASE_URL || 'http://localhost:3000'
const FREEZE = new Date(seed.freezeBrowserAt)
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const HIDE = '#nuxt-devtools-container, nuxt-devtools-frame, [id^=nuxt-devtools]{display:none!important}'
const scrollBy = (n) => `(() => { let el = document.elementFromPoint(1000, 700); while (el && !(el.scrollHeight > el.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement; if (el) el.scrollTop += ${n} })()`
const scrollTo = (text, offset) => `((text, offset) => { const target = [...document.querySelectorAll('h2,h3,p,span,div')].find((e) => e.childElementCount === 0 && e.textContent.trim() === text); let el = target; while (el && !(el.scrollHeight > el.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement; if (el && target) el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top - offset })(${JSON.stringify(text)}, ${offset})`
const browser = await chromium.launch({ executablePath: CHROME, headless: true })

async function session(email, viewport, loginPath) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'es-ES', timezoneId: 'Europe/Madrid' })
  await ctx.addInitScript(() => {
    localStorage.setItem('quiroflow-calendar-view-mode', 'day')
    localStorage.setItem('quiroflow-calendar-practitioner', '__all')
  })
  const page = await ctx.newPage()
  await page.clock.setFixedTime(FREEZE)
  await page.goto(BASE + loginPath)
  await page.waitForTimeout(4000)
  await page.fill('input[type=email]', email)
  await page.fill('input[type=password]', seed.password)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(8000)
  return page
}
async function shot(page, file, path, { wait = 9000, clicks = [], script = '' } = {}) {
  await page.goto(BASE + path)
  await page.waitForTimeout(wait)
  await page.addStyleTag({ content: HIDE })
  for (const sel of clicks) { await page.locator(sel).first().click(); await page.waitForTimeout(3000) }
  if (script) { await page.evaluate(script); await page.waitForTimeout(2000) }
  await page.mouse.move(1599, 999)
  await page.screenshot({ path: file })
  console.log('saved', file)
}

const staff = await session(seed.staff[0], { width: 1600, height: 1000 }, '/login')
await shot(staff, `${out}/01-calendar-rooms-practitioners.png`, '/calendar', { script: scrollBy(120) })
await shot(staff, `${out}/02-patient-record-care-plan.png`, `/patients/${ids.carePlanBehind}`)
await shot(staff, `${out}/03-whatsapp-inbox.png`, '/inbox', { wait: 14000, clicks: ['text=Ahora no', 'text=Carmen Vidal Soler'] })
await shot(staff, `${out}/04-session-package-billing.png`, `/patients/${ids.bono}?tab=billing`, { clicks: ['text=Facturas y recibos'], script: scrollTo('Bonos', 40) })
await shot(staff, `${out}/05-posture-analysis.png`, `/patients/${ids.posture}?tab=progress`, { wait: 16000, script: scrollTo('Postura', 14) })
await shot(staff, `${out}/06-retention-report.png`, '/reports/retention', { wait: 12000 })

const patient = await session(seed.patientApp, { width: 430, height: 932 }, '/portal/login')
const phones = []
for (const p of ['/portal', '/portal/appointments', '/portal/messages']) {
  const f = `${out}/.phone-${phones.length}.png`
  await shot(patient, f, p, { wait: 14000 })
  phones.push(f)
}
await browser.close()

// The patient app: three phone screens side by side on the brand colour.
const W = 1600, H = 1000, sw = 396, sh = Math.round((932 * sw) / 430), pad = 14, gap = 84
const pw = sw + pad * 2, ph = sh + pad * 2
const x0 = Math.round((W - (pw * 3 + gap * 2)) / 2), y0 = Math.round((H - ph) / 2)
const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f46e5"/><stop offset="1" stop-color="#7c74f0"/></linearGradient><filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#1e1b4b" flood-opacity="0.35"/></filter></defs><rect width="100%" height="100%" fill="url(#g)"/>${[0, 1, 2].map((i) => `<rect x="${x0 + i * (pw + gap)}" y="${y0}" width="${pw}" height="${ph}" rx="52" fill="#0f172a" filter="url(#s)"/>`).join('')}</svg>`
const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${sw}" height="${sh}"><rect width="${sw}" height="${sh}" rx="40" fill="#fff"/></svg>`)
const screens = await Promise.all(phones.map((f) => sharp(f).resize(sw, sh).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()))
await sharp(Buffer.from(bg)).composite(screens.map((b, i) => ({ input: b, left: x0 + i * (pw + gap) + pad, top: y0 + pad }))).png().toFile(`${out}/07-patient-app.png`)
for (const f of phones) fs.unlinkSync(f)
console.log('saved', `${out}/07-patient-app.png`)
