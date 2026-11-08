import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

// Handing a file a report made (a CSV, the gestoría's ZIP, a factura's PDF)
// to the person holding the phone. The web does it with an <a download>
// click, which inside the app's WebView goes nowhere: WKWebView ignores the
// download attribute on a blob URL and Android's WebView has no download
// handler, so the tap looked like nothing happened.
//
// In the app, on both platforms, the file is written to the app's cache
// directory (@capacitor/filesystem) and its file:// URI handed to the system
// share sheet (@capacitor/share) -- save to Files or Drive, mail it to the
// gestoría, AirDrop it to the desk computer. Android has to go this way: its
// WebView has no navigator.share at all. iOS could keep the Web Share API,
// which WKWebView does implement, but moves too, because the plugin is the
// better fit there as well:
//   - Web Share only opens within the tap that asked for it (transient user
//     activation). A page that first fetched the file over the network -- the
//     gestoría ZIP, a factura's PDF, the balances behind a CSV -- found the
//     tap had expired and had to ask for a second one. A native call has no
//     such rule, so in the app the sheet opens on the first tap, every time.
//   - One path on both platforms is one path to test, and the file reaches
//     the sheet with the name it was given on both.
//
// Closing the sheet without choosing anything is the person's choice, not a
// failure ('closed'; the plugin rejects with "Share canceled"). The cache
// folder is emptied before each new file rather than after sharing: the app
// that receives it reads the URI on its own schedule, after the sheet has
// already resolved. The OS may also clear it whenever it likes, which is
// what a cache is for.
//
// In a plain browser (the app's web build, a desktop) it is the Web Share
// API with the file attached where the browser has it, and the web's own
// <a download> where it does not. Only there does 'needs-tap' still happen:
// when the share came too long after the tap, the page keeps the file and
// offers a button that shares it again from a fresh one.

export type ShareReportStatus = 'shared' | 'closed' | 'downloaded' | 'needs-tap' | 'failed'

export interface ShareReportResult {
  /** The file reached the person (or they chose to close the sheet). */
  ok: boolean
  status: ShareReportStatus
  /** What the platform said, for 'failed'. */
  message?: string
}

export async function shareReportFile(blob: Blob, filename: string, mime: string = blob.type || 'application/octet-stream', title?: string): Promise<ShareReportResult> {
  if (Capacitor.isNativePlatform()) return shareNative(blob, filename, title)
  return shareInBrowser(blob, filename, mime, title)
}

// The folder under the cache directory the files go in, so emptying it never
// touches anything else the app (or a plugin) keeps in the cache.
const SHARE_DIR = 'shared-reports'
// Bytes per bridge message. Writing a 40 MB ZIP as a single base64 string
// would hold the file three times over in the WebView at once; in pieces it
// holds one piece. A multiple of 3, so every piece encodes to base64 on its
// own with no padding in the middle of the file.
const CHUNK = 3 * 1024 * 1024

async function shareNative(blob: Blob, filename: string, title?: string): Promise<ShareReportResult> {
  // A factura number can hold a slash ("2026/0042"), which as a path would be
  // a folder that does not exist.
  const name = filename.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'export'
  const path = `${SHARE_DIR}/${name}`
  let uri: string
  try {
    await Filesystem.rmdir({ path: SHARE_DIR, directory: Directory.Cache, recursive: true }).catch(() => {})
    await Filesystem.mkdir({ path: SHARE_DIR, directory: Directory.Cache, recursive: true }).catch(() => {})
    if (blob.size === 0) {
      await Filesystem.writeFile({ path, directory: Directory.Cache, data: '' })
    }
    for (let at = 0; at < blob.size; at += CHUNK) {
      const data = await base64(blob.slice(at, at + CHUNK))
      if (at === 0) await Filesystem.writeFile({ path, directory: Directory.Cache, data })
      else await Filesystem.appendFile({ path, directory: Directory.Cache, data })
    }
    uri = (await Filesystem.getUri({ path, directory: Directory.Cache })).uri
  } catch (e) {
    return { ok: false, status: 'failed', message: (e as Error)?.message }
  }

  try {
    await Share.share({ files: [uri], title: title ?? name, dialogTitle: title ?? name })
    return { ok: true, status: 'shared' }
  } catch (e) {
    const message = (e as Error)?.message ?? ''
    if (/cancel/i.test(message)) return { ok: true, status: 'closed' }
    return { ok: false, status: 'failed', message }
  }
}

function base64(part: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result ?? '')
      resolve(url.slice(url.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(part)
  })
}

async function shareInBrowser(blob: Blob, filename: string, mime: string, title?: string): Promise<ShareReportResult> {
  let file: File | null = null
  try {
    file = new File([blob], filename, { type: mime })
  } catch {
    file = null
  }

  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  let canShareFile = false
  try {
    canShareFile = !!file && typeof nav?.share === 'function' && !!nav.canShare?.({ files: [file] })
  } catch {
    canShareFile = false
  }

  if (canShareFile && file) {
    try {
      await nav!.share({ files: [file], title: title ?? filename })
      return { ok: true, status: 'shared' }
    } catch (e) {
      const name = (e as { name?: string } | null)?.name
      if (name === 'AbortError') return { ok: true, status: 'closed' }
      if (name === 'NotAllowedError') return { ok: false, status: 'needs-tap' }
      return { ok: false, status: 'failed', message: (e as Error)?.message }
    }
  }

  try {
    const url = URL.createObjectURL(file ?? new Blob([blob], { type: mime }))
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Not straight away: revoking in the same tick can cancel the download.
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return { ok: true, status: 'downloaded' }
  } catch (e) {
    return { ok: false, status: 'failed', message: (e as Error)?.message }
  }
}

/**
 * The sentence a page shows for a result, or null when there is nothing to
 * say (the sheet did its job). `t` is the page's useT().
 */
export function shareReportMessage(result: ShareReportResult, t: (en: string, es: string) => string): string | null {
  switch (result.status) {
    case 'shared':
    case 'closed':
      return null
    case 'downloaded':
      return t('Downloaded.', 'Descargado.')
    case 'needs-tap':
      return t('The file is ready. Tap Share to send or save it.', 'El archivo está listo. Pulsa Compartir para enviarlo o guardarlo.')
    default:
      return t("Couldn't share the file.", 'No se ha podido compartir el archivo.') + (result.message ? ` (${result.message})` : '')
  }
}

/**
 * Rows to CSV the way Papa.unparse writes them (the web pages use papaparse,
 * which the app does not ship): the columns are the first row's keys, a
 * field is quoted when it holds the delimiter, a quote, a line break or a
 * leading/trailing space, quotes are doubled, and lines end in \r\n. So the
 * file from the phone is the file from the web.
 */
export function reportCsv(rows: Record<string, unknown>[], delimiter = ','): string {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0]!)
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return ''
    const s = v instanceof Date ? JSON.stringify(v).slice(1, 25) : typeof v === 'object' ? JSON.stringify(v) : String(v)
    const quote = s.includes(delimiter) || /["\r\n﻿]/.test(s) || s.startsWith(' ') || s.endsWith(' ')
    return quote ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [cols.map(cell).join(delimiter), ...rows.map((r) => cols.map((c) => cell(r[c])).join(delimiter))].join('\r\n')
}
