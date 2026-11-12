import { describe, expect, it } from 'vitest'
import { PATIENT_IMAGE_MAX_EDGE, collectPatientStoragePaths, fitLongEdge, patientFileObjectPaths, patientFileThumbPath } from '../../utils/patientFileStorage'

// The paths here decide what is deleted from Storage, where nothing can be
// brought back. A path that is wrong removes the wrong clinical file, or
// leaves one behind that nothing can reach.

const ACCOUNT = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const PATIENT = '33333333-3333-4333-8333-333333333333'

describe('the size a photo is stored at', () => {
  it('brings the long edge down to the cap and keeps the proportions', () => {
    expect(fitLongEdge(4032, 3024, PATIENT_IMAGE_MAX_EDGE)).toEqual({ width: 2000, height: 1500, resized: true })
    // Portrait: the long edge is the height.
    expect(fitLongEdge(3024, 4032, PATIENT_IMAGE_MAX_EDGE)).toEqual({ width: 1500, height: 2000, resized: true })
  })

  it('never enlarges, and leaves a photo exactly at the cap alone', () => {
    expect(fitLongEdge(1200, 800, PATIENT_IMAGE_MAX_EDGE)).toEqual({ width: 1200, height: 800, resized: false })
    expect(fitLongEdge(2000, 1500, PATIENT_IMAGE_MAX_EDGE)).toEqual({ width: 2000, height: 1500, resized: false })
  })

  it('does not invent a size for an image whose size is unknown', () => {
    expect(fitLongEdge(0, 0, PATIENT_IMAGE_MAX_EDGE).resized).toBe(false)
    expect(fitLongEdge(5000, 0, PATIENT_IMAGE_MAX_EDGE).resized).toBe(false)
  })

  it('keeps a very thin image at least a pixel wide', () => {
    expect(fitLongEdge(10000, 2, 2000)).toEqual({ width: 2000, height: 1, resized: true })
  })
})

describe('where a thumbnail lives', () => {
  it('sits beside its file, under the same account and patient folder', () => {
    expect(patientFileThumbPath(`${ACCOUNT}/${PATIENT}/1699-espalda.jpg`)).toBe(`${ACCOUNT}/${PATIENT}/thumbs/1699-espalda.jpg.jpg`)
  })

  it('cannot collide for two files that differ only by extension', () => {
    expect(patientFileThumbPath('a/p/scan.png')).not.toBe(patientFileThumbPath('a/p/scan.jpg'))
  })

  it('copes with a path that has no folder', () => {
    expect(patientFileThumbPath('scan.png')).toBe('thumbs/scan.png.jpg')
  })
})

describe('the objects one file owns', () => {
  it('is the file and its recorded thumbnail', () => {
    expect(patientFileObjectPaths({ storage_path: 'a/p/x.jpg', thumb_path: 'a/p/thumbs/x.jpg.jpg' })).toEqual(['a/p/x.jpg', 'a/p/thumbs/x.jpg.jpg'])
  })

  it('still names the thumbnail when the row never recorded it', () => {
    // Stored, then the row update was lost: the object is there all the same.
    expect(patientFileObjectPaths({ storage_path: 'a/p/x.jpg', thumb_path: null })).toEqual(['a/p/x.jpg', 'a/p/thumbs/x.jpg.jpg'])
  })

  it('is nothing for a name-only import', () => {
    expect(patientFileObjectPaths({ storage_path: null, thumb_path: null })).toEqual([])
  })
})

describe('what a deleted patient leaves in storage', () => {
  it('collects files, thumbnails, the avatar, posture photos and their report', () => {
    const paths = collectPatientStoragePaths(ACCOUNT, {
      files: [
        { storage_path: `${ACCOUNT}/${PATIENT}/1-rx.jpg`, thumb_path: `${ACCOUNT}/${PATIENT}/thumbs/1-rx.jpg.jpg` },
        { storage_path: `${ACCOUNT}/${PATIENT}/2-informe.pdf`, thumb_path: null },
        { storage_path: null, thumb_path: null },
      ],
      photo: `${ACCOUNT}/${PATIENT}/9-foto.jpg`,
      postureViews: [{ front: { photo: `${ACCOUNT}/posture/abc/front.jpg` }, right: { photo: `${ACCOUNT}/posture/abc/right.jpg` }, back: null }],
    })
    expect(paths['patient-files'].sort()).toEqual(
      [
        `${ACCOUNT}/${PATIENT}/1-rx.jpg`,
        `${ACCOUNT}/${PATIENT}/thumbs/1-rx.jpg.jpg`,
        `${ACCOUNT}/${PATIENT}/2-informe.pdf`,
        `${ACCOUNT}/${PATIENT}/thumbs/2-informe.pdf.jpg`,
        `${ACCOUNT}/posture/abc/front.jpg`,
        `${ACCOUNT}/posture/abc/right.jpg`,
        `${ACCOUNT}/posture/abc/informe.pdf`,
      ].sort(),
    )
    expect(paths['patient-photos']).toEqual([`${ACCOUNT}/${PATIENT}/9-foto.jpg`])
  })

  it('never returns a path outside the account, whatever a row says', () => {
    const paths = collectPatientStoragePaths(ACCOUNT, {
      files: [
        { storage_path: `${OTHER}/${PATIENT}/theirs.jpg`, thumb_path: null },
        { storage_path: `${ACCOUNT}/../${OTHER}/sneaky.jpg`, thumb_path: null },
      ],
      photo: `${OTHER}/${PATIENT}/theirs.jpg`,
      postureViews: [{ front: { photo: `${OTHER}/posture/abc/front.jpg` } }],
    })
    expect(paths['patient-files']).toEqual([])
    expect(paths['patient-photos']).toEqual([])
  })

  it('lists a shared path once, and survives posture data that is not what it should be', () => {
    const file = { storage_path: `${ACCOUNT}/${PATIENT}/1.jpg`, thumb_path: null }
    const paths = collectPatientStoragePaths(ACCOUNT, { files: [file, file], photo: null, postureViews: [null, 'x', [], { front: 'not-an-object' }, { front: {} }] })
    expect(paths['patient-files']).toHaveLength(2)
    expect(paths['patient-photos']).toEqual([])
  })
})
