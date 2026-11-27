import { describe, it, expect } from 'vitest'
import Papa from 'papaparse'
import { exerciseImportDelimiter, exerciseImportVideoLink, exerciseImportTemplateCsv, planExerciseImport } from '../../utils/exerciseImport'
import { videoEmbedUrl } from '../../utils/learn'

// The way ImportDialog.vue reads a file, so the tests cover the same path.
function read(text: string): string[][] {
  const body = text.replace(/^\uFEFF/, '')
  return Papa.parse<string[]>(body, { delimiter: exerciseImportDelimiter(body), skipEmptyLines: 'greedy' }).data
}

describe('exerciseImportVideoLink', () => {
  const id = 'aBc_12-xYz9'
  const watch = `https://www.youtube.com/watch?v=${id}`
  it.each([
    watch,
    `https://youtube.com/watch?v=${id}&list=PL123&index=2`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}`,
    `https://youtu.be/${id}?si=share123`,
    `youtu.be/${id}`,
    `www.youtube.com/watch?v=${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`,
    `  https://youtu.be/${id}  `,
  ])('reads %s as the watch address', (raw) => {
    expect(exerciseImportVideoLink(raw)).toBe(watch)
  })

  it('keeps Vimeo, which also plays inside the app', () => {
    expect(exerciseImportVideoLink('https://vimeo.com/123456789')).toBe('https://vimeo.com/123456789')
    expect(exerciseImportVideoLink('https://player.vimeo.com/video/123456789')).toBe('https://vimeo.com/123456789')
  })

  it('stores something every patient screen can play', () => {
    expect(videoEmbedUrl(exerciseImportVideoLink(`youtu.be/${id}`) as string)).toBe(`https://www.youtube-nocookie.com/embed/${id}`)
  })

  it('has nothing for an empty cell and refuses anything else', () => {
    expect(exerciseImportVideoLink('')).toBeNull()
    expect(exerciseImportVideoLink('   ')).toBeNull()
    for (const bad of ['https://www.youtube.com/channel/UC123', 'https://example.com/video.mp4', 'javascript:alert(1)', 'not a link', 'https://www.youtube.com/watch']) {
      expect(exerciseImportVideoLink(bad)).toBe(false)
    }
  })
})

describe('reading a file', () => {
  it('takes a Spanish Excel export: `;`, a BOM, quoted fields with `;` and line breaks', () => {
    const text = '\uFEFFNombre;Vídeo YouTube;Instrucciones\r\n' + 'Puente de glúteo;https://youtu.be/aaaaaaaaaaa;"Tumbado; rodillas dobladas.\r\nSube la cadera, ""despacio""."\r\n'
    const plan = planExerciseImport(read(text), [])
    expect(plan.noNameColumn).toBe(false)
    expect(plan.rows).toEqual([
      {
        line: 2,
        name: 'Puente de glúteo',
        video: 'https://youtu.be/aaaaaaaaaaa',
        instructions: 'Tumbado; rodillas dobladas.\r\nSube la cadera, "despacio".',
        mediaUrl: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
        problem: null,
      },
    ])
  })

  it('takes a comma file with English headers in another order', () => {
    const text = 'description,name,video\n"Slow, controlled",Bird dog,https://www.youtube.com/watch?v=bbbbbbbbbbb\n'
    const [row] = planExerciseImport(read(text), []).rows
    expect(row).toMatchObject({ name: 'Bird dog', instructions: 'Slow, controlled', mediaUrl: 'https://www.youtube.com/watch?v=bbbbbbbbbbb', problem: null })
  })

  it('reads its own template', () => {
    expect(exerciseImportDelimiter(exerciseImportTemplateCsv())).toBe(';')
    const plan = planExerciseImport(read(exerciseImportTemplateCsv()), [])
    expect(plan.columns).toEqual({ name: 0, video: 1, instructions: 2 })
    expect(plan.rows).toEqual([])
  })

  it('says so when no column names the exercise', () => {
    expect(planExerciseImport(read('video;notas\nhttps://youtu.be/ccccccccccc;x\n'), []).noNameColumn).toBe(true)
  })
})

describe('planExerciseImport', () => {
  const header = ['nombre', 'video_youtube', 'instrucciones']

  it('flags a missing name, a link it cannot play, and names it already has', () => {
    const plan = planExerciseImport(
      [
        header,
        ['', 'https://youtu.be/ddddddddddd', 'sin nombre'],
        ['Plancha', 'https://example.com/plancha', ''],
        ['  rotación   TORÁCICA ', 'https://youtu.be/eeeeeeeeeee', ''],
        ['Gato-camello', '', 'Sin vídeo también vale'],
        ['', '', ''],
      ],
      ['Rotacion toracica'],
    )
    expect(plan.rows.map((r) => [r.line, r.problem])).toEqual([
      [2, 'missing_name'],
      [3, 'bad_video'],
      [4, 'exists'],
      [5, null],
    ])
    expect(plan.rows[3].mediaUrl).toBeNull()
  })

  it('creates a name repeated in the file once, and a broken copy does not take the name', () => {
    const plan = planExerciseImport(
      [
        header,
        ['Plancha lateral', 'https://example.com/x', ''],
        ['Plancha lateral', 'https://youtu.be/fffffffffff', ''],
        ['plancha  lateral', 'https://youtu.be/ggggggggggg', ''],
      ],
      [],
    )
    expect(plan.rows.map((r) => r.problem)).toEqual(['bad_video', null, 'repeated'])
  })
})
