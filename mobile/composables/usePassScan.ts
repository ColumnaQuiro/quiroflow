import { Capacitor } from '@capacitor/core'
import { patientIdFromPassLink } from '../../utils/passLink'

// Scanning a patient's bono pass at the desk, and where that lands.
//
// The QR is a link to the patient's record (utils/passLink.ts). What the desk
// usually wants from it is to draw today's visit from the bono, which is the
// visit screen's "Usar <bono>" (useVisitCharging) -- so a patient with a visit
// today opens straight onto it, and anyone else onto their record, where the
// bonos are. The same landing serves the Scan button and the system camera
// opening the app on the link (plugins/pass-links.client.ts).

/** Today's visit for this patient when there is one, else their record. */
export async function openPatientFromPass(patientId: string) {
  const supabase = useSupabaseClient()
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  const { data } = await supabase
    .from('appointments')
    .select('id, starts_at')
    .eq('patient_id', patientId)
    .neq('status', 'cancelled')
    // Deleted on the web calendar: status stays 'booked', only deleted_at is set.
    .is('deleted_at', null)
    .gte('starts_at', start.toISOString())
    .lt('starts_at', end.toISOString())
    .order('starts_at')
  const visits = (data ?? []) as { id: string; starts_at: string }[]
  // Two today: the one closest to now is the one they are here for.
  const now = Date.now()
  const visit = visits.sort((a, b) => Math.abs(Date.parse(a.starts_at) - now) - Math.abs(Date.parse(b.starts_at) - now))[0]
  return navigateTo(visit ? `/calendar/${visit.id}` : `/patients/${patientId}`)
}

export function usePassScan() {
  const t = useT()
  const scanning = ref(false)
  const error = ref('')
  const available = Capacitor.isNativePlatform()

  async function scan() {
    if (!available || scanning.value) return
    scanning.value = true
    error.value = ''
    try {
      // Loaded when used: its web fallback pulls in a QR library the app
      // never needs on a phone.
      const { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } = await import('@capacitor/barcode-scanner')
      const result = await CapacitorBarcodeScanner.scanBarcode({
        hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
        scanInstructions: t('Point at the QR on the patient’s bono card', 'Apunta al QR de la tarjeta del bono'),
      })
      const patientId = patientIdFromPassLink(result.ScanResult)
      if (!patientId) {
        error.value = t('That is not a QuiroFlow bono card.', 'Eso no es una tarjeta de bono de QuiroFlow.')
        return
      }
      await openPatientFromPass(patientId)
    } catch (e) {
      // Closing the scanner is not an error worth a sentence.
      const message = e instanceof Error ? e.message : String(e)
      if (!/cancel/i.test(message)) error.value = t('Could not read the code. Try again.', 'No se ha podido leer el código. Vuelve a intentarlo.')
    } finally {
      scanning.value = false
    }
  }

  return { available, scanning, error, scan }
}
