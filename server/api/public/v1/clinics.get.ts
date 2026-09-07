import { listHandler } from '~/server/utils/publicApiHandlers'
import { clinicsResource } from '~/server/utils/publicApiResources'

export default listHandler(clinicsResource)
