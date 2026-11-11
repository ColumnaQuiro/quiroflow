// Gives a piece of async work a deadline: past it, the promise rejects with a
// DeadlineError and the signal handed to the work is aborted, so whatever was
// still in flight is cancelled where the API allows it.
//
// The case that needs it is a browser that stops a page without telling it.
// Safari freezes a tab when the screen locks, the tab goes to the background
// or the Mac sleeps, and a request caught mid-flight can stay pending forever
// once it wakes: no response, no error. A batch awaiting that request then
// waits forever too. The timer does not run while the page is frozen, but it
// is overdue the moment the page wakes, so it fires straight away and the
// work behind it moves on.
export class DeadlineError extends Error {
  constructor(ms: number) {
    super(`No answer after ${Math.round(ms / 1000)} s`)
    this.name = 'DeadlineError'
  }
}

export function withDeadline<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController()
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort()
      reject(new DeadlineError(ms))
    }, ms)
    work(controller.signal).then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}
