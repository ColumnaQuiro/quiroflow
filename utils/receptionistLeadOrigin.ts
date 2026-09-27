// Where an AI receptionist's lead came from, and what the prompt says about it.
//
// A plain module (no Nuxt auto-imports) so the unit tests can pin it.

/**
 * Where a lead came from, as far as the lead record knows.
 *
 * Read from the record rather than asked for, because a clinic's prices can
 * turn on it -- a first visit can cost less for someone who came from the
 * clinic's ad than for anyone else -- and asking "how did you hear about us?" of
 * somebody who has just filled in the clinic's own ad form is both redundant
 * and the one question that makes an automated reply look automated.
 */
export interface LeadOrigin {
  channel: string | null
  source: string | null
  externalSource: string | null
  campaign: string | null
  ad: string | null
}

/**
 * Whether the record says this lead answered an ad. Meta lead-ad forms arrive
 * as channel 'facebook'; attribution rows name a campaign or ad even when a
 * lead was entered some other way.
 */
export function cameFromAd(origin: LeadOrigin): boolean {
  return (
    origin.channel === 'facebook' ||
    origin.externalSource === 'facebook' ||
    Boolean(origin.campaign?.trim() || origin.ad?.trim()) ||
    /^meta ads\b/i.test(origin.source ?? '')
  )
}

/**
 * The prompt section stating what is already known about how this person
 * found the clinic. Deliberately does not name the campaign: its name is
 * internal ("27/01/24 - Open - Valencia +8Km ...") and a model given it will
 * sooner or later repeat it to a patient.
 */
export function leadOriginSection(origin: LeadOrigin): string {
  if (cameFromAd(origin)) {
    return [
      '# What you already know about this person',
      'They came to the clinic through one of its ads (Facebook / Instagram). You already know how they heard about the clinic, so never ask. Anything in the clinic knowledge that depends on coming from an ad applies to them.',
    ].join('\n')
  }
  const channel = origin.channel ? CHANNEL_WORDING[origin.channel] ?? origin.channel : null
  if (!channel) return ''
  return [
    '# What you already know about this person',
    `They first contacted the clinic ${channel}. That is how they got in touch, not how they heard about the clinic: if an answer depends on that and the conversation does not already say, ask.`,
  ].join('\n')
}

const CHANNEL_WORDING: Record<string, string> = {
  whatsapp: 'on WhatsApp',
  sms: 'by SMS',
  phone: 'by phone',
  web: 'through the website',
  instagram: 'on Instagram',
  walk_in: 'in person at the clinic',
  facebook: 'on Facebook',
}
