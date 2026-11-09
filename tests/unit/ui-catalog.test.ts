import { describe, it, expect } from 'vitest'
import { compileCatalog, translateWithCatalog } from '../../utils/uiCatalog'

// Portuguese and German are looked up by the English that t(en, es) was
// given -- which, for a template literal, arrives already interpolated.
describe('Interface catalog lookup', () => {
  const cat = compileCatalog({
    s: { Save: 'Guardar', 'en-GB': 'pt-PT' },
    p: {
      'Hello {0}': 'Olá {0}',
      '{0} of {1} left': 'Faltam {0} de {1}',
      'Moved {0} {1}': 'Reagendada {0} {1|time=vez|times=vezes}',
      '{0} {1}': '{0} {1|visit=consulta|visits=consultas}',
      'Close the plan. Back in Recalls in {0} {1}.': 'Fechar o plano. Volta às Reativações daqui a {0} {1|month=mês|months=meses}.',
      'Import {0} {1}': 'Importar {0} {1|note=nota|notes=notas}',
      'Import {0} care {1}': 'Importar {0} {1|plan=plano|plans=planos} de tratamento',
      '{0} · {1}': '{1} · {0}',
      'Bad {0}': 'Mau {3}',
    },
  })
  const tr = (en: string) => translateWithCatalog(cat, en)

  it('finds plain strings exactly', () => {
    expect(tr('Save')).to.eq('Guardar')
    expect(tr('en-GB')).to.eq('pt-PT')
  })

  it('matches an interpolated string back to its pattern and keeps the values', () => {
    expect(tr('Hello Ana María')).to.eq('Olá Ana María')
    expect(tr('3 of 10 left')).to.eq('Faltam 3 de 10')
  })

  it('maps an English word captured in a placeholder through its word list', () => {
    expect(tr('Moved 1 time')).to.eq('Reagendada 1 vez')
    expect(tr('Moved 4 times')).to.eq('Reagendada 4 vezes')
    expect(tr('Close the plan. Back in Recalls in 2 months.')).to.eq('Fechar o plano. Volta às Reativações daqui a 2 meses.')
  })

  it('lets a pattern of only placeholders match nothing but the words it lists', () => {
    expect(tr('3 visits')).to.eq('3 consultas')
    expect(tr('Ana López')).to.eq('Ana López')
  })

  it('prefers the more specific pattern', () => {
    expect(tr('Import 2 care plans')).to.eq('Importar 2 planos de tratamento')
    expect(tr('Import 5 notes')).to.eq('Importar 5 notas')
  })

  it('ignores patterns with nothing to translate, and translations using placeholders the English lacks', () => {
    expect(tr('a · b')).to.eq('a · b')
    expect(tr('Bad thing')).to.eq('Bad thing')
  })

  it('shows anything it does not know in English', () => {
    expect(tr('Something new')).to.eq('Something new')
  })
})
