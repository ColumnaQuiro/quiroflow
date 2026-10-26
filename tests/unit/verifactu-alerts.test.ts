import { describe, it, expect } from 'vitest'
import {
  type UnacceptedRecord,
  verifactuCertificateAlertEmail,
  verifactuCertificateAlertKey,
  verifactuRecordsAlertEmail,
  verifactuRecordsToAlert,
} from '../../utils/verifactuAlerts'

// Who is told when the AEAT has not accepted a record, and what they read.
describe('VeriFactu alerts', () => {
  const now = new Date('2027-01-04T10:00:00Z')
  const record = (over: Partial<UnacceptedRecord> = {}): UnacceptedRecord => ({
    id: 'r1',
    serieNumber: 'F-2027-0001',
    generatedAt: '2027-01-04T09:30:00Z',
    environment: 'production',
    lastStatus: 'Incorrecto',
    lastErrorCode: '1100',
    lastErrorMessage: 'Valor o tipo incorrecto del campo.: NombreRazon',
    parked: true,
    ...over,
  })

  describe('which records', () => {
    it('alerts on a record still unaccepted after fifteen minutes', () => {
      expect(verifactuRecordsToAlert([record()], new Set(), now).map((r) => r.id)).to.deep.eq(['r1'])
    })

    it('waits while the sender may still be getting it through', () => {
      // Fourteen minutes: the sender retries every minute and parks after ten.
      expect(verifactuRecordsToAlert([record({ generatedAt: '2027-01-04T09:46:00Z' })], new Set(), now)).to.deep.eq([])
    })

    it('alerts once per record, not once a minute', () => {
      expect(verifactuRecordsToAlert([record()], new Set(['r1']), now)).to.deep.eq([])
    })

    it('includes a record that was never sent at all, e.g. while the certificate is blocked', () => {
      const unsent = record({ id: 'r2', lastStatus: null, lastErrorCode: null, lastErrorMessage: null, parked: false })
      expect(verifactuRecordsToAlert([unsent], new Set(), now).map((r) => r.id)).to.deep.eq(['r2'])
    })
  })

  describe('certificate warnings', () => {
    const notAfter = '2028-02-16T07:37:08+00:00'

    it('says nothing while more than 30 days are left', () => {
      expect(verifactuCertificateAlertKey(notAfter, 31)).to.eq(null)
    })

    it('warns at 30 days and again at 7, under different keys', () => {
      expect(verifactuCertificateAlertKey(notAfter, 30)).to.eq(`${notAfter}:30`)
      expect(verifactuCertificateAlertKey(notAfter, 12)).to.eq(`${notAfter}:30`)
      expect(verifactuCertificateAlertKey(notAfter, 7)).to.eq(`${notAfter}:7`)
    })

    it('keeps warning under the 7-day key once it has expired, so it is not re-sent', () => {
      expect(verifactuCertificateAlertKey(notAfter, -3)).to.eq(`${notAfter}:7`)
    })

    it('starts over for a renewed certificate', () => {
      expect(verifactuCertificateAlertKey('2030-02-16T00:00:00+00:00', 20)).not.to.eq(verifactuCertificateAlertKey(notAfter, 20))
    })
  })

  describe('the email', () => {
    const base = { clinicName: 'Clínica Demo', settingsUrl: 'https://app.quiroflow.com/settings/verifactu' }

    it('names the record and what the AEAT answered', () => {
      const { subject, html } = verifactuRecordsAlertEmail({ ...base, records: [record()], blocked: null })
      expect(subject).to.eq('VeriFactu: un registro sin aceptar por la AEAT en Clínica Demo')
      expect(html).to.contain('F-2027-0001')
      expect(html).to.contain('Incorrecto 1100')
      expect(html).to.contain('ya no se reintenta')
      expect(html).to.contain('Son registros reales')
    })

    it('says why nothing is being sent when the sender is blocked', () => {
      const { html } = verifactuRecordsAlertEmail({ ...base, records: [record({ lastStatus: null, parked: false })], blocked: 'no-passphrase' })
      expect(html).to.contain('Aún no se ha enviado')
      expect(html).to.contain('Falta la contraseña del certificado')
    })

    it('tells test records apart from real ones', () => {
      const { subject, html } = verifactuRecordsAlertEmail({ ...base, records: [record({ environment: 'test' }), record({ id: 'r2', environment: 'test' })], blocked: null })
      expect(subject).to.contain('2 registros')
      expect(html).to.contain('entorno de pruebas')
      expect(html).not.to.contain('Son registros reales')
    })

    it('escapes what the AEAT sent back', () => {
      const { html } = verifactuRecordsAlertEmail({ ...base, records: [record({ lastErrorMessage: '<b>x</b>' })], blocked: null })
      expect(html).to.contain('&lt;b&gt;x&lt;/b&gt;')
    })

    it('gives the expiry date of a certificate', () => {
      const { subject, html } = verifactuCertificateAlertEmail({ ...base, subject: null, notAfter: '2028-02-16T07:37:08+00:00', daysLeft: 7 })
      expect(subject).to.eq('VeriFactu: el certificado de Clínica Demo caduca en 7 días')
      expect(html).to.contain('16 de febrero de 2028')
    })
  })
})
