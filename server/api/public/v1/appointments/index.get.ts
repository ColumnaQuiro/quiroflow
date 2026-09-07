import { listHandler } from '~/server/utils/publicApiHandlers'
import { appointmentsResource } from '~/server/utils/publicApiResources'

export default listHandler(appointmentsResource)
