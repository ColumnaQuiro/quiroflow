<script setup lang="ts">
// Merged into /settings/payments, which now holds the payment methods and the
// Stripe connection together: both answer "how does money come in". Kept as
// a redirect because the old URL is in bookmarks and in older help messages.
definePageMeta({ redirect: '/settings/payments' })
</script>
