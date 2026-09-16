<script setup lang="ts">
// Merged into /settings/app, which now covers the whole patient app: the
// join code, the store links, what patients may do, announcements, and the
// install counts. This stays as a redirect rather than being deleted
// because the split URL is in bookmarks, in the settings index people have
// scrolled past for months, and quite possibly in a message to a patient.
definePageMeta({ redirect: '/settings/app' })
</script>
