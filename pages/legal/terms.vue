<script setup lang="ts">
definePageMeta({ layout: false })
</script>

<template>
  <div class="min-h-screen bg-surface-page">
    <div class="mx-auto max-w-[720px] px-6 py-16">
      <NuxtLink to="/" class="text-[13px] font-medium text-brand-text hover:text-brand-hover">&larr; QuiroFlow</NuxtLink>

      <div class="mt-6 rounded-card border border-warning-border bg-warning-bg px-4 py-3 text-[13px] text-warning-text">
        <strong>Draft — pending legal review.</strong> This page has not been reviewed by a lawyer and should not be published or relied on until
        it has been. Placeholders in brackets need real business/legal details filled in before this goes live.
      </div>

      <h1 class="mt-8 text-2xl font-semibold text-ink-900">Terms of Service</h1>
      <p class="mt-1 text-[13px] text-ink-faint">Last updated: [date]</p>

      <section class="mt-8 space-y-6 text-[13.5px] leading-relaxed text-ink-700">
        <div>
          <h2 class="text-[15px] font-semibold text-ink-900">1. Who this applies to</h2>
          <p class="mt-2">
            These terms govern use of QuiroFlow by clinics ("you," "the clinic") and their staff. Patients using the app or portal are covered by
            the clinic's own patient-facing terms, not these.
          </p>
        </div>

        <div>
          <h2 class="text-[15px] font-semibold text-ink-900">2. The service</h2>
          <p class="mt-2">
            QuiroFlow provides practice-management software: scheduling, patient records, billing, and messaging. [Describe subscription/pricing
            terms, trial terms if any.]
          </p>
        </div>

        <div>
          <h2 class="text-[15px] font-semibold text-ink-900">3. Your data, your responsibility</h2>
          <p class="mt-2">
            You control what patient data goes into QuiroFlow and what you use it for -- you are the data controller for that data, we are your
            processor under a separate Data Processing Agreement. You're responsible for having a lawful basis and, where required, your patients'
            consent for how you use the platform (e.g. sending marketing messages requires their opt-in, separate from their treatment consent).
          </p>
        </div>

        <div>
          <h2 class="text-[15px] font-semibold text-ink-900">4. Acceptable use</h2>
          <p class="mt-2">
            [Standard acceptable-use clause: no unlawful use, no attempting to access another clinic's data, no reverse engineering, etc. -- to be
            drafted with counsel.]
          </p>
        </div>

        <div>
          <h2 class="text-[15px] font-semibold text-ink-900">5. Availability and support</h2>
          <p class="mt-2">[Uptime commitments if any, support channels, planned-maintenance notice.]</p>
        </div>

        <div>
          <h2 class="text-[15px] font-semibold text-ink-900">6. Fees and payment</h2>
          <p class="mt-2">[Pricing, billing cycle, late-payment/suspension terms.]</p>
        </div>

        <div>
          <h2 class="text-[15px] font-semibold text-ink-900">7. Termination and data export</h2>
          <p class="mt-2">
            [Notice period, what happens to clinic data on termination, how a clinic can export their patient data before/after closing their
            account -- this needs an actual export feature to back it up.]
          </p>
        </div>

        <div>
          <h2 class="text-[15px] font-semibold text-ink-900">8. Liability</h2>
          <p class="mt-2">[Liability limitations -- to be drafted with counsel, particularly given the sensitivity of health data involved.]</p>
        </div>

        <div>
          <h2 class="text-[15px] font-semibold text-ink-900">9. Governing law</h2>
          <p class="mt-2">[Governing law and jurisdiction -- likely Spain, to be confirmed with counsel.]</p>
        </div>
      </section>
    </div>
  </div>
</template>
