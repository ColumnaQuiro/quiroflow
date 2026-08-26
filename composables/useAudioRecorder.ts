// Voice notes for the Inbox composer, web and mobile alike -- both run in a
// WebView/browser with standard getUserMedia/MediaRecorder support, no
// native plugin needed. mimeType matters more than usual here: WhatsApp's
// audio message type only accepts a handful of containers/codecs (mp4/aac,
// ogg/opus, mpeg, amr) -- Chrome's MediaRecorder default (webm/opus) isn't
// one of them, so this explicitly prefers whatever the browser can produce
// that Meta will actually accept, falling back to webm only if nothing
// better is supported (which will fail Meta-side on that browser -- a real
// limitation, not silently hidden, since the existing send-error path
// surfaces Meta's rejection same as any other failed send).
const MIME_CANDIDATES = ['audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm']

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  for (const type of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return ''
}

export function useAudioRecorder() {
  const recording = ref(false)
  const seconds = ref(0)
  let mediaRecorder: MediaRecorder | null = null
  let chunks: Blob[] = []
  let timer: ReturnType<typeof setInterval> | null = null
  let stream: MediaStream | null = null

  function cleanup() {
    recording.value = false
    if (timer) clearInterval(timer)
    timer = null
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
    mediaRecorder = null
  }

  async function start() {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mimeType = pickMimeType()
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    chunks = []
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    mediaRecorder.start()
    recording.value = true
    seconds.value = 0
    timer = setInterval(() => {
      seconds.value += 1
    }, 1000)
  }

  function stop(): Promise<{ blob: Blob; mimeType: string } | null> {
    return new Promise((resolve) => {
      if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        cleanup()
        resolve(null)
        return
      }
      const mimeType = mediaRecorder.mimeType || 'audio/webm'
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType })
        cleanup()
        resolve(blob.size > 0 ? { blob, mimeType } : null)
      }
      mediaRecorder.stop()
    })
  }

  function cancel() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop()
    cleanup()
  }

  return { recording, seconds, start, stop, cancel }
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '')
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export function extensionForAudioMimeType(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'm4a'
  if (mimeType.includes('ogg')) return 'ogg'
  return 'webm'
}
