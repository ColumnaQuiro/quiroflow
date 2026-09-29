// A load that reruns on a watcher -- another practitioner picked, another
// period -- can have two answers on the way at once, and they land in the
// order the network returns them, not the order they were asked. Without a
// check the slower one wins even when it is the older one, and the figure on
// screen then describes a filter nobody has selected any more, with the
// skeleton cleared by whichever finished first.
//
//   const latest = useLatestRun()
//   async function load() {
//     const isStale = latest.start()
//     const rows = await ...
//     if (isStale()) return
//     ...write rows, clear loading
//   }
export function useLatestRun() {
  let current = 0
  function start() {
    const run = ++current
    return () => run !== current
  }
  return { start }
}
