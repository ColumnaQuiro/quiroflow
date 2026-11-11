import { DEFAULT_CLINIC_TIMEZONE } from '~/utils/clinicClock'
import { normalizeBrandColor } from '~/utils/clinicBrandPalette'
import { hasClinicBranding } from '~/server/utils/requireGrowth'
import { walletLinkTokenWith, walletLinkValidWith, walletSigningFromPem, type BonoPassData, type WalletSigning } from '~/server/utils/walletPkpass'

/** The brand indigo (--color-brand, 79 70 229) a wallet pass is drawn in unless the clinic has its own look. */
const QUIROFLOW_PASS_COLOR = '#4F46E5'

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

/**
 * Everything the pass shows, read with the service role. Null when the bono
 * does not exist. Apple's pass carries the clinic's logo inside it; Google
 * fetches it from logoUrl, so it has no use for the bytes (logoBytes: false).
 */
export async function loadBonoPass(service: Service, purchaseId: string, opts: { logoBytes?: boolean } = {}): Promise<(BonoPassData & { logoUrl: string | null }) | null> {
  const { data: pp } = await service
    .from('package_purchases')
    .select('id, account_id, patient_id, package_name, sessions_total, sessions_used, is_closed, patients(first_name, last_name, clinic_id, anonymized_at), accounts(name, patient_app_brand_name, patient_app_brand_color, patient_app_brand_logo_path, subscriptions(status, comped, branding_addon))')
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
  // The clinic's own look for the patient app (Settings > Brand), when it has
  // the add-on: its colour, the name it goes by and its brand logo, on the
  // pass as in the app. Otherwise the pass is as it always was.
  const subscription = Array.isArray(pp.accounts?.subscriptions) ? pp.accounts.subscriptions[0] : pp.accounts?.subscriptions
  const branded = hasClinicBranding(subscription ?? null)
  const brandColor = (branded && normalizeBrandColor(pp.accounts?.patient_app_brand_color)) || QUIROFLOW_PASS_COLOR
  const brandName = (branded && pp.accounts?.patient_app_brand_name?.trim()) || null
  const logoPath: string | null = (branded && pp.accounts?.patient_app_brand_logo_path) || clinic?.logo_storage_path || null
  let logo: Uint8Array | null = null
  if (logoPath && opts.logoBytes !== false) {
    const { data: blob } = await service.storage.from('clinic-logos').download(logoPath)
    if (blob && /png/i.test(blob.type || logoPath)) logo = new Uint8Array(await blob.arrayBuffer())
  }
  // clinic-logos is a public bucket (0096_clinic_logo.sql). Google Wallet
  // takes PNG and JPEG, not SVG.
  const logoUrl = logoPath && /\.(png|jpe?g)$/i.test(logoPath) ? service.storage.from('clinic-logos').getPublicUrl(logoPath).data.publicUrl : null
  return {
    purchaseId: pp.id,
    patientId: pp.patient_id,
    holder: `${pp.patients?.first_name ?? ''} ${pp.patients?.last_name ?? ''}`.trim(),
    bono: pp.package_name ?? 'Bono',
    total: pp.sessions_total ?? 0,
    used: pp.sessions_used ?? 0,
    closed: !!pp.is_closed,
    accountName: brandName ?? pp.accounts?.name ?? 'Clínica',
    clinicName: brandName ?? clinic?.name ?? pp.accounts?.name ?? 'Clínica',
    clinicPhone: clinic?.phone ?? null,
    clinicAddress: clinic?.address ?? null,
    timezone: clinic?.timezone || DEFAULT_CLINIC_TIMEZONE,
    // QuiroFlow's indigo, Apple and Google, unless the clinic chose a colour
    // for the patient app. Never the online-booking colour: that one is
    // chosen for a booking page; on the pass it sat under the QuiroFlow mark
    // (the logo when a clinic has none) and read as somebody else's card --
    // one clinic's green pass on 18 Oct.
    brandColor,
    logo,
    logoUrl,
    nextVisit: next ? { startsAt: next.starts_at, what: next.appointment_types?.name ?? null, who: next.team_members?.full_name ?? null } : null,
    authToken,
  }
}

