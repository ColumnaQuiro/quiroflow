import { describe, it, expect } from 'vitest'
import { linkInvoicesToAppointments, type LinkableAppointment } from '../../utils/importInvoiceLink'

// Which visit a PracticeHub invoice lands on. Pure, so pinned here rather
// than through a seeded PracticeHub import.
const visit = (id: string, over: Partial<LinkableAppointment> = {}): LinkableAppointment => ({
  id,
  patientId: 'pat-1',
  externalReference: null,
  startsAt: '2026-09-09T12:45:00Z', // 14:45 in Madrid
  status: 'completed',
  clinicId: null,
  ...over,
})
const invoice = (ref: string, over: { patientId?: string; phAppointmentId?: string | null; createdAt?: string } = {}) => ({
  ref,
  patientId: 'pat-1',
  phAppointmentId: null,
  createdAt: '2026-09-09T14:34:44Z',
  ...over,
})

describe('Linking a PracticeHub invoice to its visit', () => {
  it("uses PracticeHub's own appointment id when it is here", () => {
    const links = linkInvoicesToAppointments([invoice('phinv-1', { phAppointmentId: '9851' })], [visit('a', { externalReference: '9851' })], new Set())
    expect(links.get('phinv-1')).to.equal('a')
  })

  it('falls back to the one visit that day when the id names an appointment that is not here', () => {
    // Beatriz López Ibáñez, 9 Sep: imported as 9851, deleted and re-created in
    // PracticeHub as 9876, invoiced against 9876.
    const links = linkInvoicesToAppointments([invoice('phinv-7202', { phAppointmentId: '9876' })], [visit('a', { externalReference: '9851' })], new Set())
    expect(links.get('phinv-7202')).to.equal('a')
  })

  it('links a visit entered in QuiroFlow, which carries no PracticeHub id at all', () => {
    const links = linkInvoicesToAppointments([invoice('phinv-2', { phAppointmentId: '9000' })], [visit('a')], new Set())
    expect(links.get('phinv-2')).to.equal('a')
  })

  it('leaves a visit that already has an invoice alone', () => {
    const links = linkInvoicesToAppointments([invoice('phinv-3')], [visit('a')], new Set(['a']))
    expect(links.has('phinv-3')).to.equal(false)
  })

  it('does not link to a cancelled or still-booked visit', () => {
    const links = linkInvoicesToAppointments([invoice('phinv-4')], [visit('a', { status: 'cancelled' }), visit('b', { status: 'booked' })], new Set())
    expect(links.size).to.equal(0)
  })

  it('links nothing when two visits that day could be the one', () => {
    const links = linkInvoicesToAppointments([invoice('phinv-5')], [visit('a'), visit('b', { startsAt: '2026-09-09T16:00:00Z' })], new Set())
    expect(links.size).to.equal(0)
  })

  it('links neither when two invoices reach for the same visit', () => {
    // A visit and a product sale on one day cannot be told apart by date.
    const links = linkInvoicesToAppointments([invoice('phinv-6'), invoice('phinv-7')], [visit('a')], new Set())
    expect(links.size).to.equal(0)
  })

  it("never lets a date match take a visit another invoice names by id", () => {
    const links = linkInvoicesToAppointments(
      [invoice('phinv-8'), invoice('phinv-9', { phAppointmentId: '100' })],
      [visit('a', { externalReference: '100' })],
      new Set(),
    )
    expect(links.get('phinv-9')).to.equal('a')
    expect(links.has('phinv-8')).to.equal(false)
  })

  it("reads the day at the clinic, not in UTC", () => {
    // 23:30 UTC on the 9th is 01:30 on the 10th in Madrid: the next day's visit.
    const links = linkInvoicesToAppointments(
      [invoice('phinv-10', { createdAt: '2026-09-09T23:30:00Z' })],
      [visit('a'), visit('b', { startsAt: '2026-09-10T08:00:00Z' })],
      new Set(),
      () => 'Europe/Madrid',
    )
    expect(links.get('phinv-10')).to.equal('b')
  })

  it("does not reach into another patient's visits", () => {
    const links = linkInvoicesToAppointments([invoice('phinv-11', { patientId: 'pat-2' })], [visit('a')], new Set())
    expect(links.size).to.equal(0)
  })
})
