import { describe, it, expect } from 'vitest'
import { chooseChain } from '../../utils/verifactuSoap'

// An account has a test chain and, from its go-live moment, a production
// chain that starts again from nothing. One submission carries one chain and
// goes to that chain's service. Getting this wrong either puts test records
// on the production service -- which then holds records pointing at
// predecessors it never received -- or quietly spends production records on
// the test service, where they count for nothing.
describe('Which chain a submission is for', () => {
  const test = (sequence: number) => ({ sequence, environment: 'test' as const })
  const production = (sequence: number) => ({ sequence, environment: 'production' as const })

  it('sends nothing when nothing is owed', () => {
    expect(chooseChain([], 'production')).to.deep.eq({ environment: null, blocked: 'nothing-to-send' })
  })

  it('drains the test backlog first, even once the sender is on production', () => {
    // Records owed from 31 Dec go to the service they were chained for, in
    // order, before the first production record goes anywhere.
    expect(chooseChain([production(90), test(88), test(89)], 'production')).to.deep.eq({ environment: 'test', blocked: null })
  })

  it('sends production records once the sender is configured for production', () => {
    expect(chooseChain([production(90), production(91)], 'production')).to.deep.eq({ environment: 'production', blocked: null })
  })

  it('holds production records while the sender is still on test, and says why', () => {
    // Reaching production stays a deliberate act of configuration. Until
    // then the records stay owed rather than being spent on the test service.
    expect(chooseChain([production(90)], 'test')).to.deep.eq({ environment: 'production', blocked: 'production-not-enabled' })
  })

  it('keeps sending test records while the sender is on test', () => {
    expect(chooseChain([test(5), test(6)], 'test')).to.deep.eq({ environment: 'test', blocked: null })
  })
})
