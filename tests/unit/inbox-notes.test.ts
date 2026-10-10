import { describe, it, expect } from 'vitest'
import { mentionParts, mentionQueryAt, mentionedIn, notesBetween, type InboxNote } from '../../utils/inboxNotes'

// Internal Inbox notes: placed among the messages by time, and their
// @mentions written, kept and drawn (utils/inboxNotes.ts).
const note = (id: string, at: string): InboxNote => ({ id, conversation_key: 'k', author_id: null, body: '', mentions: [], created_at: at })

describe('Where a note sits in the thread', () => {
  const notes = [note('a', '2026-10-10T09:00:00Z'), note('b', '2026-10-10T10:00:00Z'), note('c', '2026-10-10T11:00:00Z')]
  it('goes after the message before it and up to the next', () => {
    expect(notesBetween(notes, null, '2026-10-10T09:30:00Z').map((n) => n.id)).toEqual(['a'])
    expect(notesBetween(notes, '2026-10-10T09:30:00Z', '2026-10-10T10:00:00Z').map((n) => n.id)).toEqual(['b'])
    expect(notesBetween(notes, '2026-10-10T10:00:00Z', null).map((n) => n.id)).toEqual(['c'])
  })
})

describe('Mentions', () => {
  const team = [{ id: '1', full_name: 'Ana Gil' }, { id: '2', full_name: 'Ana' }, { id: '3', full_name: 'Luis Mora' }]
  it('sends only to the people still named in the text', () => {
    expect(mentionedIn('@Luis Mora mira esto', team)).toEqual(['3'])
    expect(mentionedIn('sin menciones', team)).toEqual([])
    // "@Ana Gil" is Ana Gil, not also the colleague called Ana.
    expect(mentionedIn('@Ana Gil y @Ana', team).sort()).toEqual(['1', '2'])
    expect(mentionedIn('@Ana Gil', team)).toEqual(['1'])
  })
  it('draws the longest name that matches', () => {
    expect(mentionParts('Hola @Ana Gil, llama', ['Ana', 'Ana Gil'])).toEqual([
      { text: 'Hola ', mention: false },
      { text: '@Ana Gil', mention: true },
      { text: ', llama', mention: false },
    ])
  })
  it('suggests after an @ at the start of a word only', () => {
    expect(mentionQueryAt('Hola @lu', 8)).toEqual({ start: 5, query: 'lu' })
    expect(mentionQueryAt('correo@lu', 9)).toBe(null)
    expect(mentionQueryAt('sin arroba', 10)).toBe(null)
  })
})
