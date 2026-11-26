import { describe, expect, it } from 'vitest'
import {
  PRACTICEHUB_LINKS_MAX_AGE_MS,
  practiceHubLinksAfterLapse,
  practiceHubLinksAfterSlice,
  practiceHubLinksFresh,
  practiceHubLinksNewRead,
  practiceHubLinksStartNewRead,
  type PracticeHubLinkState,
} from '../../utils/practicehubImport/linkRefresh'

// A clinic's files sync stopped on 25 Nov 2026 with 241 files stored and
// 2,646 still in PracticeHub: its links lasted ten minutes, and when they
// lapsed the step "read them again" by carrying on a read that had already
// finished -- the same expired links, three times in 27 s, then "kept
// expiring before anything could be stored".

const T0 = Date.parse('2026-11-25T09:15:00Z')
const finishedRead = (over: Partial<PracticeHubLinkState> = {}): PracticeHubLinkState => ({
  pass: 'links-a', listIndex: 1, page: 1, pagesRead: { '/files': 43 }, records: 4228, done: 43,
  readAt: new Date(T0).toISOString(), ...over,
})

describe('PracticeHub link refresh', () => {
  it('a lapse makes the next slice read the list anew, not carry on the finished read', () => {
    const { links, giveUp } = practiceHubLinksAfterLapse(finishedRead(), false)
    expect(giveUp).toBe(false)
    expect(practiceHubLinksFresh(links, T0 + 60_000)).toBe(false)
    expect(practiceHubLinksStartNewRead(links)).toBe(true)

    const next = practiceHubLinksNewRead(links, 'links-b')
    expect(next).toMatchObject({ pass: 'links-b', listIndex: 0, page: 1, done: 0, refreshes: 1 })
    expect(next.readAt).toBeUndefined()
    expect(next.lapsed).toBeUndefined()
  })

  it('a read under way is carried on', () => {
    const midRead: PracticeHubLinkState = { pass: 'links-a', listIndex: 0, page: 12, pagesRead: {}, records: 4228, done: 11 }
    expect(practiceHubLinksFresh(midRead, T0)).toBe(false)
    expect(practiceHubLinksStartNewRead(midRead)).toBe(false)
    expect(practiceHubLinksStartNewRead(undefined)).toBe(true)
  })

  it('reads the list again before ten-minute links lapse', () => {
    const links = finishedRead()
    expect(practiceHubLinksFresh(links, T0 + 6 * 60_000)).toBe(true)
    expect(practiceHubLinksFresh(links, T0 + PRACTICEHUB_LINKS_MAX_AGE_MS)).toBe(false)
    // The list took about 70 s to read, so its first page lapses at T0 + 8m50s;
    // a slice that starts just under the max age still ends before that.
    expect(PRACTICEHUB_LINKS_MAX_AGE_MS + 60_000).toBeLessThan(8 * 60_000 + 50_000)
  })

  it('keeps going through any number of lapses while files are being stored', () => {
    let links: PracticeHubLinkState | undefined = finishedRead()
    for (let cycle = 0; cycle < 10; cycle++) {
      // Slices that store files, then one that meets the expired link first.
      links = practiceHubLinksAfterSlice(links, true)
      const lapse = practiceHubLinksAfterLapse(links, false)
      expect(lapse.giveUp).toBe(false)
      links = { ...practiceHubLinksNewRead(lapse.links, `links-${cycle}`), readAt: new Date(T0).toISOString() }
    }
  })

  it('gives up after three lapses with nothing stored in between', () => {
    let links: PracticeHubLinkState | undefined = finishedRead()
    const results: boolean[] = []
    for (let i = 0; i < 3; i++) {
      const lapse = practiceHubLinksAfterLapse(links, false)
      results.push(lapse.giveUp)
      links = { ...practiceHubLinksNewRead(lapse.links, `links-${i}`), readAt: new Date(T0).toISOString() }
      links = practiceHubLinksAfterSlice(links, false)
    }
    expect(results).toEqual([false, false, true])
  })

  it('a lapse in a slice that stored something does not count', () => {
    const { links, giveUp } = practiceHubLinksAfterLapse(finishedRead({ refreshes: 2 }), true)
    expect(giveUp).toBe(false)
    expect(links.refreshes).toBe(0)
  })
})
