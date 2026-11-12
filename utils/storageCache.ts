// Cache lifetime for an upload to a PUBLIC bucket whose path is unique to
// its content -- a name with Date.now() in it. Such a URL never serves
// different bytes, so browsers and the CDN can keep it for a year instead of
// Storage's default hour (3600), which had every logo and avatar re-fetched
// on each visit after the first hour.
//
// NOT for a path that is overwritten in place (an import's fixed
// `quirocitas.jpg`, a `practicehub-<name>` diagram, anything with upsert):
// those must keep the short default or the old picture is what people see.
// supabase-js takes seconds, as a string.
export const IMMUTABLE_CACHE_SECONDS = '31536000'
