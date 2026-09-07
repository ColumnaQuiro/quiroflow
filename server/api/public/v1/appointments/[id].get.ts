import { detailHandler } from '~/server/utils/publicApiHandlers'
import { appointmentsResource } from '~/server/utils/publicApiResources'

export default detailHandler(appointmentsResource, 'appointment')
