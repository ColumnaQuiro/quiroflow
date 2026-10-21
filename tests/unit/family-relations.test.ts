import { describe, expect, it } from 'vitest'
import { inverseRelation, relationLabel } from '../../utils/familyRelations'

// Family links (utils/familyRelations.ts): stored both ways, read by sex.
const t = (_en: string, es: string) => es

describe('family relations', () => {
  it('inverts parent and child, and keeps the rest', () => {
    expect(inverseRelation('parent')).toBe('child')
    expect(inverseRelation('child')).toBe('parent')
    expect(inverseRelation('partner')).toBe('partner')
    expect(inverseRelation('sibling')).toBe('sibling')
  })
  it('names the relation by the related person’s sex when known', () => {
    expect(relationLabel('parent', 'female', t)).toBe('Madre')
    expect(relationLabel('child', 'male', t)).toBe('Hijo')
    expect(relationLabel('parent', null, t)).toBe('Padre/madre')
    expect(relationLabel('other', 'female', t)).toBe('Familiar')
  })
})
