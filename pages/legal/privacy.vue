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

      <h1 class="mt-8 text-2xl font-semibold text-ink-900">Privacy Policy</h1>
      <p class="mt-1 text-[13px] text-ink-faint">Last updated: [date]</p>

      <div class="mt-8 rounded-card border border-line bg-surface p-5 text-[13.5px] leading-relaxed text-ink-700">
        <p class="font-medium text-ink-900">Who this policy covers -- and who it doesn't</p>
        <p class="mt-2">
          QuiroFlow ("we," "us") is the software platform clinics use to run their practice. For a clinic's own patient data -- appointments,
          clinical notes, billing, messages -- <strong>the clinic is the data controller</strong> and QuiroFlow is their data processor, acting only
          on the clinic's instructions (a separate Data Processing Agreement with each clinic covers that relationship). This policy describes what
          <em>QuiroFlow itself</em> does as a company: the account/staff data we hold directly, and our own role as a processor. It is not a
          substitute for the privacy notice a clinic gives its own patients -- each clinic is responsible for that.
        </p>
      </div>

      <section class="mt-8 space-y-6 text-[13.5px] leading-relaxed text-ink-700">
        <div>
          <h2 class="text-[15px] font-semibold text-ink-900">1. Who we are</h2>
          <p class="mt-2">[Legal company name], [registered address], [company registration number]. Contact: [privacy contact email].</p>
        </div>

        <div>
          <h2 class="text-[15px] font-semibold text-ink-900">2. What data we process, and why</h2>
          <ul class="mt-2 list-disc space-y-1.5 pl-5">
            <li><strong>Clinic staff accounts</strong> (name, email, role) -- to provide the service and manage access, under our contract with the clinic (GDPR Art. 6(1)(b)).</li>
            <li><strong>Patient data entered by clinics</strong> (appointments, clinical notes, billing, messages, uploaded files) -- processed strictly on each clinic's instructions, as their processor. We do not decide why this data is collected or how it's used.</li>
            <li><strong>Device/usage data</strong> (app opens, push-notification tokens) -- to operate and improve the mobile app.</li>
            <li><strong>Support communications</strong> -- to respond to clinics that contact us.</li>
          </ul>
        </div>

        <div>
          <h2 class="text-[15px] font-semibold text-ink-900">3. Where data is hosted</h2>
          <p class="mt-2">
            The primary database is hosted in the EU (Ireland). [Confirm and list hosting/CDN regions for the application layer, e.g. Netlify.]
          </p>
        </div>

        <div>
          <h2 class="text-[15px] font-semibold text-ink-900">4. Subprocessors</h2>
          <p class="mt-2">We use the following subprocessors. Each has its own data processing terms; several involve transfers outside the EU/EEA (noted below).</p>
          <ul class="mt-2 list-disc space-y-1.5 pl-5">
            <li><strong>Supabase</strong> (database, authentication) -- EU (Ireland) hosting.</li>
            <li><strong>Netlify</strong> (application hosting) -- [confirm region/transfer basis].</li>
            <li><strong>Meta Platforms, Inc.</strong> (WhatsApp Business Platform, for clinic-patient messaging) -- US-based; transfer basis: [confirm current EU-US Data Privacy Framework status / SCCs].</li>
            <li><strong>Stripe</strong> (payment processing) -- US-based; transfer basis: [confirm current EU-US Data Privacy Framework status / SCCs].</li>
            <li><strong>Google LLC / Firebase</strong> (push notifications) -- US-based; transfer basis: [confirm current EU-US Data Privacy Framework status / SCCs].</li>
            <li><strong>Resend</strong> (transactional email) -- [confirm hosting region and transfer basis].</li>
          </ul>
        </div>

        <div>
          <h2 class="text-[15px] font-semibold text-ink-900">5. How long we keep data</h2>
          <p class="mt-2">
            Account/staff data is kept for the duration of the contract with the clinic plus [X] afterward. Patient data retention is set by each
            clinic's own policy and applicable health-records law (e.g. Spain's Ley 41/2002 sets a 5-year minimum for clinical history, longer in
            some regions) -- QuiroFlow retains it only as long as the clinic's account remains active or as instructed.
          </p>
        </div>

        <div>
          <h2 class="text-[15px] font-semibold text-ink-900">6. Your rights</h2>
          <p class="mt-2">
            If you are a clinic staff member, contact us directly at [privacy contact email] to access, correct, or delete your account data. If
            you are a patient, please contact your clinic directly -- they are the data controller for your health data and are responsible for
            handling your request; we assist them as their processor.
          </p>
        </div>

        <div>
          <h2 class="text-[15px] font-semibold text-ink-900">7. Security</h2>
          <p class="mt-2">
            Data is encrypted in transit (HTTPS) and at rest. Access to patient data is restricted per clinic via row-level database security, so
            one clinic's staff cannot see another clinic's data. [Add any further security certifications/measures once confirmed.]
          </p>
        </div>

        <div>
          <h2 class="text-[15px] font-semibold text-ink-900">8. Supervisory authority</h2>
          <p class="mt-2">
            You can lodge a complaint with your local data protection authority -- in Spain, the
            <a href="https://www.aepd.es" target="_blank" rel="noopener" class="text-brand-text hover:text-brand-hover">Agencia Española de Protección de Datos (AEPD)</a>.
          </p>
        </div>

        <div>
          <h2 class="text-[15px] font-semibold text-ink-900">9. Changes to this policy</h2>
          <p class="mt-2">We'll update the date at the top of this page when this policy changes and, for material changes, notify clinics directly.</p>
        </div>
      </section>
    </div>
  </div>
</template>
