import { readdirSync } from 'node:fs'
import { join } from 'node:path'

// Every route Nuxt's file router generates from pages/, derived by reading
// the directory rather than hard-coding a list. The navigation smoke spec
// uses this to fail when a page is added that nobody accounted for --
// before this existed, 17 pages (all of /campaigns, /waitlist,
// /care-plan-alerts, /practitioner, /account and 12 settings pages) had
// silently drifted out of every spec, because the smoke list was a manual
// copy that nothing kept honest.
function listPageRoutes(): string[] {
  const root = join(process.cwd(), 'pages')
  const routes: string[] = []

  function walk(dir: string, prefix: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), `${prefix}/${entry.name}`)
        continue
      }
      if (!entry.name.endsWith('.vue')) continue
      const name = entry.name.replace(/\.vue$/, '')
      routes.push(name === 'index' ? prefix || '/' : `${prefix}/${name}`)
    }
  }

  walk(root, '')
  return routes.sort()
}

export const routeTasks = {
  'app:pageRoutes': listPageRoutes,
}
