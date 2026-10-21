import { describe, it, expect } from 'vitest'
import { answerLine, formAnswers } from '../../utils/formAnswers'

const t = (en: string) => en

describe('formAnswers', () => {
  it('keeps the answered questions, formatted, and nothing else', () => {
    const fields = [
      { id: '1', type: 'heading', label: 'Your history' },
      { id: '2', type: 'short_text', label: 'First name', value: 'Ana', patientField: 'first_name' },
      { id: '3', type: 'long_text', label: 'Where does it hurt?', value: ' Lower back ' },
      { id: '4', type: 'choice', label: 'Since when', value: ['Weeks', 'Months'], multiple: true },
      { id: '5', type: 'scale', label: 'Pain today', value: 7 },
      { id: '6', type: 'rating', label: 'Sleep quality', value: 2 },
      { id: '7', type: 'checkbox', label: 'Previous surgery', value: true },
      { id: '8', type: 'checkbox', label: 'Pregnant', value: false },
      { id: '9', type: 'short_text', label: 'Medication', value: '' },
      { id: '10', type: 'signature', label: 'Signature', value: 'data:image/png;base64,xx' },
    ]
    expect(formAnswers(fields, t)).toEqual([
      { label: 'Where does it hurt?', text: 'Lower back' },
      { label: 'Since when', text: 'Weeks, Months' },
      { label: 'Pain today', text: '7/10' },
      { label: 'Sleep quality', text: '2/5' },
      { label: 'Previous surgery', text: 'Yes' },
    ])
  })

  it('reads nothing from a form that is not a list', () => {
    expect(formAnswers(null, t)).toEqual([])
  })

  it('writes an answer as one line of the note', () => {
    expect(answerLine({ label: 'Pain today', text: '7/10' })).toBe('Pain today: 7/10')
  })
})
