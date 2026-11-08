import { Capacitor } from '@capacitor/core'

// Handing a file a report made (a CSV, the gestoría's ZIP, a factura's PDF)
// to the person holding the phone. The web does it with an <a download>
// click, which inside the app's WebView goes nowhere: WKWebView ignores the
// download attribute on a blob URL and Android's WebView has no download
// handler, so the tap looked like nothing happened. The app has no
// filesystem or share plugin either, so this uses the Web Share API with the
// file attached, which opens the system share sheet -- save to Files, mail it
// to the gestoría, AirDrop it to the desk computer.
//
// Nothing may be awaited before navigator.share(): the sheet only opens
// within the tap that asked for it (transient user activation). A page that
// first fetched the file over the network can find the tap has expired by
// then, which the browser reports as NotAllowedError -- that comes back as
// 'needs-tap', so the page keeps the file and offers a button that shares it
// again from a fresh tap. Closing the sheet without choosing anything is
// AbortError, and is the person's choice, not a failure.
//
// In a plain browser (the app's web build, a desktop) without file sharing,
// it falls back to the web's own <a download>. On the native app without it
// (an older Android WebView) there is nothing that would work, and it says
// so rather than pretending the file was saved.

export type ShareReportStatus = 'shared' | 'closed' | 'downloaded' | 'needs-tap' | 'unsupported' | 'failed'

export interface ShareReportResult {
  /** The file reached the person (or they chose to close the sheet). */
  ok: boolean
  status: ShareReportStatus
  /** What the browser said, for 'failed'. */
  message?: string
}

export async function shareReportFile(blob: Blob, filename: string, mime: string = blob.type || 'application/octet-stream', title?: string): Promise<ShareReportResult> {
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

  if (Capacitor.isNativePlatform()) return { ok: false, status: 'unsupported' }

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
    case 'unsupported':
      return t("This phone can't share files from the app. Download it from app.quiroflow.com instead.", 'Este teléfono no permite compartir archivos desde la app. Descárgalo desde app.quiroflow.com.')
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
