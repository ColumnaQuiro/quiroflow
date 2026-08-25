<script setup lang="ts">
const { pingAppOpen } = useAppOpenPing()
const code = ref('')
const error = ref('')
const loading = ref(false)

async function onSubmit() {
  error.value = ''
  loading.value = true
  const slug = code.value.trim().toLowerCase()
  const { error: rpcError } = await pingAppOpen(slug)
  loading.value = false
  if (rpcError) {
    error.value = 'Clinic code not found -- check with your clinic.'
    return
  }
  localStorage.setItem('clinic_slug', slug)
  await navigateTo('/login')
}

// Staff already know their login and resolve via team_members, not the
// email-match RPC this code exists to disambiguate -- there's nothing for
// them to "join". clinic_gate_seen (not clinic_slug) marks the gate as
// handled so mobile/middleware/clinic-code.global.ts stops redirecting
// here, while leaving clinic_slug unset so useIdentity.ts's optional slug
// stays undefined for this device, same as before this gate existed.
function skipAsTeamMember() {
  localStorage.setItem('clinic_gate_seen', '1')
  navigateTo('/login')
}
</script>

<template>
  <div class="flex h-full items-center justify-center bg-surface-page px-6">
    <div class="w-full max-w-sm rounded-card border border-line bg-surface p-8 shadow-card">
      <img src="/logo/quiroflow-mark.svg" alt="" class="h-8 w-8" />
      <h1 class="mt-4 text-xl font-semibold text-ink-900">Join your clinic</h1>
      <p class="mt-1 text-sm text-ink-muted">
        Enter the code your clinic gave you, then sign up with the same email your clinic has on file for you -- both have to match.
      </p>
      <form class="mt-6 space-y-4" @submit.prevent="onSubmit">
        <div>
          <label class="block text-sm font-medium text-ink-700" for="code">Clinic code</label>
          <input
            id="code"
            v-model="code"
            type="text"
            required
            autocapitalize="none"
            autocorrect="off"
            class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>
        <p v-if="error" class="text-sm text-danger-text">{{ error }}</p>
        <UiBtn type="submit" variant="primary" class="w-full" :disabled="loading || !code.trim()">
          {{ loading ? 'Checking…' : 'Continue' }}
        </UiBtn>
      </form>
      <button type="button" class="mt-4 block w-full text-center text-sm text-ink-muted hover:text-ink-700" @click="skipAsTeamMember">
        I'm on the clinic's team &rarr;
      </button>
    </div>
  </div>
</template>
