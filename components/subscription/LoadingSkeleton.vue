<template>
  <!-- Keeps the real layout so nothing jumps when the numbers land. No page
       spinner: the amount is the only thing worth waiting for. -->
  <div class="flex flex-col gap-4 lg:flex-row lg:gap-6">
    <div class="flex flex-1 flex-col gap-4">
      <SubscriptionCard>
        <div class="flex items-center gap-2.5">
          <UiSkeleton class="h-4 w-[92px] rounded" />
          <UiSkeleton class="h-[18px] w-[58px] rounded" />
          <span class="flex-1" />
          <UiSkeleton class="h-[30px] w-[104px] rounded" />
        </div>
        <div class="mt-3.5 flex flex-col gap-2.5">
          <UiSkeleton class="h-2.5 w-full rounded" />
          <UiSkeleton class="h-2.5 w-[62%] rounded" />
        </div>
        <div class="mt-4 flex items-center gap-3 border-t border-line-divider pt-3.5">
          <UiSkeleton class="h-3.5 w-[120px] rounded" />
          <UiSkeleton class="h-5 w-[74px] rounded" />
        </div>
      </SubscriptionCard>
      <SubscriptionCard>
        <div class="flex flex-col gap-5 lg:flex-row">
          <div v-for="n in 3" :key="n" class="flex flex-1 flex-col gap-2.5">
            <UiSkeleton class="h-2.5 w-[104px] rounded" />
            <UiSkeleton class="h-4 w-[86px] rounded" />
            <UiSkeleton class="h-[5px] w-full rounded" />
          </div>
        </div>
      </SubscriptionCard>
    </div>
    <div class="lg:w-[356px]">
      <SubscriptionCard>
        <div class="flex flex-col gap-3">
          <UiSkeleton class="h-2.5 w-[92px] rounded" />
          <UiSkeleton class="h-[26px] w-[140px] rounded" />
          <UiSkeleton class="h-2.5 w-full rounded" />
          <UiSkeleton class="h-2.5 w-[64%] rounded" />
        </div>
      </SubscriptionCard>
    </div>
  </div>
</template>
