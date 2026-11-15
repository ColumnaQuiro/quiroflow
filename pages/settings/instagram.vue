<script setup lang="ts">
// Instagram DMs and Facebook Messenger, connected together because they are
// one connection: the Facebook Page the Instagram account is linked to. Its
// token sends both, and its `messages` subscription delivers both.
//
// Connect only. There used to be fields to paste an account id and a Page
// token by hand, from a clinic's own Meta app -- but replying to the public
// from your own app needs that app to pass Meta's review for
// instagram_manage_messages, so those fields could at best receive. The
// platform app has passed it (Nov 2026), and connecting through it is the
// only route that both receives and replies.

interface Status {
  instagramUserId: string | null
  messengerPageId: string | null
  hasToken: boolean
  username: string | null
  pageName: string | null
  error: string | null
}

interface ConnectResult {
  connected: boolean
  instagramUserId?: string
  username?: string | null
  pageName?: string | null
  messengerPageId?: string | null
  choose?: { instagramUserId: string; username: string | null; pageName: string | null }[]
  ticket?: string
}

const t = useT()
const { showToast } = useToast()
const meta = useFacebookPageConnect('instagram')

const status = ref<Status | null>(null)
const loading = ref(true)
const connecting = ref(false)
// Set when one grant reached several Instagram accounts: the clinic picks
// here, and the ticket carries the rest back to the server.
const choices = ref<NonNullable<ConnectResult['choose']>>([])
const ticket = ref('')
const choicesEl = ref<HTMLElement | null>(null)
// The last thing that went wrong, kept on the card: a toast is gone in four
// seconds, and Meta's reason is usually the only clue to what to do next.
const connectError = ref('')
const confirmingDisconnect = ref(false)
const disconnecting = ref(false)

async function load() {
  try {
    status.value = await useStaffFetch<Status>('/api/meta/instagram')
  } catch (err: any) {
    connectError.value = err?.data?.statusMessage ?? t('Could not load the connection.', 'No se pudo cargar la conexión.')
  } finally {
    loading.value = false
  }
}
onMounted(load)

const connected = computed(() => Boolean(status.value?.instagramUserId))
const replying = computed(() => connected.value && Boolean(status.value?.hasToken))
const handle = computed(() => (status.value?.username ? `@${status.value.username}` : status.value?.instagramUserId ?? ''))

async function connect() {
  connecting.value = true
  choices.value = []
  connectError.value = ''
  try {
    const code = await meta.launch()
    const result = await useStaffFetch<ConnectResult>('/api/meta/instagram/connect', { method: 'POST', body: { code } })
    if (result.choose?.length && result.ticket) {
      choices.value = result.choose
      ticket.value = result.ticket
      // Nothing is connected until they pick, and coming back from Meta's
      // popup they are not looking at this card: say so, and bring it into view.
      showToast(t('One more step: choose which Instagram account is this clinic’s.', 'Un paso más: elige cuál es la cuenta de Instagram de esta clínica.'), 'info', 8000)
      await nextTick()
      choicesEl.value?.scrollIntoView({ behavior: smoothScroll(), block: 'center' })
      return
    }
    await connected_(result)
  } catch (err: any) {
    // Closing Meta's dialog is not a failure (see WhatsAppConnectCard).
    if (err?.message === 'CANCELLED') return
    failed(err)
  } finally {
    connecting.value = false
  }
}

async function pick(instagramUserId: string) {
  connecting.value = true
  connectError.value = ''
  try {
    const result = await useStaffFetch<ConnectResult>('/api/meta/instagram/connect', { method: 'POST', body: { ticket: ticket.value, instagramUserId } })
    choices.value = []
    ticket.value = ''
    await connected_(result)
  } catch (err: any) {
    failed(err)
  } finally {
    connecting.value = false
  }
}

function failed(err: any) {
  connectError.value = err?.data?.statusMessage ?? err?.message ?? t('Could not connect Instagram.', 'No se pudo conectar Instagram.')
  showToast(connectError.value, 'error')
}

async function connected_(result: ConnectResult) {
  const who = result.username ? `@${result.username}` : result.instagramUserId
  showToast(t(`Instagram connected: ${who}.`, `Instagram conectado: ${who}.`), 'success')
  await load()
}

async function disconnect() {
  disconnecting.value = true
  try {
    await useStaffFetch('/api/meta/instagram', { method: 'DELETE' })
    confirmingDisconnect.value = false
    showToast(t('Instagram and Messenger disconnected.', 'Instagram y Messenger desconectados.'), 'success')
    await load()
  } catch (err: any) {
    showToast(err?.data?.statusMessage ?? t('Could not disconnect.', 'No se pudo desconectar.'), 'error')
  } finally {
    disconnecting.value = false
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Instagram & Messenger', 'Instagram y Messenger')" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-4 pb-24 sm:px-6 sm:pt-6 lg:pb-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[940px] flex-1 flex-col gap-4" data-cy="instagram-settings" :data-ready="loading ? undefined : 'true'">
          <p class="text-[13.5px] text-ink-muted">
            {{ t('Direct messages to your Instagram account and your Facebook Page arrive in the Inbox beside WhatsApp, and you answer them from there.', 'Los mensajes directos a tu cuenta de Instagram y a tu página de Facebook llegan a la Bandeja junto a WhatsApp, y los respondes desde allí.') }}
          </p>

          <UiSkeleton v-if="loading" class="h-40 w-full rounded-card" />
          <section v-else aria-labelledby="h-ig" class="overflow-hidden rounded-card border border-line bg-surface">
            <div class="flex flex-wrap items-start gap-4 px-[18px] pb-3.5 pt-4">
              <div class="min-w-[240px] flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <h2 id="h-ig" class="text-[16px] font-bold text-ink-900">{{ t('Instagram', 'Instagram') }}</h2>
                  <UiPill v-if="replying" tone="success" dot data-cy="instagram-status">{{ t('Receiving and replying', 'Recibe y responde') }}</UiPill>
                  <UiPill v-else-if="connected" tone="warning" dot data-cy="instagram-status">{{ t('Receiving only', 'Solo recibe') }}</UiPill>
                  <UiPill v-else tone="neutral" data-cy="instagram-status">{{ t('Not connected', 'Sin conectar') }}</UiPill>
                </div>
                <p v-if="connected" class="mt-1 text-[14px] font-semibold text-ink-900" data-cy="instagram-account">{{ handle }}</p>
                <p v-else class="mt-1 text-[13px] leading-snug text-ink-muted">
                  {{ t('Sign in with Meta and tick your Instagram professional account and the Facebook Page it is linked to.', 'Inicia sesión con Meta y marca tu cuenta profesional de Instagram y la página de Facebook a la que está vinculada.') }}
                </p>
                <p v-if="connected && !replying" class="mt-1 text-[12.5px] leading-snug text-warning-text">
                  {{ t('Connected without a Page token, so replies cannot be sent. Reconnect to fix it.', 'Conectada sin token de página, así que no se pueden enviar respuestas. Vuelve a conectar para arreglarlo.') }}
                </p>
              </div>
              <div v-if="meta.available.value" class="flex flex-wrap gap-2">
                <UiBtn :variant="connected ? 'secondary' : 'primary'" :disabled="connecting" data-cy="instagram-connect" @click="connect">
                  {{ connecting ? t('Connecting…', 'Conectando…') : connected ? t('Reconnect', 'Volver a conectar') : t('Connect Instagram', 'Conectar Instagram') }}
                </UiBtn>
                <UiBtn v-if="connected" variant="ghost" data-cy="instagram-disconnect" @click="confirmingDisconnect = true">{{ t('Disconnect', 'Desconectar') }}</UiBtn>
              </div>
            </div>

            <p v-if="!meta.available.value" class="border-t border-line-row px-[18px] py-3 text-[13px] text-ink-muted2">
              {{ t('Not available on this deployment yet.', 'Aún no disponible en esta instalación.') }}
            </p>

            <div v-if="choices.length" ref="choicesEl" role="group" aria-labelledby="h-ig-choose" class="flex flex-col gap-2 border-t border-brand-tint bg-brand-tint px-[18px] py-3.5" data-cy="instagram-choices">
              <strong id="h-ig-choose" class="text-[14.5px] text-ink-900">{{ t('One more step: which Instagram account is this clinic’s?', 'Un paso más: ¿cuál es la cuenta de Instagram de esta clínica?') }}</strong>
              <p class="text-[13px] leading-snug text-ink-500">{{ t('Meta shared more than one account with QuiroFlow. Nothing is connected until you choose.', 'Meta ha compartido más de una cuenta con QuiroFlow. No se conecta nada hasta que elijas.') }}</p>
              <div class="flex flex-wrap gap-2">
                <UiBtn v-for="c in choices" :key="c.instagramUserId" variant="primary" :disabled="connecting" :data-instagram-user-id="c.instagramUserId" @click="pick(c.instagramUserId)">
                  {{ c.username ? `@${c.username}` : c.instagramUserId }}<span v-if="c.pageName" class="ml-1 font-normal opacity-80">· {{ c.pageName }}</span>
                </UiBtn>
              </div>
            </div>

            <p v-if="connectError || status?.error" role="alert" class="border-t border-line-row px-[18px] py-2.5 text-[13px] font-semibold text-danger-text" data-cy="instagram-connect-error">
              {{ connectError || t(`Meta did not accept the stored token: ${status?.error}. Reconnect to fix it.`, `Meta no ha aceptado el token guardado: ${status?.error}. Vuelve a conectar para arreglarlo.`) }}
            </p>

            <!-- Messenger is not a second connection: it is the Page Instagram already goes through. -->
            <div class="flex flex-wrap items-center gap-3 border-t border-line-row px-[18px] py-3.5" data-cy="messenger-status">
              <div class="flex min-w-[240px] flex-1 flex-col gap-0.5">
                <strong class="text-[14.5px] text-ink-900">{{ t('Facebook Messenger', 'Facebook Messenger') }}<template v-if="status?.pageName"> · {{ status.pageName }}</template></strong>
                <span class="text-[13px] leading-snug text-ink-500">
                  {{
                    status?.messengerPageId
                      ? t('Messages to the same Facebook Page arrive in the Inbox as well, and you can answer them there.', 'Los mensajes a la misma página de Facebook también llegan a la Bandeja, y puedes responderlos desde allí.')
                      : connected
                        ? t('Reconnect and the Facebook Page you tick receives Messenger here too.', 'Vuelve a conectar y la página de Facebook que marques también recibirá Messenger aquí.')
                        : t('Comes with Instagram: the Facebook Page you tick receives Messenger here too.', 'Viene con Instagram: la página de Facebook que marques también recibirá Messenger aquí.')
                  }}
                </span>
              </div>
              <UiPill v-if="status?.messengerPageId && replying" tone="success" dot>{{ t('Receiving and replying', 'Recibe y responde') }}</UiPill>
              <UiPill v-else-if="status?.messengerPageId" tone="warning" dot>{{ t('Receiving only', 'Solo recibe') }}</UiPill>
              <UiPill v-else tone="neutral">{{ t('Not connected', 'Sin conectar') }}</UiPill>
            </div>
          </section>

          <p class="text-[12.5px] leading-snug text-ink-muted2">
            {{ t('Instagram and Messenger only let a business reply within 24 hours of the person’s last message. After that the conversation waits for them to write again.', 'Instagram y Messenger solo dejan responder a una empresa en las 24 horas siguientes al último mensaje de la persona. Pasado ese plazo, la conversación espera a que vuelva a escribir.') }}
          </p>
        </div>
      </div>
    </div>

    <UiConfirmDialog
      v-if="confirmingDisconnect"
      tone="danger"
      :title="t('Disconnect Instagram and Messenger?', '¿Desconectar Instagram y Messenger?')"
      :confirm-label="disconnecting ? t('Disconnecting…', 'Desconectando…') : t('Disconnect', 'Desconectar')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :busy="disconnecting"
      @confirm="disconnect"
      @cancel="confirmingDisconnect = false"
    >
      <p class="text-[13.5px] leading-snug text-ink-700">
        {{ t(`New messages to ${handle || 'this account'} and its Facebook Page will stop arriving in the Inbox. Conversations already here stay.`, `Los nuevos mensajes a ${handle || 'esta cuenta'} y a su página de Facebook dejarán de llegar a la Bandeja. Las conversaciones que ya están aquí se quedan.`) }}
      </p>
    </UiConfirmDialog>
  </div>
</template>
