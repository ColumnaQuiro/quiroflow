// Records the listing demo video from a running app seeded by
// scripts/seed-demo-clinic.ts (see README.md beside this file):
//
//   BASE_URL=http://localhost:3000 node marketing/video/record.mjs <seed-output.json> [outDir]
//
// Needs playwright-core and an ffmpeg with libx264 (npm i --no-save
// playwright-core ffmpeg-static covers both), plus a local Chrome; CHROME_PATH
// and FFMPEG override where they are. The browser's clock is frozen at the
// seed's DEMO_DAY, 10:18, in Madrid, and the locale is Spanish.
//
// Each scene is filmed through Chrome's screencast at device pixels (the UI is
// 1366x768 CSS px drawn at 1600x900), keeping only the stretches marked with
// keep() -- page loads happen between them and never reach the video. ffmpeg
// then frames every scene on the brand colour with its caption underneath and
// crossfades them into one H.264 file, plus a poster frame.
//
// It books, sells and confirms things as it goes, so reseed before every run.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { chromium } from 'playwright-core'
import sharp from 'sharp'

const [seedOutput, outArg] = process.argv.slice(2)
if (!seedOutput) {
  console.error('usage: node marketing/video/record.mjs <seed-output.json> [outDir]')
  process.exit(1)
}
const OUT = outArg || 'marketing/video'
const seed = JSON.parse(fs.readFileSync(seedOutput, 'utf8'))
const ids = seed.patients
const BASE = process.env.BASE_URL || 'http://localhost:3000'
const FREEZE = new Date(seed.freezeBrowserAt)
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const FFMPEG = process.env.FFMPEG || ffmpegPath()
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'quiroflow-video-'))
// A few hundred MB of frames; gone however the run ends.
process.on('exit', () => fs.rmSync(WORK, { recursive: true, force: true }))
const FPS = 30
const XFADE = 0.5

// The frame: 1920x1080, the UI at 1600x900 near the top, the caption below.
const W = 1920, H = 1080
const UI = { w: 1600, h: 900, x: 160, y: 34 }
const DESKTOP = { width: 1366, height: 768 }
const PHONE = { width: 414, height: 896, scale: 2 }
const PHONE_SCREEN = { h: 864, w: Math.round((414 / 896) * 864) }

const SCENES = [
  { key: 'calendar', caption: 'One calendar for every room and practitioner — book a free slot in seconds' },
  { key: 'care-plan', caption: 'Spot patients falling behind their care plan, and book every visit left in one go' },
  { key: 'inbox', caption: 'WhatsApp reminders, confirmations and AI receptionist replies in one inbox' },
  { key: 'bono', caption: 'Sell a session package and its factura is issued on the spot' },
  { key: 'posture', caption: 'Posture photos with reference points, compared before and after' },
  { key: 'app', caption: 'Patients see their next visit, confirm it and track their sessions in the app' },
]

function ffmpegPath() {
  const onPath = spawnSync('ffmpeg', ['-version'])
  if (onPath.status === 0) return 'ffmpeg'
  try {
    return createRequire(import.meta.url)('ffmpeg-static')
  } catch {
    console.error('No ffmpeg: install one, or npm i --no-save ffmpeg-static, or set FFMPEG.')
    process.exit(1)
  }
}
function ff(args) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] })
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// --- in the page: a drawn cursor (or a fingertip on the phone) and click ripples

function pointerScript({ touch }) {
  const KEY = 'demo-pointer'
  const saved = JSON.parse(sessionStorage.getItem(KEY) || 'null') || { x: -80, y: -80 }
  let el = null
  const place = (x, y) => {
    saved.x = x
    saved.y = y
    if (el) el.style.transform = touch ? `translate(${x - 18}px, ${y - 18}px)` : `translate(${x - 3}px, ${y - 2}px)`
  }
  const mount = () => {
    if (el && el.isConnected) return
    el = document.createElement('div')
    el.setAttribute('aria-hidden', 'true')
    el.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transition:opacity .2s'
    el.innerHTML = touch
      ? '<div style="width:36px;height:36px;border-radius:50%;background:rgba(15,23,42,.22);border:2px solid rgba(255,255,255,.9);box-shadow:0 2px 8px rgba(15,23,42,.25)"></div>'
      : '<svg width="28" height="28" viewBox="0 0 24 24" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))"><path d="M3 2 L3 19.5 L7.6 15.3 L10.5 21.8 L13.4 20.5 L10.6 14.2 L16.8 14.2 Z" fill="#0f172a" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>'
    document.documentElement.appendChild(el)
    const style = document.createElement('style')
    style.textContent = '#nuxt-devtools-container, nuxt-devtools-frame, [id^=nuxt-devtools]{display:none!important} @keyframes demo-ripple{from{transform:scale(.3);opacity:.55}to{transform:scale(2.6);opacity:0}}'
    document.documentElement.appendChild(style)
    place(saved.x, saved.y)
  }
  addEventListener('mousemove', (e) => {
    mount()
    place(e.clientX, e.clientY)
    sessionStorage.setItem(KEY, JSON.stringify(saved))
  }, true)
  addEventListener('mousedown', (e) => {
    const r = document.createElement('div')
    r.style.cssText = `position:fixed;left:${e.clientX - 18}px;top:${e.clientY - 18}px;width:36px;height:36px;border-radius:50%;background:rgba(79,70,229,.45);pointer-events:none;z-index:2147483646;animation:demo-ripple .55s ease-out forwards`
    document.documentElement.appendChild(r)
    setTimeout(() => r.remove(), 600)
  }, true)
  addEventListener('DOMContentLoaded', mount)
  setInterval(mount, 500)
}

// --- driving the page at a human pace

const pointers = new WeakMap()
async function glide(page, x, y, ms = 550) {
  const from = pointers.get(page) || { x: x - 200, y: y + 120 }
  const steps = Math.max(8, Math.round(ms / 16))
  for (let i = 1; i <= steps; i++) {
    const p = i / steps
    const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
    await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e)
    await sleep(14)
  }
  pointers.set(page, { x, y })
}
async function park(page, x, y) {
  await page.mouse.move(x, y)
  pointers.set(page, { x, y })
}
async function clickAt(page, x, y, { ms, after = 500 } = {}) {
  await glide(page, x, y, ms)
  await sleep(120)
  await page.mouse.down()
  await sleep(90)
  await page.mouse.up()
  await sleep(after)
}
async function click(page, locator, opts = {}) {
  const target = locator.first()
  await target.scrollIntoViewIfNeeded()
  const b = await target.boundingBox()
  if (!b) throw new Error(`not visible: ${locator}`)
  await clickAt(page, b.x + b.width * (opts.fx ?? 0.5), b.y + b.height / 2, opts)
}
async function hover(page, locator, ms) {
  const b = await locator.first().boundingBox()
  await glide(page, b.x + b.width / 2, b.y + b.height / 2, ms)
}
// Eases the scrollable element under (x, y) by dy, or so `text` (or the element
// `sel`) lands `offset` px below its top.
async function scroll(page, { x, y, dy, text, sel, offset = 40, ms = 1100 }) {
  if (text || sel) {
    await page.waitForFunction(
      ({ text, sel }) => (sel ? document.querySelector(sel) : [...document.querySelectorAll('body *')].some((e) => e.childElementCount === 0 && e.textContent.trim() === text && e.getClientRects().length)),
      { text, sel },
      { timeout: 20000 },
    )
  }
  await page.evaluate(
    ({ x, y, dy, text, sel, offset, ms }) =>
      new Promise((done) => {
        const scrollable = (el) => {
          while (el && !(el.scrollHeight > el.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement
          return el || document.scrollingElement
        }
        let el, by = dy
        if (text || sel) {
          const target = sel
            ? document.querySelector(sel)
            : [...document.querySelectorAll('body *')].find((e) => e.childElementCount === 0 && e.textContent.trim() === text && e.getClientRects().length)
          el = scrollable(target)
          by = target.getBoundingClientRect().top - (el === document.scrollingElement ? 0 : el.getBoundingClientRect().top) - offset
        } else el = scrollable(document.elementFromPoint(x, y))
        const start = el.scrollTop, t0 = performance.now()
        const step = (t) => {
          const p = Math.min(1, (t - t0) / ms)
          el.scrollTop = start + by * (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2)
          if (p < 1) requestAnimationFrame(step)
          else done()
        }
        requestAnimationFrame(step)
      }),
    { x, y, dy, text, sel, offset, ms },
  )
}
async function type(page, locator, text) {
  await click(page, locator, { after: 250 })
  await locator.first().pressSequentially(text, { delay: 80 })
}
// Loaded: no skeleton or spinner left, then a moment for images and fonts.
async function settle(page, extra = 1200) {
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  await page
    .waitForFunction(() => ![...document.querySelectorAll('.skeleton-shimmer,.animate-pulse,.animate-spin')].some((e) => e.getClientRects().length), null, { timeout: 90000 })
    .catch(() => console.warn('  still loading after 90 s:', page.url()))
  await sleep(extra)
}
async function go(page, p) {
  await page.goto(BASE + p, { timeout: 90000 })
  await settle(page)
}
// The calendar grid: scroll so `hm` sits near the top; the point of a slot.
async function gridTo(page, hm, offset = 40) {
  await page.evaluate(({ hm, offset }) => {
    const s = document.querySelector('[data-cy=grid-scroller]')
    const label = [...s.querySelectorAll('*')].find((e) => e.childElementCount === 0 && e.textContent.trim() === hm)
    s.scrollTop += label.getBoundingClientRect().top - s.getBoundingClientRect().top - offset
  }, { hm, offset })
}
async function slot(page, room, hm) {
  return page.evaluate(({ room, hm }) => {
    const s = document.querySelector('[data-cy=grid-scroller]')
    const label = [...s.querySelectorAll('*')].find((e) => e.childElementCount === 0 && e.textContent.trim() === hm)
    const head = [...document.querySelectorAll('[data-cy=day-column-head]')].find((e) => e.textContent.includes(room)).getBoundingClientRect()
    return { x: head.left + head.width / 2, y: label.getBoundingClientRect().top + 14 }
  }, { room, hm })
}

// --- filming: Chrome's screencast, with the stretches to keep

class Camera {
  constructor(page, name, size) {
    this.page = page
    this.dir = path.join(WORK, name)
    this.size = size
    this.frames = []
    fs.mkdirSync(this.dir)
  }
  async start() {
    this.cdp = await this.page.context().newCDPSession(this.page)
    this.cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      this.cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
      const file = path.join(this.dir, `${String(this.frames.length).padStart(6, '0')}.jpg`)
      fs.writeFileSync(file, Buffer.from(data, 'base64'))
      this.frames.push({ t: metadata.timestamp, file })
    })
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: this.size.w, maxHeight: this.size.h, everyNthFrame: 1 })
  }
  async stop() {
    await this.cdp.send('Page.stopScreencast').catch(() => {})
  }
}
// ONLY=calendar,inbox films just those scenes -- for working on one; the
// listing video is always the whole run.
const ONLY = process.env.ONLY?.split(',')
const want = (key) => !ONLY || ONLY.includes(key)
const scenes = Object.fromEntries(SCENES.map((s) => [s.key, { ...s, parts: [] }]))
let rolling = null
function keep(camera, scene) {
  rolling = { camera, scene, start: Date.now() / 1000 }
}
async function cut() {
  await sleep(250)
  scenes[rolling.scene].parts.push({ camera: rolling.camera, start: rolling.start, end: Date.now() / 1000 - 0.25 })
  rolling = null
}

// --- the browser

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
async function session({ email, loginPath, viewport, scale, touch }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, locale: 'es-ES', timezoneId: 'Europe/Madrid', permissions: ['notifications'] })
  await ctx.addInitScript(() => {
    localStorage.setItem('quiroflow-calendar-view-mode', 'day')
    localStorage.setItem('quiroflow-calendar-practitioner', '__all')
  })
  await ctx.addInitScript(pointerScript, { touch })
  const page = await ctx.newPage()
  await page.clock.setFixedTime(FREEZE)
  await go(page, loginPath)
  await page.fill('input[type=email]', email)
  await page.fill('input[type=password]', seed.password)
  await page.keyboard.press('Enter')
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 60000 })
  await settle(page)
  return page
}

const desk = await session({ email: seed.staff[0], loginPath: '/login', viewport: DESKTOP, scale: UI.w / DESKTOP.width })
const phone = await session({ email: seed.patientApp, loginPath: '/portal/login', viewport: { width: PHONE.width, height: PHONE.height }, scale: PHONE.scale, touch: true })

// A first visit to each page compiles it on a dev server; do that unfilmed.
console.log('warming up')
for (const p of ['/calendar', `/patients/${ids.carePlanBehind}`, '/inbox', `/patients/${ids.bonoBuyer}?tab=billing`, `/patients/${ids.posture}?tab=progress`]) await go(desk, p)
for (const p of ['/portal/appointments', '/portal']) await go(phone, p)

const deskCam = new Camera(desk, 'desk', { w: UI.w, h: UI.h })
const phoneCam = new Camera(phone, 'phone', { w: PHONE.width * PHONE.scale, h: PHONE.height * PHONE.scale })
await deskCam.start()
await phoneCam.start()

// 1. The calendar: three rooms, three practitioners; book the 17:00 Carmen freed.
if (want('calendar')) {
  console.log('1 calendar')
  await go(desk, '/calendar')
  await gridTo(desk, '09:00', 30)
  await park(desk, 1180, 640)
  await sleep(600)
  keep(deskCam, 'calendar')
  await sleep(1200)
  await hover(desk, desk.locator('[data-cy=day-column-head]', { hasText: 'Sala 3' }), 900)
  await scroll(desk, { x: 900, y: 600, dy: 0, text: '16:00', offset: 30, ms: 1100 })
  await sleep(300)
  const s1 = await slot(desk, 'Sala 2', '17:00')
  await clickAt(desk, s1.x, s1.y, { after: 900 })
  await type(desk, desk.locator('[data-cy=create-patient-search] input, input[data-cy=create-patient-search]'), 'Nuria')
  await sleep(500)
  await click(desk, desk.locator('[data-cy=create-patient-result]'), { after: 400 })
  await click(desk, desk.locator('[data-cy=create-sheet] button', { hasText: 'Fisioterapia' }), { after: 250 })
  await click(desk, desk.locator('[data-cy=create-sheet] button', { hasText: 'Álex Prieto' }), { after: 300 })
  await scroll(desk, { sel: '[data-cy=create-free]', offset: 260, ms: 800 })
  await sleep(1100)
  await click(desk, desk.locator('[data-cy=create-submit]'), { after: 1900 })
  await cut()
}

// 2. Marta's care plan is behind with nothing booked: book the seven visits left,
// Mondays and Thursdays at 17:30 (17:00 clashes on the Thursday).
if (want('care-plan')) {
  console.log('2 care plan')
  await go(desk, `/patients/${ids.carePlanBehind}`)
  await park(desk, 1000, 330)
  keep(deskCam, 'care-plan')
  await sleep(900)
  await hover(desk, desk.getByText('Con retraso', { exact: true }), 700)
  await sleep(700)
  await click(desk, desk.getByText('Reservar las 7 visitas que faltan'), { after: 200 })
  await cut()
  await settle(desk)
  keep(deskCam, 'care-plan')
  await sleep(700)
  await click(desk, desk.locator('button[aria-label="Mes siguiente"]:visible'), { after: 300 })
  const monday = await desk.evaluate(() => {
    let box = [...document.querySelectorAll('*')].find((e) => e.childElementCount === 0 && /noviembre de 2026/.test(e.textContent))
    while (box && ![...box.querySelectorAll('button')].some((b) => b.textContent.trim() === '2')) box = box.parentElement
    const r = [...box.querySelectorAll('button')].find((b) => b.textContent.trim() === '2').getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await clickAt(desk, monday.x, monday.y, { after: 200 })
  await cut()
  await settle(desk)
  await gridTo(desk, '16:00', 30)
  await sleep(400)
  keep(deskCam, 'care-plan')
  await sleep(300)
  const s2 = await slot(desk, 'Sala 1', '17:30')
  await clickAt(desk, s2.x, s2.y, { after: 800 })
  await click(desk, desk.locator('[data-cy=create-sheet] button', { hasText: 'Ajuste quiropráctico' }), { after: 250 })
  await click(desk, desk.locator('[data-cy=create-sheet] button', { hasText: 'Sara Molina' }), { after: 300 })
  await scroll(desk, { x: 1400, y: 500, dy: 0, text: 'Más opciones', offset: 120, ms: 800 })
  await click(desk, desk.locator('[data-cy=create-more] summary'), { after: 300 })
  await scroll(desk, { x: 1400, y: 500, dy: 0, text: 'Más opciones', offset: 60, ms: 600 })
  await hover(desk, desk.locator('[data-cy=create-more] select'), 500)
  await sleep(1300)
  await click(desk, desk.locator('[data-cy=create-submit]'), { after: 1900 })
  await cut()
  await go(desk, `/patients/${ids.carePlanBehind}`)
  await park(desk, 1000, 330)
  keep(deskCam, 'care-plan')
  await sleep(400)
  await hover(desk, desk.getByText('Próxima cita', { exact: true }), 600)
  await sleep(1800)
  await cut()
}

// 3. The inbox: Irene confirms from her reminder; the AI receptionist moves Carmen.
if (want('inbox')) {
  console.log('3 inbox')
  await go(desk, '/inbox')
  await park(desk, 900, 600)
  keep(deskCam, 'inbox')
  await sleep(1000)
  await click(desk, desk.getByText('Irene Lozano Vera', { exact: true }), { after: 2600 })
  await click(desk, desk.getByText('Carmen Vidal Soler', { exact: true }), { after: 900 })
  await glide(desk, 1050, 480, 900)
  await sleep(2600)
  await cut()
}

// 4. Nuria buys the 10-session bono she asked about, by card; its factura.
if (want('bono')) {
  console.log('4 bono')
  await go(desk, `/patients/${ids.bonoBuyer}?tab=billing`)
  await scroll(desk, { x: 900, y: 500, dy: 0, text: 'Bonos', offset: 300, ms: 10 })
  await park(desk, 900, 360)
  await sleep(500)
  keep(deskCam, 'bono')
  await sleep(900)
  const bonoSelect = desk.locator('select:has(option:text-is("Vender un bono…"))').first()
  await click(desk, bonoSelect, { after: 300 })
  await bonoSelect.selectOption({ label: 'Bono 10 sesiones (10, 380,00 €)' })
  await sleep(900)
  const method = desk.locator('select:has(option:text-is("Efectivo"))').first()
  await click(desk, method, { after: 300 })
  await method.selectOption({ label: 'Tarjeta' })
  await sleep(700)
  await click(desk, desk.getByRole('button', { name: 'Vender', exact: true }), { after: 2200 })
  await scroll(desk, { x: 900, y: 500, dy: 0, text: 'Facturas y recibos', offset: 250, ms: 1200 })
  await click(desk, desk.getByText('Facturas y recibos', { exact: true }), { after: 900 })
  await scroll(desk, { x: 900, y: 500, dy: 0, text: 'Facturas', offset: 160, ms: 900 })
  const row = await desk.getByText(/^F-2026-/).first().boundingBox()
  await glide(desk, row.x + 620, row.y + 30, 800)
  await sleep(2400)
  await cut()
}

// 5. Daniel's posture: reference points, and eight weeks apart side by side.
if (want('posture')) {
  console.log('5 posture')
  await go(desk, `/patients/${ids.posture}?tab=progress`)
  await park(desk, 900, 400)
  keep(deskCam, 'posture')
  await sleep(900)
  await scroll(desk, { x: 900, y: 500, dy: 0, text: 'Postura', offset: 14, ms: 1300 })
  await hover(desk, desk.getByText('Peso efectivo de la cabeza', { exact: false }), 700)
  await sleep(1200)
  await scroll(desk, { text: 'Postura', offset: -190, ms: 1000 })
  await sleep(500)
  await click(desk, desk.getByRole('button', { name: 'Frente', exact: true }), { after: 1700 })
  await click(desk, desk.getByRole('button', { name: 'Espalda', exact: true }), { after: 1700 })
  await click(desk, desk.getByRole('button', { name: 'Lado derecho', exact: true }), { after: 1500 })
  await cut()
}

// 6. Alba's app: next visit and sessions left; she confirms next week's visit.
if (want('app')) {
  console.log('6 app')
  await go(phone, '/portal')
  await park(phone, 300, 700)
  keep(phoneCam, 'app')
  await sleep(2200)
  await hover(phone, phone.getByText('Sesiones restantes', { exact: false }), 700)
  await sleep(1200)
  await click(phone, phone.getByText('Ver todas las citas', { exact: false }), { after: 200 })
  await cut()
  await settle(phone)
  keep(phoneCam, 'app')
  await sleep(1000)
  await click(phone, phone.getByText('Confirmar asistencia', { exact: true }), { after: 2600 })
  await cut()
}

await deskCam.stop()
await phoneCam.stop()
await sleep(500)

// --- titles and captions, drawn by the browser in the app's own typeface

const font = (f) => fs.readFileSync(new URL(`../../public/fonts/${f}`, import.meta.url)).toString('base64')
const css = `@font-face{font-family:'Instrument Sans';src:url(data:font/woff2;base64,${font('instrument-sans-latin.woff2')}) format('woff2');font-weight:400 700}
@font-face{font-family:'Instrument Sans';src:url(data:font/woff2;base64,${font('instrument-sans-latin-ext.woff2')}) format('woff2');font-weight:400 700;unicode-range:U+0100-02AF,U+2000-206F}
*{margin:0;box-sizing:border-box} body{font-family:'Instrument Sans',system-ui,sans-serif;-webkit-font-smoothing:antialiased}`
const logo = fs.readFileSync(new URL('../../public/logo/quiroflow-lockup-white.svg', import.meta.url), 'utf8')
const logoAt = (h) => logo.replace(/ width="\d+" height="\d+"/, ` height="${h}"`)
const painter = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage()
async function paint(file, html, { transparent = false, size } = {}) {
  await painter.setViewportSize(size || { width: W, height: H })
  await painter.setContent(`<style>${css}</style>${html}`)
  await painter.evaluate(() => document.fonts.ready)
  await painter.screenshot({ path: file, omitBackground: transparent })
}
const BRAND = 'linear-gradient(135deg,#4f46e5 0%,#6d64ee 55%,#8b84f3 100%)'
const card = (inner) => `<div style="width:${W}px;height:${H}px;background:${BRAND};display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;text-align:center">${inner}</div>`
await paint(path.join(WORK, 'intro.png'), card(`<div style="height:170px;display:flex">${logoAt(170)}</div><p style="margin-top:44px;font-size:46px;font-weight:600;letter-spacing:-.01em">Practice management for physio, chiro, osteo and podiatry clinics</p>`))
await paint(path.join(WORK, 'outro.png'), card(`<div style="height:150px;display:flex">${logoAt(150)}</div><p style="margin-top:44px;font-size:52px;font-weight:600">quiroflow.com</p><p style="margin-top:18px;font-size:30px;opacity:.85">Calendar · Patient records · WhatsApp · Billing &amp; VeriFactu · Patient app</p>`))
for (const s of SCENES) {
  await paint(path.join(WORK, `caption-${s.key}.png`), `<div style="width:${W}px;height:${H - UI.y - UI.h}px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:40px;font-weight:600;letter-spacing:-.005em;text-shadow:0 2px 12px rgba(30,27,75,.35)">${s.caption}</div>`, { transparent: true, size: { width: W, height: H - UI.y - UI.h } })
}
await browser.close()

// The backdrop each scene sits on, and the masks that round the screens' corners.
const bgSvg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f46e5"/><stop offset=".55" stop-color="#6d64ee"/><stop offset="1" stop-color="#8b84f3"/></linearGradient><filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="16" stdDeviation="22" flood-color="#1e1b4b" flood-opacity="0.35"/></filter></defs><rect width="100%" height="100%" fill="url(#g)"/>${inner}</svg>`
const PH = { w: PHONE_SCREEN.w, h: PHONE_SCREEN.h, pad: 14 }
PH.x = Math.round((W - PH.w) / 2)
PH.y = UI.y + Math.round((UI.h - PH.h) / 2)
await sharp(Buffer.from(bgSvg(`<rect x="${UI.x}" y="${UI.y}" width="${UI.w}" height="${UI.h}" rx="18" fill="#fff" filter="url(#s)"/>`))).png().toFile(path.join(WORK, 'bg-desk.png'))
await sharp(Buffer.from(bgSvg(`<rect x="${PH.x - PH.pad}" y="${PH.y - PH.pad}" width="${PH.w + PH.pad * 2}" height="${PH.h + PH.pad * 2}" rx="56" fill="#0f172a" filter="url(#s)"/>`))).png().toFile(path.join(WORK, 'bg-phone.png'))
const mask = (w, h, r) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#000"/><rect width="${w}" height="${h}" rx="${r}" fill="#fff"/></svg>`)).grayscale().png()
await mask(UI.w, UI.h, 18).toFile(path.join(WORK, 'mask-desk.png'))
await mask(PH.w, PH.h, 42).toFile(path.join(WORK, 'mask-phone.png'))

// --- cutting and framing each scene

function concatList(parts, file) {
  const lines = []
  let total = 0
  for (const { camera, start, end } of parts) {
    const frames = camera.frames
    let i = frames.findLastIndex((f) => f.t <= start)
    if (i < 0) i = 0
    let t = start
    for (; i < frames.length && t < end; i++) {
      const until = Math.min(end, frames[i + 1]?.t ?? end)
      if (until > t) {
        lines.push(`file '${frames[i].file}'`, `duration ${(until - t).toFixed(4)}`)
        total += until - t
        t = until
      }
    }
  }
  // The concat demuxer drops the last entry's duration; repeat it.
  lines.push(lines.at(-2))
  fs.writeFileSync(file, lines.join('\n') + '\n')
  return total
}
const clips = []
for (const s of SCENES.filter((s) => want(s.key))) {
  const scene = scenes[s.key]
  const list = path.join(WORK, `${s.key}.txt`)
  const dur = concatList(scene.parts, list)
  const isPhone = scene.parts[0].camera === phoneCam
  const clip = path.join(WORK, `${s.key}.mp4`)
  const [bg, msk, x, y, scale] = isPhone
    ? ['bg-phone.png', 'mask-phone.png', PH.x, PH.y, `scale=${PH.w}:${PH.h}:flags=lanczos,`]
    : ['bg-desk.png', 'mask-desk.png', UI.x, UI.y, `scale=${UI.w}:${UI.h},`]
  ff([
    '-f', 'concat', '-safe', '0', '-i', list,
    '-loop', '1', '-i', path.join(WORK, bg),
    '-loop', '1', '-i', path.join(WORK, msk),
    '-loop', '1', '-i', path.join(WORK, `caption-${s.key}.png`),
    '-filter_complex',
    `[0:v]fps=${FPS},${scale}format=rgba[ui];[2:v]format=gray[m];[ui][m]alphamerge[r];` +
      `[1:v][r]overlay=${x}:${y}:shortest=1[f];` +
      `[f][3:v]overlay=0:${UI.y + UI.h},format=yuv420p[v]`,
    '-map', '[v]', '-t', dur.toFixed(3), '-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', clip,
  ])
  clips.push({ file: clip, dur })
  console.log(`  ${s.key}: ${dur.toFixed(1)} s`)
}
for (const [name, dur] of [['intro', 3], ['outro', 3.5]]) {
  const clip = path.join(WORK, `${name}.mp4`)
  ff(['-loop', '1', '-i', path.join(WORK, `${name}.png`), '-vf', `fps=${FPS},format=yuv420p`, '-t', String(dur), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', clip])
  if (name === 'intro') clips.unshift({ file: clip, dur })
  else clips.push({ file: clip, dur })
}

// --- one film: crossfades between the clips, H.264, and a poster frame

const inputs = clips.flatMap((c) => ['-i', c.file])
let graph = ''
let prev = '[0:v]'
let offset = 0
for (let i = 1; i < clips.length; i++) {
  offset += clips[i - 1].dur - XFADE
  const label = i === clips.length - 1 ? '[v]' : `[x${i}]`
  graph += `${prev}[${i}:v]xfade=transition=fade:duration=${XFADE}:offset=${offset.toFixed(3)}${label};`
  prev = label
}
fs.mkdirSync(OUT, { recursive: true })
const mp4 = path.join(OUT, 'quiroflow-demo.mp4')
ff([...inputs, '-filter_complex', graph.slice(0, -1), '-map', '[v]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', '-an', mp4])
// The poster: the calendar just after the booking lands, caption and all.
const posterAt = clips[0].dur - XFADE + clips[1].dur - XFADE - 0.6
ff(['-ss', posterAt.toFixed(2), '-i', mp4, '-frames:v', '1', path.join(OUT, 'poster.png')])
const total = clips.reduce((n, c) => n + c.dur, 0) - XFADE * (clips.length - 1)
console.log(`saved ${mp4} (${total.toFixed(1)} s, ${(fs.statSync(mp4).size / 1e6).toFixed(1)} MB) and ${path.join(OUT, 'poster.png')}`)
