import { describe, it, expect } from 'vitest'
import { planProfilePhotos, practiceHubPhotoPath, sniffImageType } from '../../utils/practicehubProfilePhotos'

// Settings › Import › Patients brings each patient's PracticeHub profile
// photo across. PracticeHub's patient list had carried the link all along; nothing
// read it, so imported clinics showed initials where their photos had been.
describe('PracticeHub profile photos', () => {
  const link = 'https://phub-production.s3.amazonaws.com/1/patient/1/abc/?Signature=x'

  it('queues a photo for a patient here who has none', () => {
    const plan = planProfilePhotos(
      [{ id: 1, patient_number: '202400007', profile_image: link }],
      [{ id: 'p-1', external_reference: '202400007', photo_storage_path: null }],
    )
    expect(plan.queue).toEqual([{ phPatientId: 1, patientId: 'p-1', url: link }])
    expect(plan.alreadyHere).toBe(0)
  })

  it('leaves a photo already here alone, so one taken in QuiroFlow is never replaced', () => {
    const plan = planProfilePhotos(
      [{ id: 1, patient_number: 202400007, profile_image: link }],
      [{ id: 'p-1', external_reference: '202400007', photo_storage_path: 'acc/p-1/171-new.jpg' }],
    )
    expect(plan.queue).toEqual([])
    expect(plan.alreadyHere).toBe(1)
  })

  it('skips patients with no photo in PracticeHub and patients who are not here', () => {
    const plan = planProfilePhotos(
      [
        { id: 1, patient_number: '1', profile_image: null },
        { id: 2, patient_number: '2', profile_image: '  ' },
        { id: 3, patient_number: '3' },
        { id: 4, patient_number: '404', profile_image: link },
        { id: 5, patient_number: null, profile_image: link },
      ],
      [
        { id: 'p-1', external_reference: '1', photo_storage_path: null },
        { id: 'p-2', external_reference: '2', photo_storage_path: null },
        { id: 'p-3', external_reference: '3', photo_storage_path: null },
        { id: 'p-x', external_reference: null, photo_storage_path: null },
      ],
    )
    expect(plan).toEqual({ queue: [], alreadyHere: 0 })
  })

  it('tells a picture from whatever else was uploaded as the photo', () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toEqual({ contentType: 'image/jpeg', extension: 'jpg' })
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toEqual({ contentType: 'image/png', extension: 'png' })
    expect(sniffImageType(new TextEncoder().encode('GIF89a...'))?.extension).toBe('gif')
    expect(sniffImageType(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))?.extension).toBe('webp')
    // One real "profile photo" was a 2 MB PDF.
    expect(sniffImageType(new TextEncoder().encode('%PDF-1.7'))).toBeNull()
    expect(sniffImageType(new Uint8Array())).toBeNull()
  })

  it('stores a photo under one fixed name per patient, so a retry overwrites itself', () => {
    expect(practiceHubPhotoPath('acc', 'p-1', 'jpg')).toBe('acc/p-1/practicehub.jpg')
  })
})
