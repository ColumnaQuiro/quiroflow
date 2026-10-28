import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EXERCISE_CATALOG, EXERCISE_CATALOG_PROGRAMS, EXERCISE_CATALOG_REGIONS, exerciseCatalogMediaPaths } from '../../utils/exerciseCatalog'

// The catalogue's text lives in utils/exerciseCatalog.ts and its movements in
// scripts/exercise-catalog/exercises.py, which renders the videos. A slug in
// one and not the other is an exercise with no video, or a video nobody can
// add -- and nothing on screen would say so until a patient pressed play.
const root = join(__dirname, '..', '..')
const rendered = [...readFileSync(join(root, 'scripts/exercise-catalog/exercises.py'), 'utf8').matchAll(/slug='([a-z0-9-]+)'/g)].map((m) => m[1])

describe('exercise catalogue', () => {
  it('has each slug once', () => {
    const slugs = EXERCISE_CATALOG.map((e) => e.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('lists exactly the exercises the renderer draws', () => {
    expect([...EXERCISE_CATALOG.map((e) => e.slug)].sort()).toEqual([...rendered].sort())
  })

  it('has a video and a poster for every exercise', () => {
    for (const e of EXERCISE_CATALOG) {
      const { video, poster } = exerciseCatalogMediaPaths(e.slug)
      expect(existsSync(join(root, 'public', video)), video).toBe(true)
      expect(existsSync(join(root, 'public', poster)), poster).toBe(true)
    }
  })

  it('puts every exercise in a known region, with text in both languages', () => {
    const regions = new Set(EXERCISE_CATALOG_REGIONS.map((r) => r.key))
    for (const e of EXERCISE_CATALOG) {
      expect(regions.has(e.region), e.slug).toBe(true)
      for (const text of [e.name, e.instructions, e.reps, e.frequency]) {
        expect(text.en.trim(), e.slug).not.toBe('')
        expect(text.es.trim(), e.slug).not.toBe('')
      }
    }
  })

  it('builds programmes only from catalogue exercises', () => {
    const slugs = new Set(EXERCISE_CATALOG.map((e) => e.slug))
    for (const p of EXERCISE_CATALOG_PROGRAMS) {
      expect(p.items.length, p.slug).toBeGreaterThan(0)
      for (const item of p.items) expect(slugs.has(item), `${p.slug}: ${item}`).toBe(true)
    }
  })
})
