import { listHandler } from '~/server/utils/publicApiHandlers'
import { invoicesResource } from '~/server/utils/publicApiResources'

export default listHandler(invoicesResource)
