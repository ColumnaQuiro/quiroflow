import { describe, it, expect } from 'vitest'
import {
  looksLikePdf,
  parsePracticeHubFormSubmissions,
  parsePracticeHubPatientIds,
  practiceHubFormPdfReferenceForDoc,
  practiceHubLoginOutcome,
} from '../../utils/practicehubWebPages'

// The signed original of a form exists only in a PDF PracticeHub's website
// renders for a signed-in member of staff. These are the answers that
// website gave on 10 Nov 2026, reduced to their shape.
describe("PracticeHub's website, as the signed-forms import reads it", () => {
  describe('signing in', () => {
    it('is in when PracticeHub says enter', () => {
      expect(practiceHubLoginOutcome({ step: 'enter', url: 'calendar' })).toEqual({ state: 'in' })
    })

    it('wants a code from the authenticator app, or the one it emailed', () => {
      expect(practiceHubLoginOutcome({ step: 'show_two_step_auth', auth_type: 'google' })).toEqual({ state: 'code', method: 'app', phone: null })
      expect(practiceHubLoginOutcome({ step: 'show_two_step_auth', auth_type: 'email', phone_available: true, phone_obfuscated: '*** *** 050' })).toEqual({
        state: 'code',
        method: 'email',
        phone: '*** *** 050',
      })
    })

    it('passes on why a sign-in was refused, without the markup', () => {
      expect(practiceHubLoginOutcome({ result: 'error', message: '<b>Invalid</b> email or password' })).toEqual({ state: 'refused', message: 'Invalid email or password' })
      expect(practiceHubLoginOutcome(null).state).toBe('refused')
    })

    it('waits when PracticeHub is limiting sign-ins', () => {
      expect(practiceHubLoginOutcome({ refresh: true })).toEqual({ state: 'wait' })
    })
  })

  it("finds each patient's website id in the list, once", () => {
    const row = (id: string) => ({ name: `<div class="status hidden">active</div>Ferrer, Lucía<div class="hidden patient-id">${id}</div>`, dob: 'N/A', balance: '<span>0.00</span>' })
    const parsed = parsePracticeHubPatientIds({ iTotalRecords: '3', iTotalDisplayRecords: '3', aaData: [row('abCDe1fgHi23jKL4'), row('zzCDe1fgHi23jKL9'), row('abCDe1fgHi23jKL4'), { name: 'no id here' }] })
    expect(parsed).toEqual({ ids: ['abCDe1fgHi23jKL4', 'zzCDe1fgHi23jKL9'], total: 3 })
    expect(parsePracticeHubPatientIds('<html>sign in</html>')).toEqual({ ids: [], total: 0 })
  })

  describe("one patient's submitted forms", () => {
    const submission = (id: number, form: string) => `
      <div class="form-submission">
        <div class="pull-left"><strong>Consentimiento</strong></div>
        <div class="pull-right">
          <a class="btn btn-xs btn-primary" target="_blank" href="/config/scripts/pdf_downloads/custom_form.php?form_id=${form}&amp;clientID=9A99AAAA&amp;patientID=ANP5DZPG">PDF</a>
          <a class="btn btn-xs btn-danger delete-form-response" data-id="${id}" href="#">Delete</a>
        </div>
      </div>`
    const links = '<div class="dropdown pull-right"><ul><li><a class="copy-url" data-url="/form/3DPBZDPJ/ANP5DZPG/Signed" href="#/">Copy URL</a></li></ul></div><h2>Submissions</h2>'

    it('pairs each response id with the path of its PDF', () => {
      expect(parsePracticeHubFormSubmissions({ files: '', forms: links + submission(228, '3DPBZDPJ') + submission(20, '62YR2PNW') })).toEqual([
        { responseId: '228', pdfPath: '/config/scripts/pdf_downloads/custom_form.php?form_id=3DPBZDPJ&clientID=9A99AAAA&patientID=ANP5DZPG' },
        { responseId: '20', pdfPath: '/config/scripts/pdf_downloads/custom_form.php?form_id=62YR2PNW&clientID=9A99AAAA&patientID=ANP5DZPG' },
      ])
    })

    it('is empty for a patient who has only form links, or an answer that is not the fragment', () => {
      expect(parsePracticeHubFormSubmissions({ forms: links })).toEqual([])
      expect(parsePracticeHubFormSubmissions(null)).toEqual([])
    })

    it('follows nothing but the PDF page on the clinic’s own PracticeHub', () => {
      const elsewhere = submission(7, 'X').replace('/config/scripts/pdf_downloads/custom_form.php', 'https://evil.example/custom_form.php')
      const otherScript = submission(8, 'X').replace('pdf_downloads/custom_form.php', 'forms/custom_form.php')
      expect(parsePracticeHubFormSubmissions({ forms: elsewhere + otherScript })).toEqual([])
    })
  })

  it('tells a PDF from the sign-in page PracticeHub answers with when signed out', () => {
    expect(looksLikePdf(new TextEncoder().encode('%PDF-1.7'))).toBe(true)
    expect(looksLikePdf(new TextEncoder().encode('<!DOCTYPE html>'))).toBe(false)
  })

  it('names the stored original after the form it belongs to', () => {
    expect(practiceHubFormPdfReferenceForDoc('PH-form-228')).toBe('PH-form-pdf-228')
    expect(practiceHubFormPdfReferenceForDoc('PH-form-template-2')).toBeNull()
    expect(practiceHubFormPdfReferenceForDoc(null)).toBeNull()
  })
})
