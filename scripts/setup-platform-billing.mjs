// Creates (or updates) QuiroFlow's own billing catalogue -- the three plan
// products, the extra-practitioner seat and the Growth add-on -- in a Stripe
// account, and prints the price ids to paste into `plans` and `addons`.
//
// This is QuiroFlow billing its CLINIC CUSTOMERS for using the product. It is
// NOT the Connect account that bills a clinic's own patients: those are
// deliberately separate Stripe accounts and separate keys (see
// server/utils/platformBillingStripe.ts), so that a bug in one can never
// reach the other's data. Run this with the platform-billing key only.
//
// Safe to re-run. Products are upserted by their fixed ids (starter / pro /
// clinic / extra-professional / the Growth product), and a price is only
// created when no active
// price on that product already has the same amount and interval -- Stripe
// prices are immutable, so changing an amount means creating a new one and
// repointing `plans` at it. Nothing is ever archived or deleted here; old
// prices stay active so existing subscriptions keep billing at the rate their
// customer agreed to.
//
// Usage:
//   npm install stripe
//   STRIPE_PLATFORM_BILLING_SECRET_KEY=sk_live_... node scripts/setup-platform-billing.mjs
//
// Add --dry-run to print what it would do without writing anything.

import Stripe from 'stripe'

const KEY = process.env.STRIPE_PLATFORM_BILLING_SECRET_KEY
const DRY = process.argv.includes('--dry-run')

if (!KEY) {
  console.error('STRIPE_PLATFORM_BILLING_SECRET_KEY is not set.')
  console.error('This must be QuiroFlow\'s OWN billing account -- not the Connect account that charges patients.')
  process.exit(1)
}

const stripe = new Stripe(KEY, { apiVersion: '2026-07-29.dahlia' })

// The catalogue. Amounts are in cents, EUR. `annual` is the monthly-equivalent
// rate under annual billing -- the Stripe price is that x12 on a yearly
// interval, which is the shape `plans.annual_price_cents` already assumes
// (see 0132_billing_plans_and_subscriptions.sql).
const CATALOGUE = [
  {
    id: 'starter',
    planId: 'starter',
    name: 'QuiroFlow Solo',
    description:
      '1 practitioner, 1 site. Unlimited patients, unlimited admin users. Calendar with automatic room assignment, WhatsApp, online booking, recalls, campaigns, forms and billing.',
    monthly: 5900,
    annual: 5000,
  },
  {
    id: 'pro',
    planId: 'pro',
    name: 'QuiroFlow Practice',
    description:
      'Up to 3 practitioners, 1 site. Everything in Solo plus custom roles and permissions, and advanced reporting (PVA, retention, conversion). Extra practitioners €29/mo.',
    monthly: 11900,
    annual: 9900,
  },
  {
    id: 'clinic',
    planId: 'clinic',
    name: 'QuiroFlow Clinic',
    description:
      'Up to 6 practitioners, unlimited sites. Everything in Practice plus multi-site, API access and webhooks, assisted migration and priority support. Extra practitioners €29/mo.',
    monthly: 19900,
    annual: 16900,
  },
  {
    // Growth is an add-on, not a plan -- it attaches to whichever plan the
    // account is on, which is why it has no planId and why its prices live in
    // `addons` rather than in a column on `plans`.
    //
    // The id is Stripe's own rather than a readable `growth`, because this
    // product was created in the dashboard (which cannot set a product id)
    // before it was added here. Naming it `growth` would make the next run of
    // this script create a SECOND Growth product with duplicate prices, and
    // the price ids already in `addons` -- the ones customers would be billed
    // against -- point at this one. Only price ids are ever stored, so the
    // ugly id costs nothing.
    id: 'prod_VGYO3CyN90xQFT',
    planId: null,
    addonId: 'growth',
    name: 'QuiroFlow Growth',
    description: 'Lead pipeline, AI receptionist, campaign automations and reputation. An add-on for any plan.',
    monthly: 4900,
    annual: 3900,
  },
  {
    id: 'extra-professional',
    planId: null,
    name: 'QuiroFlow extra practitioner',
    description: 'One additional practitioner seat beyond those included in the plan.',
    // Deliberately the same 29 EUR either way, unlike the plans themselves --
    // `plans.extra_professional_price_cents` is a single column that
    // pages/subscription.vue reads for BOTH intervals, so an annual seat
    // priced any lower would be quoted at 29 EUR in the picker and billed at
    // less than that. The earlier 25 EUR annual price did exactly that.
    monthly: 2900,
    annual: 2900,
  },
]

async function upsertProduct(entry) {
  const body = {
    name: entry.name,
    description: entry.description,
    metadata: { source: 'quiroflow', ...(entry.planId ? { plan_id: entry.planId } : {}), ...(entry.addonId ? { addon_id: entry.addonId } : {}) },
  }
  try {
    const existing = await stripe.products.retrieve(entry.id)
    if (DRY) return { ...existing, ...body }
    return await stripe.products.update(entry.id, body)
  } catch (err) {
    if (err.code !== 'resource_missing') throw err
    if (DRY) return { id: entry.id, ...body }
    return await stripe.products.create({ id: entry.id, ...body })
  }
}

// Reuses an active price with the same amount and interval rather than piling
// up duplicates every run -- a re-run after changing nothing should be a no-op.
async function ensurePrice(productId, unitAmount, interval, nickname) {
  const { data: prices } = await stripe.prices.list({ product: productId, active: true, limit: 100 })
  const match = prices.find((p) => p.unit_amount === unitAmount && p.recurring?.interval === interval && p.currency === 'eur')
  if (match) return { price: match, created: false }
  if (DRY) return { price: { id: '(would create)', unit_amount: unitAmount }, created: true }
  const price = await stripe.prices.create({
    product: productId,
    currency: 'eur',
    unit_amount: unitAmount,
    nickname,
    recurring: { interval, interval_count: 1 },
  })
  return { price, created: true }
}

const account = await stripe.accounts.retrieve().catch(() => null)
const live = KEY.startsWith('sk_live_')
console.log(`\nStripe account: ${account?.id ?? 'unknown'}  (${live ? 'LIVE' : 'test/sandbox'})${DRY ? '  [dry run]' : ''}\n`)

const results = []
for (const entry of CATALOGUE) {
  const product = await upsertProduct(entry)
  const monthly = await ensurePrice(product.id, entry.monthly, 'month', `${entry.name} monthly (${entry.monthly / 100}€/mo)`)
  const annual = await ensurePrice(product.id, entry.annual * 12, 'year', `${entry.name} annual (${entry.annual / 100}€/mo equivalent)`)
  results.push({ entry, product, monthly, annual })
  console.log(
    `${entry.name}\n` +
      `  monthly ${String(entry.monthly / 100).padStart(3)}€    ${monthly.price.id}${monthly.created ? '  (created)' : '  (reused)'}\n` +
      `  annual  ${String(entry.annual / 100).padStart(3)}€/mo ${annual.price.id}${annual.created ? '  (created)' : '  (reused)'}`,
  )
}

const byId = Object.fromEntries(results.map((r) => [r.entry.id, r]))
const extra = byId['extra-professional']

console.log('\n--- SQL to point the plans table at these prices ---\n')
for (const planId of ['starter', 'pro', 'clinic']) {
  const r = byId[planId]
  console.log(
    `update plans set\n` +
      `  stripe_monthly_price_id = '${r.monthly.price.id}',\n` +
      `  stripe_annual_price_id = '${r.annual.price.id}',\n` +
      `  stripe_extra_professional_monthly_price_id = '${extra.monthly.price.id}',\n` +
      `  stripe_extra_professional_annual_price_id = '${extra.annual.price.id}'\n` +
      `where id = '${planId}';\n`,
  )
}

const growth = byId['prod_VGYO3CyN90xQFT']
console.log('--- SQL to point the addons table at these prices ---\n')
console.log(
  `update addons set\n` +
    `  stripe_monthly_price_id = '${growth.monthly.price.id}',\n` +
    `  stripe_annual_price_id = '${growth.annual.price.id}'\n` +
    `where id = 'growth';\n`,
)

console.log('--- Still to do by hand in the Stripe dashboard ---\n')
console.log('1. Webhook endpoint -> https://app.quiroflow.com/api/stripe/platform-billing-webhook')
console.log('   Events: customer.subscription.created, customer.subscription.updated, customer.subscription.deleted')
console.log('   Put the signing secret in STRIPE_PLATFORM_BILLING_WEBHOOK_SECRET.')
console.log('2. Activate the Customer Portal (Settings > Billing > Customer portal), or')
console.log('   "Manage payment method & invoices" on /subscription will fail.')
console.log('3. Set STRIPE_PLATFORM_BILLING_SECRET_KEY on the deployment.\n')
