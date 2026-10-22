import type { Landmark } from '../utils/posture'

// The pose model behind a posture assessment: Google's MediaPipe Pose
// Landmarker, run in the browser (WebAssembly, GPU when there is one). The
// photo never leaves the device for this; only the points come out.
//
// Loaded from the CDN as the capture screen opens (warm), pinned to one
// version, and never installed as a dependency: the app's Xcode Cloud build
// installs mobile/ only (ci_post_clone.sh), so a package import here would
// break every cloud build the day shared code reached for it. A string URL
// behind @vite-ignore is something no bundler tries to resolve.
//
// window.__postureDetect, when a test sets it, answers instead -- the e2e
// specs place known points without fetching an 11 MB model.
const VERSION = '1.0.1'
const BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task'

interface Landmarker { detect: (image: HTMLImageElement | HTMLCanvasElement) => { landmarks: Landmark[][] } }
let loading: Promise<Landmarker> | null = null

async function load(): Promise<Landmarker> {
  const vision: any = await import(/* @vite-ignore */ `${BASE}/vision_bundle.mjs`)
  const fileset = await vision.FilesetResolver.forVisionTasks(`${BASE}/wasm`)
  const make = (delegate: 'GPU' | 'CPU') =>
    vision.PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'IMAGE', numPoses: 1 })
  let model: Landmarker
  try {
    model = await make('GPU')
  } catch {
    model = await make('CPU')
  }
  // The first run compiles the GPU shaders, about a second on a phone: done
  // here on a blank frame, so it is not paid on the patient's first photo.
  const blank = document.createElement('canvas')
  blank.width = blank.height = 64
  blank.getContext('2d')!.fillRect(0, 0, 64, 64)
  model.detect(blank)
  return model
}

export function usePoseModel() {
  /**
   * Starts the download and set-up without waiting for it -- called when the
   * capture screen opens, so the model is ready by the time the patient is in
   * place and the first photo is taken, rather than starting then (the
   * bundle, the WebAssembly and the model are ~20 MB, several seconds on a
   * phone's connection). Nothing on any other screen pays for it.
   */
  function warm() {
    if ((window as unknown as { __postureDetect?: unknown }).__postureDetect) return
    loading ??= load()
    loading.catch((e) => {
      loading = null
      console.error('[posture] pose model', e)
    })
  }
  /** The first person's 33 landmarks (0-1), or null when nobody is found or the model cannot load. */
  async function detect(image: HTMLImageElement | HTMLCanvasElement): Promise<Landmark[] | null> {
    const stub = (window as unknown as { __postureDetect?: (img: unknown) => Landmark[] | null }).__postureDetect
    if (stub) return stub(image)
    try {
      loading ??= load()
      const model = await loading
      return model.detect(image).landmarks?.[0] ?? null
    } catch (e) {
      loading = null
      console.error('[posture] pose model', e)
      return null
    }
  }
  return { detect, warm }
}
