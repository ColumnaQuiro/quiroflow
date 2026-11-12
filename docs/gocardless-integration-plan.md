# GoCardless: domiciliaciones SEPA en QuiroFlow

Diseño, 12 nov 2026. **Fase 1 construida en la rama `feat/gocardless-direct-debit`**
(ver "Estado" al final). Motivo: un lead en PracticeHub cobra sus membresías por
domiciliación y teme que, al cambiar, los pacientes tengan que volver a firmar
y se pierdan. Nada de esto está construido; QuiroFlow hoy solo cobra
automáticamente con tarjeta (Stripe).

## 1. Lo que hemos comprobado

**En PracticeHub (Columnaquiro, Settings → Integrations, 11 nov):** Stripe y
GoCardless están conectados por OAuth a cuentas **de la clínica** (GoCardless:
organización "ColumnaQuiro", Live; Stripe: cuenta "Columnaquiro", solo
tarjeta). PracticeHub presenta GoCardless como la vía para "recurring and fixed
term memberships". Los mandatos SEPA viven en la cuenta GoCardless de la
clínica, no en PracticeHub.

**En GoCardless (docs de partners):**

- Los mandatos ya no están atados a la app que los creó: un partner conectado
  puede listar y **cobrar** mandatos hechos desde el dashboard, la API u otra
  integración. GoCardless incluso **exige** a los partners importar los
  mandatos existentes y emparejarlos con sus clientes (go-live checklist).
- Sobre las **suscripciones** creadas por otra integración, la documentación no
  dice si un partner puede leerlas, cambiarlas o cancelarlas, y remite a
  "contact API support". **El diseño no depende de poder hacerlo.**
- OAuth: `connect.gocardless.com/oauth/authorize` y `/oauth/access_token`
  (sandbox: `connect-sandbox.`). Scope `read_write`. El token es permanente
  (no caduca ni se refresca) y la respuesta trae `organisation_id`. Se revoca con
  `/oauth/revoke`.
- Un único endpoint de webhooks para todas las clínicas; cada evento lleva
  `links.organisation`. Cabecera `Webhook-Signature`. Al desconectar llega
  `organisations / disconnected`. Los eventos pueden llegar desordenados:
  siempre releer el recurso antes de actuar.
- El dinero está cobrado cuando el pago pasa a **`confirmed`** (`paid_out` es la
  transferencia a la clínica). Otros estados: `failed` (con
  `details.will_attempt_retry`), `charged_back` (devolución del paciente) y
  `chargeback_cancelled`.
- Los partners pueden cobrar un `app_fee` (como mucho el 50 % del pago). Es
  incompatible con el 10 % de revenue share sobre las comisiones de GoCardless.
- Para salir en Live: probar en sandbox, grabar un vídeo de demo, escribir una
  guía de usuario y mandarlo a partnerships@gocardless.com (responden en unos 5
  días hábiles). Si usamos sus páginas alojadas para firmar mandatos nuevos, no
  hace falta revisión de cumplimiento.

## 2. La idea en una frase

QuiroFlow se conecta a **la misma cuenta GoCardless** de la clínica, empareja
cada mandato existente con su paciente y crea **sus propias suscripciones
sobre esos mismos mandatos**. La suscripción de PracticeHub se cancela, nunca
el mandato. El paciente no firma nada y no nota el cambio.

## 3. Modelo de datos

Todo en una sola migración con timestamp. Lo que exige `CLAUDE.md` va marcado
con ⚠.

**`accounts`**
- `gocardless_organisation_id text unique`, `gocardless_environment text`
  (`live` | `sandbox`), `gocardless_verification_status text`.
- ⚠ Hay que añadirlas a `accounts_settings_permission()` con el permiso de
  Settings → Pagos; si no, solo un owner puede tocarlas.
- El token va en `account_secrets` como `gocardless_access_token` (añadirlo a
  `AccountSecretName`). Nunca en `accounts`.

**`patient_gocardless_mandates`** (nueva)
- `account_id`, `patient_id`, `gocardless_customer_id`, `gocardless_mandate_id`
  (unique), `status` (copia de GoCardless), `scheme`, `bank_name`,
  `account_number_ending` (solo los últimos dígitos: GoCardless prohíbe guardar
  datos bancarios completos), `origin` (`imported` | `created_here`),
  `matched_by` (`email` | `phone` | `name` | `manual`), `matched_at`.
- ⚠ Es una tabla con `patient_id`, así que necesita:
  - su línea en `merge_patients`;
  - su borrado en `anonymize_patient`;
  - `require_two_factor_on`;
  - un trigger de auditoría y su tipo de entidad en `audit_logs_entity_type_check`.

**`payment_schedules`** (se amplía en lugar de duplicarla, para que el informe
de membresías, el ledger y la ficha sigan funcionando sin cambios)
- `provider text not null default 'stripe'` (`stripe` | `gocardless`).
- `stripe_subscription_schedule_id` pasa a ser nullable, con un check: lo exige
  cuando `provider = 'stripe'`.
- `gocardless_subscription_id text unique` y `gocardless_mandate_id text`.
- Ya está en `merge_patients`.

**`gocardless_payment_events`** (nueva)
- Es el equivalente de `stripe_payment_events`: `gocardless_payment_id`,
  `gocardless_event_id`, `action`, `amount_cents`, `charge_date`.
- Índice único parcial sobre (`gocardless_payment_id`) donde
  `action = 'confirmed'`, para que el mismo cobro se contabilice una sola vez
  aunque el evento llegue repetido (la misma lección que
  `20260930142942_stripe_invoice_paid_once`).

**`payments`**: añadir `gocardless_payment_id text`. Es lo que enlaza una
devolución con el cobro al que corresponde.

**`payment_methods`**: sembrar `direct_debit` ("Domiciliación") en
`seed_payment_methods` y en las cuentas existentes, como método visible.

## 4. Servidor

Todo bajo `server/api/gocardless/`.

| Ruta | Qué hace |
|---|---|
| `connect/start.get.ts`, `connect/callback.get.ts` | OAuth, copiando la forma de `stripe/oauth/*`: nonce de `state` en una cookie y la cuenta sacada de la sesión, no del `state`. Guarda el token y `organisation_id`, y lee `verification_status`. |
| `disconnect.post.ts` | `/oauth/revoke`, borra el secreto y deja las suscripciones como "desconectada". |
| `webhook.post.ts` | Verifica `Webhook-Signature` (HMAC-SHA256 del cuerpo con el secreto del webhook), resuelve la clínica por `links.organisation` y despacha a `server/utils/gocardlessWebhookHandlers.ts`. |
| `mandates/index.get.ts` | Lista los mandatos `active,submitted,pending_submission` (con `include=customer`) y sugiere a qué paciente corresponde cada uno. |
| `mandates/match.post.ts`, `mandates/unmatch.post.ts` | Emparejar y desemparejar un mandato con un paciente. Es obligatorio según el checklist de GoCardless. |
| `subscriptions/create.post.ts` | Crea una suscripción para una `patient_membership` sobre su mandato: `amount`, `interval_unit` e `interval` según el periodo de la membresía, y `start_date`. Escribe la fila en `payment_schedules`. Usa claves de idempotencia. |
| `subscriptions/cancel.post.ts` | Cancela la suscripción. Nunca cancela el mandato. (Pausar queda para más adelante.) |
| `mandate-link.post.ts` | Fase 2: crea un Billing Request y devuelve la URL de la página alojada de GoCardless para que un paciente nuevo firme la domiciliación. |

**El cliente de GoCardless** (`server/utils/gocardless.ts`) es un `fetch` fino
sobre la API, sin SDK. Si alguna vez se usa SDK, se importa dentro de la
función que lo necesita, no arriba del archivo (⚠ `server/utils` entra en cada
arranque en frío).

**Qué hace cada evento del webhook:**

- `payments / confirmed`: busca el `payment_schedule` por la suscripción del
  pago y llama a la misma lógica que hoy usa Stripe en `recordMembershipCharge`:
  - factura en estado pagada, línea "Membresía — <mes>" y pago con
    `method: 'direct_debit'` y `gocardless_payment_id`;
  - factura VeriFactu con `issueFacturaServer`;
  - `countInstallment`;
  - dispara `membership.payment_processed`.

  Esa lógica se saca de `stripeWebhookHandlers.ts` a una función compartida
  que no depende del proveedor.
- `payments / failed`: añade un `membership_payments` con estado `failed` y avisa
  a recepción, como el fallo de Stripe. Si `will_attempt_retry` es true, no
  avisa todavía.
- `payments / charged_back`, o un fallo que llega después de `confirmed`: el
  dinero vuelve al paciente. **No se contabiliza el reembolso automáticamente**:
  un reembolso emite una factura rectificativa (VeriFactu), y eso se hace desde
  la ficha, como cualquier otro. El webhook pone el cobro programado en
  `past_due`, anota el periodo como fallido y crea una tarea para cada owner
  ("Domiciliación devuelta: registra el reembolso en la ficha…").
- `mandates / cancelled | failed | expired`: marca el mandato, pone la
  suscripción en `past_due` y avisa en la ficha del paciente.
- `organisations / disconnected`: borra el token y marca la cuenta como
  desconectada. Viene con `id: null`, así que no hay que descartarlo como
  duplicado.

**Reconciliación:** un cron diario `gocardless-reconcile-cron.post.ts` lista
los eventos de cada organización con `created_at[gt]` y procesa los que se
perdieron. ⚠ Hay que programarlo a mano con `cron.schedule`, y
`check:crons-scheduled` hará fallar el deploy si no se programa.

**Entorno:** `NUXT_GOCARDLESS_CLIENT_ID`, `NUXT_GOCARDLESS_CLIENT_SECRET`,
`NUXT_GOCARDLESS_WEBHOOK_SECRET` y `NUXT_GOCARDLESS_ENVIRONMENT`. Las variables
de CI (`e2e.yml`) apuntan a un stub, como ya se hace con Meta.

## 5. Pantallas

- **Settings → Pagos:** una tarjeta "GoCardless (domiciliación SEPA)" junto a
  la de Stripe. Muestra Conectar o Conectada, el nombre de la organización y
  el estado de verificación ("GoCardless aún no ha verificado tu cuenta: no
  puede cobrar"), y el botón Desconectar.
- **Settings → Importar → "Domiciliaciones de GoCardless":**
  - una tabla de mandatos con el paciente sugerido, para confirmar, cambiar o
    desemparejar cada uno;
  - en cada mandato, si GoCardless nos deja leerlo, si tiene **otra
    suscripción activa** (la de PracticeHub). Mientras la tenga, QuiroFlow no
    deja crear la suya en ese mandato. Es el freno contra cobrar dos veces;
  - un aviso fijo: "Cancela la suscripción en PracticeHub, **no el mandato**".
- **Ficha → Facturación:**
  - junto a "Tarjeta guardada", un bloque "Domiciliación" con el banco y los
    últimos dígitos (••1234) y su estado;
  - en el formulario de cobro automático de una membresía, elegir **Tarjeta** o
    **Domiciliación**;
  - fase 2: un botón "Enviar enlace de domiciliación", por WhatsApp o email,
    como el enlace de tarjeta.
- **Informes → Membresías:** una columna con el método de cobro, y los pagos
  domiciliados pendientes de confirmar como "En curso".
- **App del paciente:** fase 2, solo consulta (el banco y los últimos dígitos).
  ⚠ Lo que cambie en la web hay que replicarlo en `mobile/`.

## 6. La migración de una clínica que viene de PracticeHub

Se hace membresía a membresía, sin ningún día en que haya que cambiarlo todo:

1. **Importar pacientes y membresías.**
   - En PracticeHub 2.0 las membresías salen de sus care plans; la
     conversión ya existe (`utils/practicehubCarePlans.ts`, #878), pero todavía
     no escribe en la base de datos.
   - **En Classic no hay importador de membresías**, solo de bonos. Es un hueco
     que hay que cubrir antes que el lead (§8).
2. **Conectar GoCardless en QuiroFlow** con la misma cuenta. PracticeHub sigue
   conectado y sigue cobrando.
3. **Emparejar los mandatos** con los pacientes (§5).
4. **Para cada membresía:**
   - se mira la fecha del último cobro de PracticeHub;
   - se crea la suscripción de QuiroFlow empezando en el **siguiente** periodo;
   - se cancela la suscripción en PracticeHub o en el dashboard de GoCardless.

   La pantalla muestra en qué paso está cada membresía y no deja que dos
   suscripciones cobren el mismo periodo.
5. Cuando no queda ninguna, se **desconecta GoCardless en PracticeHub**.
   Antes hay que comprobar qué hace PracticeHub al desconectar (§8).

Las tarjetas que la clínica tenga en Stripe siguen la misma lógica (emparejar
clientes de Stripe existentes y crear la suscripción en QuiroFlow). Va como
proyecto aparte, pero la pantalla de importación debería servir para los dos.

## 7. Fases

1. **Fase 1, lo que necesita el lead:** conexión OAuth, webhook, importar y
   emparejar mandatos, suscripciones sobre mandatos existentes, la contabilidad
   de cobros (factura y VeriFactu), fallos y devoluciones, la reconciliación, y
   la pantalla de migración. Todo probado en sandbox, con specs de Cypress que
   usan un stub de GoCardless.
2. **Fase 2:** mandatos nuevos con Billing Request Flow (enlace al paciente),
   ofrecer la domiciliación al reservar online, y la app del paciente.
3. **Fase 3, opcional:** `app_fee` por cobro y bonos a plazos por domiciliación.

En paralelo a la fase 1 hay que **solicitar el alta como partner** (vídeo de
demo y guía de usuario). Sin ella no hay Live.

## 8. Decisiones y dudas abiertas

- **`app_fee` o revenue share:** son excluyentes. Hay que decidir si cobramos un
  importe por cada domiciliación o nos quedamos con el 10 % de las comisiones
  de GoCardless.
- **Suscripciones de PracticeHub:** hay que preguntar al soporte de API de
  GoCardless si un partner puede leerlas y cancelarlas. Si puede, la pantalla
  de migración cancela la de PracticeHub ella misma y el paso 4 es un solo clic.
- **Qué hace PracticeHub al desconectar GoCardless:** si solo revoca el token o
  si además cancela suscripciones o, peor, mandatos. Hay que probarlo con el
  sandbox o preguntarlo **antes** de prometerlo a una clínica.
- **Importador de membresías de PracticeHub Classic:** hay que ver si la API
  legacy expone las membresías (la v3 no tiene `patient_packages`, y Classic
  devuelve 0 care plans).
- **Cuándo contabilizar:** el diseño contabiliza en `confirmed`, cuando el
  dinero está cobrado. Si recepción quiere ver un cobro como "en curso" desde
  `submitted`, eso se hace en la vista, sin escribir en el ledger.

## 9. Estado (12 nov 2026)

Construido (fase 1): la migración `20261112060227_gocardless_direct_debit`;
`server/utils/gocardless.ts`, `gocardlessWebhookHandlers.ts` y
`membershipCharges.ts` (compartido con Stripe); las rutas
`server/api/gocardless/*` (connect/start, connect/callback, disconnect,
status, webhook, mandates, mandates/match, mandates/unmatch,
subscriptions/create, subscriptions/cancel, reconcile-cron); la tarjeta de
Ajustes → Pagos; el paso "Domiciliaciones (GoCardless)" en Ajustes → Importar;
y en la pestaña Facturación de la ficha, el cobro de la membresía con tarjeta o
con domiciliación. Tests: `tests/unit/gocardless.test.ts` y
`cypress/e2e/settings/gocardless-direct-debit.cy.ts`, contra un servidor falso
de GoCardless (`cypress/support/tasks/gocardless.ts`).

Antes de usarlo en producción:
- Variables `NUXT_GOCARDLESS_CLIENT_ID`, `NUXT_GOCARDLESS_CLIENT_SECRET`,
  `NUXT_GOCARDLESS_WEBHOOK_SECRET` y `NUXT_GOCARDLESS_ENVIRONMENT` en Netlify,
  sacadas de la app de partner de GoCardless (primero sandbox).
- Programar `gocardless/reconcile-cron` con pg_cron (una vez al día). Si no,
  `check:crons-scheduled` hará fallar el siguiente deploy.
- No se ha probado contra el sandbox real de GoCardless: solo contra el
  servidor falso.
