import type { Landmark } from '../utils/posture'

// The pose model behind a posture assessment: Google's MediaPipe Pose
// Landmarker, run in the browser (WebAssembly, GPU when there is one). The
// photo never leaves the device for this; only the points come out.
//
// Loaded from the CDN at the moment it is first needed, pinned to one
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
  try {
    return await make('GPU')
  } catch {
    return await make('CPU')
  }
}

export function usePoseModel() {
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
  return { detect }
}
