import { describe, it, expect } from 'vitest'
import { practiceHubAppointmentRows, practiceHubPatientNumberMap, practiceHubPatientRows, practiceHubUtc, practiceHubWallClock } from '../../utils/practicehubApiRows'

// The Patients and Appointments importers can read PracticeHub's Classic API
// instead of a CSV export. These pin the API -> row mapping to the shapes the
// live API returned on 30 Oct 2026, which is where the CSV and the API differ.
describe('PracticeHub API records as import rows', () => {
  const practitioners = [{ id: 9, first_name: 'Marta', last_name: 'Ruiz' }]
  const referralSources = [{ id: 12, name: 'Google' }]
  const patients = [
    {
      id: 501,
      patient_number: '202400007',
      custom_reference: 'X4188023T',
      first_name: 'Lucía',
      last_name: 'Ferrer',
      email: 'lucia@example.test',
      dob: '1990-04-02',
      created: '2024-03-05T09:15:00.000000Z',
      balance: '-45.00',
      locale: 'fr',
      note: 'Dolor lumbar<br />Revisar en 3 semanas',
      numbers: [
        { number: '600 11 22 33', type: 'Mobile', iso2: 'es' },
        { number: '01 23 45 67 89', type: 'Other', iso2: 'fr' },
        { number: '611 44 55 66', type: 'Mobile', iso2: 'es' },
      ],
      communication_preferences: { marketing: { sms: 1, email: 0 } },
      default_practitioners: [{ practitioner_id: 9 }],
      // Ids come back as strings here and as numbers from /referral_sources.
      referral_source_type: 'referral_source',
      referral_source_id: '12',
    },
    {
      id: 502,
      patient_number: 202400008,
      first_name: 'Iván',
      last_name: 'Torres',
      created: '2024-05-01T10:00:00.000000Z',
      referral_source_type: 'patient',
      referral_source_id: '501',
    },
    { id: 503, patient_number: '202400009', first_name: 'Nerea', last_name: 'Sanz', referral_source_type: 'patient', referral_source_id: '999' },
  ]

  it('keys a patient by their patient number, never their custom reference', () => {
    const [row] = practiceHubPatientRows(patients, { practitioners, referralSources })
    expect(row['Patient Number']).to.eq('202400007')
    expect(practiceHubPatientRows(patients, { practitioners, referralSources })[1]['Patient Number']).to.eq('202400008')
  })

  it('maps the fields the importer reads', () => {
    const [row] = practiceHubPatientRows(patients, { practitioners, referralSources, tagsByPatientNumber: new Map([['202400007', ['VIP', 'Embarazo']]]) })
    expect(row['Patient Created']).to.eq('2024-03-05T09:15:00.000Z')
    expect(row['Note']).to.eq('Dolor lumbar\nRevisar en 3 semanas')
    expect(row['Mobile']).to.eq('600 11 22 33')
    expect(row['Home']).to.eq('')
    // Every number the CSV had no column for: a second mobile was dropped.
    expect(row['Other Numbers']).to.eq('01 23 45 67 89\n611 44 55 66')
    expect(row['SMS Marketing']).to.eq('1')
    expect(row['Email Marketing']).to.eq('0')
    expect(row['Default Practitioner']).to.eq('Marta Ruiz')
    expect(row['Referral Source']).to.eq('Google')
    expect(row['Preferred Language']).to.eq('fr')
    expect(row['Account Balance']).to.eq('-45.00')
    expect(row['Tags']).to.eq('VIP, Embarazo')
  })

  it('names a referring patient, and leaves a deleted one blank as the CSV does', () => {
    const rows = practiceHubPatientRows(patients, { practitioners, referralSources })
    expect(rows[1]['Referral Source']).to.eq('Lucía Ferrer')
    expect(rows[2]['Referral Source']).to.eq('')
  })

  it('reads appointment times as the clinic’s wall clock, across the clock changes', () => {
    // 17:30 in Madrid: 15:30Z in summer, 16:30Z in winter. Read as UTC they
    // landed two hours late; read in the browser's zone, wherever that was.
    expect(practiceHubWallClock('2026-08-06 17:30:00', 'Europe/Madrid')?.toISOString()).to.eq('2026-08-06T15:30:00.000Z')
    expect(practiceHubWallClock('2026-01-12 17:30:00', 'Europe/Madrid')?.toISOString()).to.eq('2026-01-12T16:30:00.000Z')
    // The Sunday the clocks go back, after the change.
    expect(practiceHubWallClock('2026-10-25 10:00:00', 'Europe/Madrid')?.toISOString()).to.eq('2026-10-25T09:00:00.000Z')
    expect(practiceHubWallClock('2026-08-06 17:30:00', 'Atlantic/Canary')?.toISOString()).to.eq('2026-08-06T16:30:00.000Z')
    expect(practiceHubWallClock('2026-08-06T17:30:00Z', 'Europe/Madrid')?.toISOString()).to.eq('2026-08-06T17:30:00.000Z')
    expect(practiceHubWallClock('', 'Europe/Madrid')).to.eq(null)
  })

  it('reads PracticeHub created dates as UTC, with or without a zone', () => {
    expect(practiceHubUtc('2026-09-01 08:00:00')).to.eq('2026-09-01T08:00:00.000Z')
    expect(practiceHubUtc('2026-09-01T08:00:00.000000Z')).to.eq('2026-09-01T08:00:00.000Z')
    expect(practiceHubUtc('')).to.eq('')
    expect(practiceHubUtc('not a date')).to.eq('')
  })

  it('turns appointments into rows with names and the patient number', () => {
    const [row, orphan] = practiceHubAppointmentRows(
      [
        { id: 7001, patient_id: 501, practitioner_id: 9, appointment_type_id: 3, start: '2026-09-01 08:00:00', end: '2026-09-01 08:20:00', status: 'processed', note: 'Ajuste<br>cervical' },
        { id: 7002, patient_id: 404, practitioner_id: 9, appointment_type_id: 3, start: '2026-09-02 08:00:00', end: '2026-09-02 08:20:00', status: 'pending', note: null },
      ],
      { patients, practitioners, appointmentTypes: [{ id: 3, name: 'Ajuste' }] },
    )
    expect(row).to.deep.eq({
      'Internal Appt ID': '7001',
      'Patient Number': '202400007',
      'Start': '2026-09-01 08:00:00',
      'End': '2026-09-01 08:20:00',
      'Practitioner': 'Marta Ruiz',
      'Appointment Type': 'Ajuste',
      'Status': 'processed',
      'Note': 'Ajuste\ncervical',
    })
    // A patient PracticeHub has since deleted: no number, so the importer
    // counts the visit as having no patient.
    expect(orphan['Patient Number']).to.eq('')
  })

  it('maps a custom reference from a CSV back to the patient number', () => {
    const map = practiceHubPatientNumberMap(patients)
    expect(map.get('X4188023T')).to.eq('202400007')
    expect(map.size).to.eq(1)
  })
})
