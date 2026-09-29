<script setup lang="ts">
// Settings > Modalities saved a list of names with an Active switch, and
// nothing in QuiroFlow ever read it: no practitioner, appointment type or
// service carries a modality, and no report groups by one. So it left the
// Settings menu rather than keep asking clinics to maintain a list with no
// effect. The table and its rows stay; if modalities come to mean something
// (filtering the calendar or online booking, say), that is a feature to
// design, with this page coming back as part of it.
definePageMeta({ redirect: '/settings' })
</script>
