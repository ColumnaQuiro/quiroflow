<script setup lang="ts">
// Retired. It drove a local Playwright script through a PracticeHub login to
// fetch each file, fed by a CSV importer that nothing opened any more. Import >
// Files does the job over PracticeHub's API and fills in any file that came
// across as a name only; Settings > Files counts what is still missing. Kept
// as a redirect for bookmarks.
definePageMeta({ redirect: '/settings/files' })
</script>
