import { deviceTilt } from '../utils/posture'

// The device's own level while a posture or squat photo is being set up
// (components/posture/Capture.vue): how far the phone or iPad on its stand is
// turned off straight, and leaning towards or away from the patient, from
// DeviceMotionEvent. Read once the practitioner asks for it -- iOS only lets
// a page listen after a tap, and asks the person first -- and stopped when the
// screen goes. The reading at the moment "Take photo" is pressed is what the
// photo is corrected by (utils/posture.ts straighten), since the camera that
// opens then is the same device, on the same stand.
//
// Shared with mobile/, so its import is relative.
export function useDeviceLevel() {
  const reading = ref<{ tilt: number; pitch: number } | null>(null)
  const active = ref(false)
  const denied = ref(false)
  let last = 0

  function onMotion(e: DeviceMotionEvent) {
    const g = e.accelerationIncludingGravity
    if (!g) return
    // Ten readings a second is plenty for a number on screen.
    const now = performance.now()
    if (now - last < 100) return
    last = now
    reading.value = deviceTilt({ x: g.x, y: g.y, z: g.z })
  }

  async function start(): Promise<boolean> {
    if (active.value) return true
    if (typeof window === 'undefined') return false
    const DM = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent
    if (!DM) return false
    if (typeof DM.requestPermission === 'function') {
      try {
        if ((await DM.requestPermission()) !== 'granted') {
          denied.value = true
          return false
        }
      } catch {
        denied.value = true
        return false
      }
    }
    window.addEventListener('devicemotion', onMotion)
    active.value = true
    return true
  }

  function stop() {
    if (typeof window !== 'undefined') window.removeEventListener('devicemotion', onMotion)
    active.value = false
  }
  onBeforeUnmount(stop)

  return { reading, active, denied, start, stop }
}
