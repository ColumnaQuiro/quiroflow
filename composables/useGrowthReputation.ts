// Reputation: what patients are saying in public, and the AI replies waiting
// for someone to approve them.
//
// Ratings are stored as numbers, not as the artboard's "★★★★☆" strings. A
// glyph string cannot be averaged, compared or sorted, and it tells a screen
// reader nothing -- the stars are a rendering of the number, so the number is
// what lives in the data.

export type ReviewPlatform = 'Google' | 'Doctoralia' | 'Facebook'
export type ReviewSentiment = 'positive' | 'mixed' | 'negative'

export interface Review {
  id: string
  rating: number
  author: string
  platform: ReviewPlatform
  location: string
  sentiment: ReviewSentiment
  when: string
  text: string
  /** How this review was answered, once it has been. */
  replyNote?: string
}

/** A reply the AI has written that no one has approved yet. */
export interface PendingReply {
  review: Review
  /** Extra context the front desk needs to judge the reply. */
  patientNote: string
  draft: string
  autoPostNote: string
}

export interface RatingBucket {
  stars: number
  count: number
}

export interface FunnelStep {
  label: string
  value: number
  /** Share of the step above, already worked out. */
  share?: string
}

export interface LocationRating {
  name: string
  rating: number
  reviews: number
}

export interface GrowthReputation {
  rating: number
  reviewCount: number
  yearDelta: string
  distribution: RatingBucket[]
  trendLabel: string
  trend: number[]
  trendAxis: string[]
  pendingCount: number
  pendingReply: PendingReply
  reviews: Review[]
  funnel: FunnelStep[]
  sendingAutomation: { name: string; enabled: boolean; detail: string }
  byLocation: LocationRating[]
  mostMentioned: { label: string; count: number }[]
}

const FIXTURE: GrowthReputation = {
  rating: 4.8,
  reviewCount: 412,
  yearDelta: '+38 this year',
  distribution: [
    { stars: 5, count: 354 },
    { stars: 4, count: 41 },
    { stars: 3, count: 9 },
    { stars: 2, count: 4 },
    { stars: 1, count: 4 },
  ],
  trendLabel: '4.5 → 4.8',
  trend: [4.5, 4.53, 4.52, 4.58, 4.6, 4.64, 4.63, 4.7, 4.73, 4.76, 4.78, 4.8],
  trendAxis: ['Oct 2025', 'Mar', 'Jun', 'Sep 2026'],
  pendingCount: 4,
  pendingReply: {
    review: {
      id: 'r-pending',
      rating: 3,
      author: 'Jordi Puigdemont',
      platform: 'Google',
      location: 'Gràcia',
      sentiment: 'mixed',
      when: '2 days ago',
      text: '"El tratamiento fue muy bueno y el dolor de espalda ha mejorado mucho, pero esperé 25 minutos más allá de mi hora y nadie me avisó."',
    },
    patientNote: 'Left 2 days ago · patient of Dr. Lizárraga · 3 visits',
    draft: 'Gracias por contarnos las dos cosas, Jordi. Nos alegra mucho que la espalda vaya mejor. La espera de 25 minutos no es aceptable y ya hemos ajustado la agenda de los martes por la tarde en Gràcia. Si quieres, te reservamos tu próxima sesión a primera hora para que no vuelva a pasar.',
    autoPostNote: 'Auto-posts in 22 h unless you edit it',
  },
  reviews: [
    {
      id: 'r-1',
      rating: 5,
      author: 'Alicia Sandoval',
      platform: 'Google',
      location: 'Sants',
      sentiment: 'positive',
      when: '3 days ago',
      text: '"Fui por una lumbalgia que arrastraba meses. La valoración inicial fue muy detallada y a la cuarta sesión ya dormía bien."',
      replyNote: 'Replied by Nerea Bilbao · 2 days ago',
    },
    {
      id: 'r-2',
      rating: 5,
      author: 'Daniel Okonkwo',
      platform: 'Doctoralia',
      location: 'Poblenou',
      sentiment: 'positive',
      when: '4 days ago',
      text: '"Booked on WhatsApp at 22:00 and had an appointment the next morning. Sports massage before my half marathon was exactly what I needed."',
      replyNote: 'Replied by AI · approved by Marta Ferrer',
    },
    {
      id: 'r-3',
      rating: 5,
      author: 'Rocío Alcántara',
      platform: 'Google',
      location: 'Sants',
      sentiment: 'positive',
      when: '6 days ago',
      text: '"Muy profesionales y puntuales. Me explicaron el plan de 12 visitas sin presionarme para nada."',
      replyNote: 'Replied by AI · approved by Nerea Bilbao',
    },
    {
      id: 'r-4',
      rating: 4,
      author: 'Marc Vilaseca',
      platform: 'Facebook',
      location: 'Gràcia',
      sentiment: 'positive',
      when: '1 week ago',
      text: '"Buen trato y resultados. El parking de la zona es complicado, id en metro."',
      replyNote: 'Replied by Nerea Bilbao · 6 days ago',
    },
    {
      id: 'r-5',
      rating: 5,
      author: 'Elisa Montalbán',
      platform: 'Google',
      location: 'Gràcia',
      sentiment: 'positive',
      when: '1 week ago',
      text: '"Llegué con una cervicalgia fuerte y salí notando la diferencia en la primera sesión. El shockwave ayudó mucho."',
      replyNote: 'Replied by AI · approved by Marta Ferrer',
    },
  ],
  funnel: [
    { label: 'Requests sent', value: 287 },
    { label: 'Opened', value: 214, share: '75%' },
    { label: 'Left a review', value: 38, share: '13%' },
  ],
  sendingAutomation: {
    name: 'Post-visit review request',
    enabled: true,
    detail: 'WhatsApp, 3 hours after a completed visit · skips anyone who left a review in the last 12 months · 143 runs in 30 days',
  },
  byLocation: [
    { name: 'Sants', rating: 4.9, reviews: 221 },
    { name: 'Gràcia', rating: 4.6, reviews: 118 },
    { name: 'Poblenou', rating: 4.8, reviews: 73 },
  ],
  mostMentioned: [
    { label: 'Dr. Ferrer', count: 64 },
    { label: 'Back pain', count: 51 },
    { label: 'Shockwave', count: 22 },
    { label: 'Waiting time', count: 9 },
  ],
}

export function useGrowthReputation() {
  const data = ref<GrowthReputation | null>(null)
  const loading = ref(true)
  /** Set once the pending draft has been dealt with, so the card can clear. */
  const pendingOutcome = ref<'approved' | 'discarded' | null>(null)

  onMounted(() => {
    data.value = structuredClone(FIXTURE)
    loading.value = false
  })

  function approvePending() {
    pendingOutcome.value = 'approved'
  }
  function discardPending() {
    pendingOutcome.value = 'discarded'
  }

  return { data, loading, pendingOutcome, approvePending, discardPending }
}
