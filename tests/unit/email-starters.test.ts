import { describe, it, expect } from 'vitest'
import { EMAIL_STARTERS } from '../../utils/emailStarters'
import { asEmailDesign, emailDesignHasContent, emailDesignHtml, emailDesignTokens } from '../../utils/emailDesign'
import { EMAIL_MERGE_FIELDS } from '../../utils/automationCatalog'

// QuiroFlow's own email templates: each must read as a design, say
// something, compile, and use only merge fields a send can fill -- a typo in
// one would reach every clinic that starts from it as a literal {{…}}.

const known = new Set(EMAIL_MERGE_FIELDS.map((f) => f.value))

describe('the email starters', () => {
  for (const s of EMAIL_STARTERS) {
    it(`"${s.name[1]}" is a working email`, () => {
      const design = s.design()
      expect(asEmailDesign(design)).not.toBeNull()
      expect(emailDesignHasContent(design)).toBe(true)
      expect(emailDesignHtml(design)).toContain('role="presentation"')
      const unknown = [...emailDesignTokens(design), ...[...s.subject.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!)].filter((k) => !known.has(k))
      expect(unknown).toEqual([])
    })
  }

  it('gives every copy its own block ids', () => {
    const [a, b] = [EMAIL_STARTERS[1]!.design(), EMAIL_STARTERS[1]!.design()]
    expect(a.blocks.map((x) => x.id)).not.toEqual(b.blocks.map((x) => x.id))
  })
})
