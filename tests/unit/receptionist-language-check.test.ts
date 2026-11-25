import { describe, expect, it } from 'vitest'
import { englishWordsInSpanish, languageNote, languageProblem, textLanguage, theirLanguage } from '../../utils/receptionistLanguageCheck'

// The language of a receptionist reply, checked in code
// (utils/receptionistLanguageCheck.ts).

describe('textLanguage', () => {
  it.each([
    ['Tu cita del martes 24 de noviembre se ha cambiado a las 12:00 con Natacha.', 'es'],
    ['Hola! Que tal? Queria consultar vuestros precios y disponibilidad para ajuste quiropractico', 'es'],
    ['Hola! Do you have any appointments later this afternoon?', 'en'],
    ['Thanks, see you on Tuesday at 12:00', 'en'],
  ])('reads %j as %s', (text, language) => {
    expect(textLanguage(text)).toBe(language)
  })

  it.each(['Confirmar', 'Ok', 'miércoles 2 · 16:30', 'Gràcies', 'Will Brown', '👍'])('cannot tell from %j', (text) => {
    expect(textLanguage(text)).toBeNull()
  })
})

describe('theirLanguage', () => {
  it('is that of their latest message that says, a button or a name saying nothing', () => {
    expect(theirLanguage(['Hello, I would like an appointment please', 'Confirmar'])).toBe('en')
    expect(theirLanguage(['Hello, I would like an appointment please', 'Mejor por la tarde, si puede ser'])).toBe('es')
  })

  it('leaves out the lines the history marks for the model', () => {
    expect(theirLanguage(['[Sent on Monday 23 November 2026]\nNo voy a poder ir esta semana'])).toBe('es')
    expect(theirLanguage(['[Image]'])).toBeNull()
  })
})

describe('englishWordsInSpanish', () => {
  it('finds the word of 22 Nov 2026', () => {
    expect(englishWordsInSpanish('¿Also cancelo la del lunes 30 de noviembre a las 17:00?')).toEqual(['Also'])
  })

  it('leaves names and quotes alone', () => {
    expect(englishWordsInSpanish('Tu cita queda a nombre de Will Brown, el martes 1 de diciembre a las 11:15.')).toEqual([])
    expect(englishWordsInSpanish('Me dices «thank you», y gracias a ti: nos vemos el martes.')).toEqual([])
  })

  it('finds nothing in a reply in English', () => {
    expect(englishWordsInSpanish('Thanks, your appointment is on Tuesday at 12:00.')).toEqual([])
  })
})

describe('languageProblem', () => {
  it('sends back a reply in English to someone writing in Spanish, and the other way round', () => {
    expect(languageProblem('Your appointment is now on Wednesday 2 December at 16:30.', 'es')).toEqual({ kind: 'wrong_language', theirs: 'es', reply: 'en' })
    expect(languageProblem('Tu cita queda el miércoles 2 de diciembre a las 16:30.', 'en')).toEqual({ kind: 'wrong_language', theirs: 'en', reply: 'es' })
  })

  it('sends back English words in a Spanish reply, even when their language cannot be told', () => {
    expect(languageProblem('¿Also cancelo la del lunes 30 de noviembre?', null)).toEqual({ kind: 'english_words', words: ['Also'] })
  })

  it('lets a reply in their language through', () => {
    expect(languageProblem('De acuerdo, mantienes tu primera visita del lunes 30 de noviembre a las 17:00.', 'es')).toBeNull()
    expect(languageProblem('Thanks, your visit stays on Monday 30 November at 17:00.', 'en')).toBeNull()
    expect(languageProblem('Vale.', null)).toBeNull()
  })

  it('tells the model what to fix', () => {
    expect(languageNote({ kind: 'english_words', words: ['Also'] })).toContain('"Also"')
    expect(languageNote({ kind: 'wrong_language', theirs: 'es', reply: 'en' })).toContain('Rewrite your reply in Spanish')
  })
})
