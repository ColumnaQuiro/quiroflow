import { walletEnabled } from '~/server/utils/walletPass'

// Whether "Añadir a Apple Wallet" can be offered: only once the pass
// certificate is configured on this deploy.
export default defineEventHandler(() => ({ apple: walletEnabled() }))
