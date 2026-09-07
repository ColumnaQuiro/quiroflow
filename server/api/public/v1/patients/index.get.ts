import { listHandler } from '~/server/utils/publicApiHandlers'
import { patientsResource } from '~/server/utils/publicApiResources'

export default listHandler(patientsResource)
