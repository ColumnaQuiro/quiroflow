import { listHandler } from '~/server/utils/publicApiHandlers'
import { appointmentTypesResource } from '~/server/utils/publicApiResources'

export default listHandler(appointmentTypesResource)
