// "Create with AI" in Settings > Docs, against the real model: the request
// clinics get (server/utils/aiFormDraftModel.ts), on forms a chiropractic or
// physiotherapy clinic actually asks for. Invented clinic, invented text.
//
//   npm run eval:forms                        # the production model
//   EVAL_MODEL=claude-sonnet-5-5 npm run eval:forms
//
// Costs money (roughly $0.05-0.20 a case on Opus) and the model is not
// deterministic, so it is kept out of CI like the receptionist's evals. The
// key is ANTHROPIC_API_KEY or ~/.quiroflow-eval-anthropic-key -- never the
// production key, so these calls do not show as a clinic's spending.
//
// Every draft is written to $TMPDIR/quiroflow-form-evals/<model>/ to be READ:
// the checks here catch the mechanical failures (too slow, wrong category, a
// pasted question lost, an invented tax ID), not whether the form is good.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, afterAll } from 'vitest'
import { AI_FORM_MODEL, draftAiForm } from '~/server/utils/aiFormDraftModel'
import type { AiFormLanguage } from '~/utils/aiFormDraft'
import type { DocField } from '~/utils/docFields'
import { CASES } from './fixtures'

const MODEL = process.env.EVAL_MODEL || AI_FORM_MODEL
// Netlify stops the function at 60 s and the route gives up at 50 s; a case
// needs real room under that, or a slower afternoon at Anthropic fails it.
const TIME_BUDGET_MS = 40_000

// $/1M tokens, for the summary only.
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
}

function apiKey(): string | null {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  try {
    return readFileSync(join(homedir(), '.quiroflow-eval-anthropic-key'), 'utf8').trim() || null
  } catch {
    return null
  }
}

const key = apiKey()
const outDir = join(tmpdir(), 'quiroflow-form-evals', MODEL)
const rows: { case: string; outcome: string; servedBy: string; seconds: number; blocks: number; inTok: number; outTok: number; usd: number }[] = []

function labels(fields: DocField[]): string {
  return fields.map((f) => [f.label, ...(f.options ?? [])].join(' ')).join('\n').toLowerCase()
}

// Text the model was told never to invent: a Spanish tax ID, a postcode, a
// street. Inside [square brackets] is a placeholder, which is the point.
function inventedLegalDetails(fields: DocField[]): string[] {
  const text = fields.map((f) => f.label.replace(/\[[^\]]*\]/g, '')).join('\n')
  const found: string[] = []
  for (const re of [/\b[A-HJ-NP-SUVW]\d{7}[0-9A-J]\b/g, /\b\d{8}[A-Z]\b/g, /\b(?:C\/|Calle|Avda\.?|Avenida)\s+[A-ZÁÉÍÓÚ][\wáéíóúñ]+/g, /\b(?:0[1-9]|[1-4]\d|5[0-2])\d{3}\b/g]) {
    found.push(...(text.match(re) ?? []))
  }
  return found
}

describe.skipIf(!key)(`Create with AI (${MODEL})`, () => {
  const client = new Anthropic({ apiKey: key ?? '', baseURL: 'https://api.anthropic.com' })
  mkdirSync(outDir, { recursive: true })

  afterAll(() => {
    if (!rows.length) return
    const total = rows.reduce((s, r) => s + r.usd, 0)
    console.log(`\n${MODEL}: ${rows.length} cases, $${total.toFixed(2)} in all, slowest ${Math.max(...rows.map((r) => r.seconds)).toFixed(1)} s`)
    console.table(rows.map((r) => ({ ...r, usd: r.usd.toFixed(3), seconds: r.seconds.toFixed(1) })))
    writeFileSync(join(outDir, 'summary.json'), JSON.stringify(rows, null, 1))
    console.log(`Drafts written to ${outDir}`)
  })

  for (const c of CASES) {
    it(c.name, async () => {
      const started = Date.now()
      const result = await draftAiForm(client, { description: c.description, source: c.source ?? '', language: (c.language ?? 'es') as AiFormLanguage, model: MODEL })
      const seconds = (Date.now() - started) / 1000
      const u = result.message.usage
      const price = PRICES[result.message.model] ?? PRICES[MODEL] ?? { input: 0, output: 0, cacheRead: 0 }
      const usd = ((u.input_tokens ?? 0) * price.input + (u.output_tokens ?? 0) * price.output + (u.cache_read_input_tokens ?? 0) * price.cacheRead) / 1e6
      const fields = result.outcome === 'drafted' ? result.draft.fields : []
      rows.push({ case: c.name, outcome: result.outcome, servedBy: result.message.model, seconds, blocks: fields.length, inTok: u.input_tokens ?? 0, outTok: u.output_tokens ?? 0, usd })
      writeFileSync(join(outDir, `${c.name.replace(/\W+/g, '-')}.json`), JSON.stringify(result.outcome === 'drafted' ? result.draft : { outcome: result.outcome }, null, 1))

      expect.soft(seconds, 'well inside the route timeout').to.be.lessThan(TIME_BUDGET_MS / 1000)
      if (c.expect.outcome === 'drafted_or_empty') {
        expect.soft(['drafted', 'empty']).to.include(result.outcome)
      } else {
        expect(result.outcome).to.equal('drafted')
      }
      if (result.outcome !== 'drafted') return
      const draft = result.draft
      const text = labels(fields)

      if (c.expect.minBlocks) expect.soft(fields.length, 'blocks').to.be.at.least(c.expect.minBlocks)
      if (c.expect.maxBlocks) expect.soft(fields.length, 'blocks').to.be.at.most(c.expect.maxBlocks)
      if (c.expect.category !== undefined) expect.soft(draft.category, 'category').to.equal(c.expect.category)
      if (c.expect.signature) expect.soft(fields.some((f) => f.type === 'signature'), 'ends in a signature').to.equal(true)
      for (const phrase of c.expect.keeps ?? []) expect.soft(text, `keeps "${phrase}"`).to.contain(phrase.toLowerCase())
      for (const phrase of c.expect.never ?? []) expect.soft(text, `never "${phrase}"`).not.to.contain(phrase.toLowerCase())
      for (const [field, type] of Object.entries(c.expect.links ?? {})) {
        expect.soft(fields.some((f) => f.patientField === field && f.type === type), `links ${field}`).to.equal(true)
      }
      expect.soft(inventedLegalDetails(fields), 'invents no tax ID, street or postcode').to.deep.equal([])
      if (c.expect.notSpanish) expect.soft(text, 'written in the language asked').not.to.match(/[¿¡]|\b(?:usted|paciente|dolor)\b/)
    })
  }
})

if (!key) {
  describe('Create with AI', () => {
    it.skip('needs ANTHROPIC_API_KEY or ~/.quiroflow-eval-anthropic-key', () => {})
  })
}
