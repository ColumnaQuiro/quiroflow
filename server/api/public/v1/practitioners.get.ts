import { listHandler } from '~/server/utils/publicApiHandlers'
import { practitionersResource } from '~/server/utils/publicApiResources'

export default listHandler(practitionersResource)
