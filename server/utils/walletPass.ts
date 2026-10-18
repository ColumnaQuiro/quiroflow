import { DEFAULT_CLINIC_TIMEZONE } from '~/utils/clinicClock'
import { walletLinkTokenWith, walletLinkValidWith, walletSigningFromPem, type BonoPassData, type WalletSigning } from '~/server/utils/walletPkpass'

// A bono in Apple Wallet: the configuration (the pass type certificate and
// key, NUXT_WALLET_PASS_CERT / NUXT_WALLET_PASS_KEY as base64 PEM) and the
// data the pass shows. The pass itself is server/utils/walletPkpass.ts.
//
// One pass type for every clinic (pass.com.quiroflow.bono), drawn in each
// clinic's colour and logo, so no clinic sets anything up. It keeps itself
// current through webServiceURL (server/api/wallet/v1/*).

type Service = any

let signing: WalletSigning | null | undefined
/** The signing material from the runtime config, or null when Wallet is not configured. */
export function walletSigning(config = useRuntimeConfig()): WalletSigning | null {
  if (signing !== undefined) return signing
  const certPem = config.walletPassCert ? Buffer.from(String(config.walletPassCert), 'base64').toString('utf8') : ''
  const keyPem = config.walletPassKey ? Buffer.from(String(config.walletPassKey), 'base64').toString('utf8') : ''
  signing = certPem && keyPem ? walletSigningFromPem(certPem, keyPem) : null
  return signing
}
export function walletEnabled() {
  return !!walletSigning()
}
export function walletLinkToken(purchaseId: string, expires: number): string {
  const s = walletSigning()
  if (!s) throw new Error('Wallet is not configured')
  return walletLinkTokenWith(s, purchaseId, expires)
}
export function walletLinkValid(purchaseId: string, expires: number, token: string): boolean {
  const s = walletSigning()
  return !!s && walletLinkValidWith(s, purchaseId, expires, token)
}

/** Everything the pass shows, read with the service role. Null when the bono does not exist. */
export async function loadBonoPass(service: Service, purchaseId: string): Promise<BonoPassData | null> {
  const { data: pp } = await service
    .from('package_purchases')
    .select('id, account_id, patient_id, package_name, sessions_total, sessions_used, is_closed, patients(first_name, last_name, clinic_id, anonymized_at), accounts(name, online_booking_primary_color)')
    .eq('id', purchaseId)
    .maybeSingle()
  if (!pp || pp.patients?.anonymized_at) return null
  const { data: pass } = await service
    .from('wallet_passes')
    .upsert({ package_purchase_id: pp.id, account_id: pp.account_id }, { onConflict: 'package_purchase_id', ignoreDuplicates: true })
    .select('auth_token')
    .maybeSingle()
  const authToken = pass?.auth_token ?? (await service.from('wallet_passes').select('auth_token').eq('package_purchase_id', pp.id).single()).data?.auth_token
  const clinicQuery = service.from('clinics').select('name, phone, address, timezone, logo_storage_path').eq('account_id', pp.account_id).is('archived_at', null)
  const { data: clinic } = await (pp.patients?.clinic_id ? clinicQuery.eq('id', pp.patients.clinic_id) : clinicQuery.order('created_at')).limit(1).maybeSingle()
  const { data: next } = await service
    .from('appointments')
    .select('starts_at, appointment_types(name), team_members(full_name)')
    .eq('patient_id', pp.patient_id)
    .is('deleted_at', null)
    .not('status', 'in', '(cancelled,no_show)')
    .gt('starts_at', new Date().toISOString())
    .order('starts_at')
    .limit(1)
    .maybeSingle()
  let logo: Uint8Array | null = null
  if (clinic?.logo_storage_path) {
    const { data: blob } = await service.storage.from('clinic-logos').download(clinic.logo_storage_path)
    if (blob && /png/i.test(blob.type || clinic.logo_storage_path)) logo = new Uint8Array(await blob.arrayBuffer())
  }
  return {
    purchaseId: pp.id,
    patientId: pp.patient_id,
    holder: `${pp.patients?.first_name ?? ''} ${pp.patients?.last_name ?? ''}`.trim(),
    bono: pp.package_name ?? 'Bono',
    total: pp.sessions_total ?? 0,
    used: pp.sessions_used ?? 0,
    closed: !!pp.is_closed,
    accountName: pp.accounts?.name ?? 'Clínica',
    clinicName: clinic?.name ?? pp.accounts?.name ?? 'Clínica',
    clinicPhone: clinic?.phone ?? null,
    clinicAddress: clinic?.address ?? null,
    timezone: clinic?.timezone || DEFAULT_CLINIC_TIMEZONE,
    brandColor: pp.accounts?.online_booking_primary_color ?? null,
    logo,
    nextVisit: next ? { startsAt: next.starts_at, what: next.appointment_types?.name ?? null, who: next.team_members?.full_name ?? null } : null,
    authToken,
  }
}

