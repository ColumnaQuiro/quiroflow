import type { InjectionKey } from 'vue'

// Settings › Import lists every step with how many records it has brought
// across. Those counts were read once, when the page opened, so a step that had
// just imported 2,000 patients still said "Nothing imported yet" until the page
// was reloaded. The importers are separate components, each with its own stage
// machine, so they tell the page when they start and stop writing, and the page
// does the counting: live while a step writes, and once more for every step
// when it stops (one step's import can add to another's count).
type Reporter = (writing: boolean) => void

const IMPORT_WRITING_KEY: InjectionKey<Reporter> = Symbol('import-writing')

export function provideImportWriting(report: Reporter) {
  provide(IMPORT_WRITING_KEY, report)
}

// Called by an importer with whatever says it is writing right now. Outside the
// Import page (no provider) it does nothing.
export function useImportWriting(writing: () => boolean) {
  const report = inject(IMPORT_WRITING_KEY, null)
  if (!report) return
  watch(writing, (now, before) => {
    if (now !== before) report(now)
  })
  // Switching step unmounts the importer, and with it this watcher. Say it has
  // stopped, or the page would keep polling a step nobody is looking at.
  onBeforeUnmount(() => {
    if (writing()) report(false)
  })
}
