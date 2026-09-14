<template>
  <!-- Mirrors DashboardBody's grid so nothing jumps when the data lands. -->
  <div class="flex animate-pulse flex-col gap-4" aria-hidden="true">
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      <div v-for="i in 5" :key="i" class="h-[92px] rounded-card border border-line bg-surface shadow-card" />
    </div>
    <div class="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div class="h-[268px] rounded-card border border-line bg-surface shadow-card" />
      <div class="flex flex-col gap-3">
        <div class="h-[136px] rounded-card border border-brand-tintBorder bg-brand-tint" />
        <div class="h-[120px] rounded-card border border-line bg-surface shadow-card" />
      </div>
    </div>
    <div class="grid gap-3 xl:grid-cols-2">
      <div class="h-[262px] rounded-card border border-line bg-surface shadow-card" />
      <div class="h-[262px] rounded-card border border-line bg-surface shadow-card" />
    </div>
  </div>
</template>
