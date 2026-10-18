import { walletEnabled } from '~/server/utils/walletPass'
import { googleWalletEnabled } from '~/server/utils/googleWallet'

// Which "Añadir a … Wallet" can be offered: each only once its signing
// material is configured on this deploy.
export default defineEventHandler(() => ({ apple: walletEnabled(), google: googleWalletEnabled() }))
