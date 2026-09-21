<script setup lang="ts">
// The confirmation email, rendered beside the "check your email" screen so the
// person knows what they are hunting for in an inbox full of other mail.
defineProps<{ email: string }>()

const t = useT()
</script>

<template>
  <OnboardingPreview
    :eyebrow="t('Just sent', 'Recién enviado')"
    :title="t(`This is what's waiting in your inbox`, 'Esto es lo que te espera en tu bandeja')"
    :body="t('One button, one link, no account details in the message.', 'Un botón, un enlace, y ningún dato de la cuenta en el mensaje.')"
  >
    <OnboardingPreviewFragment :top="246" :width="700">
      <div class="border-b border-line-divider p-4">
        <p class="text-[15px] font-semibold text-ink-900">{{ t('Confirm your email to open QuiroFlow', 'Confirma tu correo para abrir QuiroFlow') }}</p>
        <div class="mt-[9px] flex items-center gap-[9px]">
          <img src="/logo/quiroflow-mark.svg" alt="" class="h-[26px] w-[26px]" />
          <div class="min-w-0 flex-1">
            <div class="text-[12.5px] text-ink-700"><span class="font-semibold">QuiroFlow</span> &lt;hola@quiroflow.com&gt;</div>
            <div class="mt-0.5 truncate text-[12px] text-ink-muted">{{ t('to', 'para') }} {{ email }}</div>
          </div>
          <span class="shrink-0 text-[12px] text-ink-muted">21 Sep · 10:04</span>
        </div>
      </div>

      <div class="px-4 py-5">
        <p class="text-[14px] leading-[1.6] text-ink-700">{{ t('Hi there,', 'Hola,') }}</p>
        <p class="mt-2.5 text-[14px] leading-[1.6] text-ink-700">
          {{
            t(
              `Confirm this address and we'll pick up where you left off — naming your practice and adding your first clinic.`,
              'Confirma esta dirección y seguimos donde lo dejaste: el nombre de tu consulta y tu primera clínica.',
            )
          }}
        </p>
        <span class="mt-4 inline-flex h-10 items-center rounded-ctl bg-brand px-[18px] text-[14px] font-semibold text-white">
          {{ t('Confirm email address', 'Confirmar dirección') }}
        </span>
        <p class="mt-4 text-[12.5px] leading-[1.55] text-ink-muted">
          {{
            t(
              `The link expires in 60 minutes and can only be used once. If you didn't create a QuiroFlow account, you can ignore this message — nothing was set up.`,
              'El enlace caduca en 60 minutos y solo se puede usar una vez. Si no creaste una cuenta de QuiroFlow, ignora este mensaje: no se ha configurado nada.',
            )
          }}
        </p>
      </div>

      <div class="border-t border-line-divider bg-surface-subtle px-4 py-[13px]">
        <p class="text-[11.5px] leading-[1.5] text-ink-muted">
          {{
            t(
              'QuiroFlow · Practice management for chiropractic clinics · Data processed in the EU',
              'QuiroFlow · Gestión para clínicas de quiropráctica · Datos tratados en la UE',
            )
          }}
        </p>
      </div>
    </OnboardingPreviewFragment>
  </OnboardingPreview>
</template>
