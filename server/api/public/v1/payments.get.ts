import { listHandler } from '~/server/utils/publicApiHandlers'
import { paymentsResource } from '~/server/utils/publicApiResources'

export default listHandler(paymentsResource)
