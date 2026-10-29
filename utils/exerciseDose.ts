// How a home exercise's dose reads, everywhere it is shown: the patient's
// screen, the record, a programme. "3 × 10 · 2 veces al día", or, for a
// progressive one, "Progresivo · 2 veces al día" -- no fixed numbers, the
// patient builds up as they can (see the exercise_progressive_dose
// migration). Sets and reps typed before it was made progressive are not
// shown: progressive is the instruction, a number beside it would contradict it.

export interface ExerciseDose {
  sets: number | null
  reps: string | null
  frequency: string | null
  progressive?: boolean | null
}

type T = (en: string, es: string) => string

export function exerciseDoseLabel(d: ExerciseDose, t: T): string {
  const amount = d.progressive
    ? t('Progressive', 'Progresivo')
    : d.sets && d.reps
      ? `${d.sets} × ${d.reps}`
      : d.sets
        ? t(`${d.sets} sets`, `${d.sets} series`)
        : (d.reps ?? '')
  return [amount, d.frequency].filter(Boolean).join(' · ')
}

/** What a progressive dose asks of the patient, on their own screen. */
export function exerciseProgressiveHint(t: T): string {
  return t(
    'Start gently, without pain, and do a little more each time as you feel able.',
    'Empieza suave, sin dolor, y ve haciendo un poco más cada vez según te encuentres.',
  )
}
