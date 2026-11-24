import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  parseQuirocitasBonoTypes,
  parseQuirocitasCajaMonth,
  parseQuirocitasFicha,
  parseQuirocitasHistory,
  parseQuirocitasInvoice,
  parseQuirocitasPatientList,
  quirocitasCajaButton,
  quirocitasCajaFormBody,
} from '../../utils/quirocitasPages'
import { QuirocitasClient, QuirocitasLedgerError } from '../../server/utils/quirocitas'
import {
  quirocitasAppointmentRows,
  quirocitasBonoRows,
  quirocitasDate,
  quirocitasLedgerMismatches,
  quirocitasLedgerRows,
  quirocitasNamesChiropractors,
  quirocitasPatientRow,
  quirocitasPhone,
  quirocitasPractitionerMatcher,
  quirocitasReadQueue,
  quirocitasReadState,
  quirocitasVisitNotes,
  splitQuirocitasName,
  QUIROCITAS_COPY_VERSION,
  type QuirocitasSnapshot,
} from '../../utils/quirocitasRows'

// Pages shaped like Quirocitas' own, cut down to what the parser reads. The
// people are invented.

const LIST = `<script>
var r_ = new Array(2);
r_[0] = {'id': '101', 'label': 'Laura Demo Prueba', 'tel': ['600111222', '', '']};
r_[1] = {'id': '102', 'label': 'Marc d\\'Exemple', 'tel': ['', '', '']};
</script>`

// One patient's record, as buscar.php renders it with operacio=editar: the
// search's appointment list, then the record form with its tables.
const FICHA = (id: string, name: string, extra = '') => `
<form action="buscar.php" method="post"><table><tr><th>Dia</th><th>Cita</th><th>Hora</th><th>Tipo</th><th>Quiro</th></tr>
<tr class="futuro"><td>-</td><td>----------</td><td>--:--</td><td>------</td><td>-----</td><td><input type="hidden" name="buscita_0" value="-1"></td></tr>
<tr class="pasado"><td>L</td><td>05-10-2026</td><td>15:45</td><td>Ajuste</td><td>Dra. Demo</td><td><input type="hidden" name="buscita_1" value="5001"></td></tr>
<tr class="ausencia"><td>L</td><td>12-10-2026</td><td>09:15</td><td>Charla</td><td>Dra. Demo</td><td><input type="hidden" name="buscita_2" value="5002"></td></tr>
<tr class="futuro"><td>L</td><td>09-11-2026</td><td>10:00</td><td>Ajuste</td><td>Dra. Demo</td><td><input type="hidden" name="buscita_3" value="5003"></td></tr>
</table></form>
<form method="post" enctype="multipart/form-data">
<input type="hidden" name="id_paciente" value="${id}">
<input type="text" name="nombre" value="${name}">
<input type="text" name="nif" value="12345678z">
<input type="text" name="nacimiento" value="23-01-1980">
<input type="text" name="calle" value="Carrer Demo 1"><input type="text" name="codigo" value="08001"><input type="text" name="poblacion" value="Barcelona">
<input type="text" name="profesion" value="Docent">
<select name="genero"><option value="no">...</option><option value="femenino" selected>Femenino</option></select>
<input type="checkbox" name="rgpd" value="Y" checked>
<select name="idioma"><option value="1">Castellano</option><option value="2" selected>Català</option></select>
<input type="radio" name="sms" value="0">No enviar mensajes
<input type="checkbox" name="mailings" value="N">No enviar mailings
<input type="radio" name="sms" value="1" checked><input type="text" name="tele1" value="600 11 12 22">
<input type="radio" name="sms" value="2"><input type="text" name="tele2" value="+44 7700 900123">
<input type="radio" name="sms" value="3"><input type="text" name="tele3" value="">
<input type="radio" name="sms" value="4"><input type="text" name="email1" value="laura@example.com">
<select name="suquiro"><option value="1" selected>Dra. Demo</option></select>
<select name="origen"><option value="-1"></option><option value="3" selected>Web</option></select>
<select name="inactivo"><option value="A" selected>Automático</option></select>
<img id="photo" src="${id}/photo.jpg?m=1626358501">
<textarea name="notas">Lumbar
desde 2024</textarea>
<input type="hidden" name="id_plan[1]" value="77"><input type="number" name="veces[1]" value="2"><select name="por[1]"><option value="1" selected>cada semana</option></select><input type="number" name="durante[1]" value="3">
<table><tr><th>Núm.</th><th>Cita</th><th>Hora</th><th>Tipo</th><th>Quiropr.</th><th>Pago</th><th>B</th><th>Motivo/Fact.</th></tr>
<tr class="futuro"><td>3</td><td>L</td><td>09-11-2026</td><td>10:00</td><td>Ajuste</td><td>Dra. Demo</td><td>0.00</td><td>&nbsp;</td><td><a href="factura.php?idcita=5003&amp;idpagobono=" target="factura"></a> </td></tr>
<tr class="ausencia"><td>-</td><td>L</td><td>12-10-2026</td><td>09:15</td><td>Charla</td><td>Dra. Demo</td><td>0.00</td><td>&nbsp;</td><td><a href="factura.php?idcita=5002&amp;idpagobono=" target="factura"></a> quan vol venir?</td></tr>
<tr class="cambio"><td>-</td><td>L</td><td>06-10-2026</td><td>16:00</td><td>Cambio</td><td>Dra. Demo</td><td>0.00</td><td>&nbsp;</td><td><a href="factura.php?idcita=4999&amp;idpagobono=" target="factura"></a> </td></tr>
<tr class="pasado"><td>2</td><td>L</td><td>05-10-2026</td><td>15:45</td><td>Ajuste</td><td>Dra. Demo</td><td>40.00</td><td>&nbsp;</td><td><a href="factura.php?idcita=5001&amp;idpagobono=" target="factura">12</a> </td></tr>
<tr><td colspan="3"></td><td>Total: 2</td><td>40</td></tr>
</table>
<table><tr><th>&nbsp;</th><th>Bono/Artículo</th><th>Citas</th><th>Caduca</th><th>Debe</th><th>Pago</th><th>Facturas</th></tr>
<tr class="presente"><td><input type="radio" name="selbono" value="900" checked></td><td>Bono 12</td><td style="text-align:right;">10</td><td>01-09-2027</td><td>0.00</td><td>450.00</td><td><a href="factura.php?idcita=&idpagobono=700" target="factura">13</a>&nbsp;</td></tr>
<tr><td colspan="3"></td><td>Total: 1</td><td>0</td><td>450</td></tr>
</table>
<table><tr><th>Beneficiarios</th></tr>
<tr><td>1:</td><td><input type="text" name="nombrebene1" value="${name}"><input type="hidden" name="idllistabene1" value="${id}"></td></tr>
${extra}
</table>
<div id="noubono"><select name="tipobono"><option value="19" data-bonoarti="B">Bono 12</option><option value="20" data-bonoarti="D">Deuda</option></select></div>
<input type="submit" name="historial" value="Historial">
</form>
<script>var tb = { '19': { 'citas': '12', 'precio': '450.00', 'numpaci': '4', 'caduca': '365', 'numpagos': '1', 'periodicidad': '0'}, '20': { 'citas': '0', 'precio': '0', 'numpaci': '1', 'caduca': '365', 'numpagos': '1', 'periodicidad': '0'} };</script>`

const HISTORIAL = `<form method="post"><div id="tabs"><ul><li><a href="#historial">Ajustes</a></li><li><a href="#pruebas">Pruebas</a></li></ul>
<div id="historial"><textarea name="notas">ESTRUCTURAL
revisar cada 5 setmanes</textarea>
<table id="notastec"><tr class="alto"><td>2</td><td>05-10-2026</td><td>Ajuste</td><td><textarea name="notas_1">Molt be
c7d</textarea><input type="hidden" name="idcita_1" value="5001"></td></tr></table>
<table id="vertebrastec"><tr><td>Cráneo</td><td><input type="checkbox" name="tiz[0]"></td><td><input type="checkbox" name="tde[0]"></td></tr>
<tr><td>C1</td><td><input type="checkbox" name="tiz[1]"></td><td><input type="checkbox" name="tde[1]"></td></tr></table>
</div>
<div id="pruebas"><div id="cinta"><div class="thumb"><input type="hidden" name="idprueba_1" value="8"><input type="hidden" name="descprueba_1" value="RX lumbar"><input type="hidden" name="categoria_1" value=""><div class="thudesc">RX lumbar | Imagen%201.png</div><div class="thumbnail"><img src="101/pruebas/Imagen%201.png"></div></div></div></div>
<div id="biomecanico"><table><tr><td>C1</td><td><input type="checkbox" name="iz[3]" checked></td><td><input type="checkbox" name="de[3]"></td></tr></table><textarea name="valoracion"></textarea></div>
<div id="anamnesis"><input type="text" name="motivo" value="Dolor lumbar" class="anamnesis"><input type="text" name="inicio" value="" class="anamnesis"></div>
</div></form>`

const INVOICE = `<form action="guardarfac.php" method="post"><input type="hidden" name="idpagobono1" value="700">
<table><tr><td>Nombre:<br>Laura Demo Prueba</td></tr></table>
<input type="text" name="fechafac1" value="22-05-2026"><input type="text" name="numfac1" value="13">/2026
<input type="text" name="nif1" value="12345678Z"><textarea name="calle1">Carrer Demo 1</textarea><input type="text" name="codigo1" value="08001"><input type="text" name="poblacion1" value="Barcelona">
<textarea name="concepto1">Sesión de quiropráctica</textarea>
<select name="tipoiva1"><option value="0" selected>0</option></select><select name="tipoirpf1"><option value="0.00" selected>0</option></select>
<input type="text" name="importe1" value="450.00"></form>`

const CAJA = `<form action="diario.php" method="post"><input type="hidden" name="tipo" value="caja">
<select name="quiro" onchange="forms[0].submit()"><option selected value="-1">-- Todos --</option><option value="1">Dra. Demo</option></select>
<b>Mes de Octubre de 2026</b>
<table><tr><th></th><th>Fecha</th><th>Nombre</th><th>Observ.</th><th>N</th><th>B</th><th>Efectivo</th><th>Tarjeta</th><th>Transferencia</th><th>Deuda</th><th>Fac.</th><th>Valor</th></tr>
<tr><td>1</td><td>05-10-2026</td><td>Laura Demo Prueba</td><td></td><td></td><td></td><td>40,00</td><td></td><td></td><td></td><td><input type="hidden" name="id1" value=""><input type="hidden" name="pagobono1" value="0"><input type="hidden" name="cita1" value="5001"></td><td>40,00</td></tr>
<tr><td>2</td><td>01-10-2026</td><td>Laura Demo Prueba</td><td>Bono 12</td><td></td><td></td><td></td><td>1.000,00</td><td></td><td></td><td><input type="hidden" name="id2" value=""><input type="hidden" name="pagobono2" value="700"><input type="hidden" name="cita2" value="0"><input name="factura2" type="checkbox" value="1" checked></td><td></td></tr>
</table>
<input id="caja-6" type="text" value="40,00" readonly><input id="totalmeto-6[2]" type="text" value="1000,00" readonly><input id="totalmeto-6[3]" type="text" value="0,00" readonly><input id="valortotal-6" type="text" value="40,00" readonly>
<input type="text" name="gastos-6" value="0,00">
<input type="submit" name="previo" value="◄"><input type="submit" name="aceptar" value="Aceptar"><input type="submit" name="Facturas" value="Facturar">
</form>`

describe('quirocitas pages', () => {
  it('reads the patient list, unescaping names', () => {
    expect(parseQuirocitasPatientList(LIST)).toEqual([
      { id: '101', name: 'Laura Demo Prueba', phones: ['600111222'] },
      { id: '102', name: "Marc d'Exemple", phones: [] },
    ])
  })

  it('reads a record: details, consent, appointments, visits, bonos, invoices', () => {
    const f = parseQuirocitasFicha(FICHA('101', 'Laura Demo Prueba'))!
    expect(f).toMatchObject({ id: '101', name: 'Laura Demo Prueba', nif: '12345678z', birthDate: '23-01-1980', gender: 'femenino', language: 'Català', consentRgpd: true, noMailings: false, messages: 'phone', chiro: 'Dra. Demo', referralSource: 'Web', hasPhoto: true, notes: 'Lumbar\ndesde 2024' })
    expect(f.phones).toEqual(['600 11 12 22', '+44 7700 900123'])
    // The placeholder row is dropped; the ids are the ones the history and ledger use.
    expect(f.appointments.map((a) => [a.id, a.type, a.status])).toEqual([['5001', 'Ajuste', 'pasado'], ['5002', 'Charla', 'ausencia'], ['5003', 'Ajuste', 'futuro']])
    // "Total" rows are not visits.
    expect(f.visits).toHaveLength(4)
    expect(f.visits[3]).toMatchObject({ date: '05-10-2026', paid: 40, reason: '12' })
    expect(f.bonos).toEqual([{ id: '900', name: 'Bono 12', remaining: 10, expires: '01-09-2027', owed: 0, paid: 450, status: 'presente' }])
    expect(f.plans).toEqual([{ times: '2', per: 'cada semana', during: '3' }])
    expect(f.family).toEqual(['101'])
  })

  it('follows only invoice links that carry a number -- the empty ones would create one', () => {
    const f = parseQuirocitasFicha(FICHA('101', 'Laura Demo Prueba'))!
    expect(f.invoiceLinks).toEqual([
      { href: 'factura.php?idcita=5001&idpagobono=', number: '12', citaId: '5001', bonoPaymentId: null },
      { href: 'factura.php?idcita=&idpagobono=700', number: '13', citaId: null, bonoPaymentId: '700' },
    ])
  })

  it('reads the bono types from the record', () => {
    expect(parseQuirocitasBonoTypes(FICHA('101', 'x'))).toEqual([
      { id: '19', name: 'Bono 12', sessions: 12, price: 450, expiresInDays: 365, kind: 'bono' },
      { id: '20', name: 'Deuda', sessions: 0, price: 0, expiresInDays: 365, kind: 'debt' },
    ])
  })

  it('reads the clinical history: visit notes with their cita, segment names, tests, anamnesis', () => {
    const h = parseQuirocitasHistory(HISTORIAL)
    expect(h.generalNotes).toBe('ESTRUCTURAL\nrevisar cada 5 setmanes')
    expect(h.visits).toEqual([{ number: '2', date: '05-10-2026', type: 'Ajuste', notes: 'Molt be\nc7d', citaId: '5001' }])
    expect(h.segments).toEqual(['Cráneo', 'C1'])
    expect(h.tests).toEqual([{ id: '8', description: 'RX lumbar', category: '', file: 'Imagen 1.png', src: '101/pruebas/Imagen%201.png' }])
    expect(h.biomechanics.segments).toEqual([{ segment: 'C1', left: true, right: false }])
    expect(h.anamnesis).toEqual({ motivo: 'Dolor lumbar' })
  })

  it('reads an invoice', () => {
    expect(parseQuirocitasInvoice(INVOICE)).toMatchObject({ number: '13', year: '2026', date: '22-05-2026', name: 'Laura Demo Prueba', nif: '12345678Z', total: '450.00', bonoPaymentId: '700' })
  })

  it('reads a month of the cash ledger with its printed totals', () => {
    const m = parseQuirocitasCajaMonth(CAJA)
    expect(m.month).toBe('2026-10')
    expect(m.everyChiro).toBe(true)
    expect(m.totals).toEqual({ cash: 40, card: 1000, transfer: 0, value: 40 })
    expect(m.rows.map((r) => [r.citaId, r.bonoPaymentId, r.cash, r.card, r.value])).toEqual([['5001', null, 40, null, 40], [null, '700', null, 1000, null]])
  })

  it('submits the cash page as a click on ◄ would: the form as rendered, no buttons', () => {
    const body = quirocitasCajaFormBody(CAJA)
    expect(body).toContainEqual(['quiro', '-1'])
    expect(body).toContainEqual(['factura2', '1'])
    expect(body.map(([k]) => k)).not.toContain('aceptar')
    expect(body.map(([k]) => k)).not.toContain('Facturas')
  })

  // A Quirocitas with one chiropractor has nowhere to say which: no column in
  // either list, no select on the record, no filter on the cash page.
  describe('a clinic with a single chiropractor', () => {
    const SOLO = FICHA('101', 'Laura Demo Prueba')
      .replace(/<th>Quiro(pr\.)?<\/th>/g, '')
      .replace(/<td>(Dra\. Demo|-----)<\/td>/g, '')
      .replace(/<select name="suquiro">.*?<\/select>/, '')
    const SOLO_CAJA = CAJA.replace(/<select name="quiro".*?<\/select>/, '')

    it('still reads the visit list, which has one column fewer', () => {
      // Read by position, no row of this table was a visit: every record came
      // back with none, so nothing cancelled or moved was ever imported.
      const f = parseQuirocitasFicha(SOLO)!
      expect(f.chiro).toBe('')
      expect(f.appointments.map((a) => [a.id, a.type, a.chiro])).toEqual([['5001', 'Ajuste', ''], ['5002', 'Charla', ''], ['5003', 'Ajuste', '']])
      expect(f.visits.map((v) => [v.date, v.time, v.type, v.chiro, v.paid, v.status])).toEqual([
        ['09-11-2026', '10:00', 'Ajuste', '', 0, 'futuro'],
        ['12-10-2026', '09:15', 'Charla', '', 0, 'ausencia'],
        ['06-10-2026', '16:00', 'Cambio', '', 0, 'cambio'],
        ['05-10-2026', '15:45', 'Ajuste', '', 40, 'pasado'],
      ])
      expect(f.visits[1]!.reason).toBe('quan vol venir?')
    })

    it('takes a cash page with no chiropractor filter as everyone\'s', () => {
      // Demanding "-- Todos --" of a page with no such choice stopped this
      // clinic's read at its ledger on every sync.
      const m = parseQuirocitasCajaMonth(SOLO_CAJA)
      expect(m).toMatchObject({ month: '2026-10', hasChiroFilter: false, everyChiro: true })
      expect(m.rows).toHaveLength(2)
    })

    it('still refuses a cash page filtered to one chiropractor of several', () => {
      const one = CAJA.replace('<option selected value="-1">', '<option value="-1">').replace('<option value="1">', '<option selected value="1">')
      expect(parseQuirocitasCajaMonth(one)).toMatchObject({ hasChiroFilter: true, everyChiro: false, chiroShown: 'Dra. Demo' })
    })
  })
})

describe('quirocitas rows', () => {
  const zone = 'Europe/Madrid'
  const record = (id: string, name: string) => ({
    list: { id, name, phones: [] },
    ficha: parseQuirocitasFicha(FICHA(id, name))!,
    history: parseQuirocitasHistory(HISTORIAL),
    invoices: [{ ...parseQuirocitasInvoice(INVOICE), citaId: null, bonoPaymentId: '700' }, { ...parseQuirocitasInvoice(INVOICE.replace('value="13"', 'value="12"').replace('name="idpagobono1" value="700"', 'name="idcita1" value="5001"')), citaId: '5001', bonoPaymentId: null, total: '40.00' }],
    techniques: { 5001: { left: [{ segment: 'C1', technique: 'Manual' }], right: [] } },
  })
  const snapshot = (): QuirocitasSnapshot => ({
    baseUrl: '', readAt: '', bonoTypes: parseQuirocitasBonoTypes(FICHA('101', 'x')),
    patients: { 101: record('101', 'Laura Demo Prueba') }, failed: {},
    ledger: parseQuirocitasCajaMonth(CAJA).rows, ledgerMonths: [],
  })

  it('converts dates and names', () => {
    expect(quirocitasDate('23-01-1980')).toBe('1980-01-23')
    expect(quirocitasDate('31-02-1980')).toBeNull()
    expect(quirocitasDate('00-00-0000')).toBeNull()
    expect(splitQuirocitasName('Laura Demo Prueba')).toEqual({ first_name: 'Laura', last_name: 'Demo Prueba' })
    expect(quirocitasPhone('600 11 12 22')).toEqual({ country_code: 'ES', number: '600111222' })
    expect(quirocitasPhone('+44 7700 900123')).toEqual({ country_code: 'GB', number: '7700900123' })
    expect(quirocitasPhone('0034 600111222')).toEqual({ country_code: 'ES', number: '600111222' })
  })

  it('maps a patient: Catalan becomes Spanish with a tag, consent needs RGPD and no "no mailings"', () => {
    const p = quirocitasPatientRow(record('101', 'Laura Demo Prueba'))
    expect(p.ref).toBe('QC-101')
    expect(p.fields).toMatchObject({ first_name: 'Laura', last_name: 'Demo Prueba', national_id: '12345678Z', date_of_birth: '1980-01-23', gender: 'female', preferred_language: 'es', tags: ['Català'], marketing_channels: ['email'], referral_source: 'Web' })
    expect(p.fields).toMatchObject({ reminder_channel: 'sms', confirmation_channel: 'sms' })
    expect(p.firstSeen).toBe('2026-10-05T00:00:00Z')
  })

  it('"No enviar mensajes" turns automatic messages off, not contact', () => {
    const r = record('101', 'Laura Demo Prueba')
    r.ficha.messages = 'none'
    expect(quirocitasPatientRow(r).fields).toMatchObject({ reminder_channel: 'none', confirmation_channel: 'none' })
  })

  it('splits calls from appointments, and keeps cancelled ones from the visit list', () => {
    const { appointments, calls } = quirocitasAppointmentRows(record('101', 'Laura Demo Prueba'), zone)
    expect(calls).toEqual([{ ref: 'QC-call-5002', patientRef: 'QC-101', at: '2026-10-12T07:15:00.000Z', answered: false, note: 'Llamada · quan vol venir?' }])
    expect(appointments.map((a) => [a.ref, a.status, a.rescheduled])).toEqual([['QC-5001', 'completed', false], ['QC-5003', 'booked', false], ['QC-101-202610061600-1', 'cancelled', true]])
    // Wall-clock Madrid time: 15:45 in October is 13:45 UTC.
    expect(appointments[0]!.startsAt).toBe('2026-10-05T13:45:00.000Z')
  })

  it('writes the segments adjusted into the visit note', () => {
    const [n] = quirocitasVisitNotes(record('101', 'Laura Demo Prueba'), zone)
    expect(n).toMatchObject({ appointmentRef: 'QC-5001', body: 'Molt be\nc7d\n\nSegmentos ajustados — izquierda: C1 (Manual)' })
  })

  it('brings a family bono once, owned by whoever paid, shared with the rest', () => {
    const s = snapshot()
    s.patients[102] = record('102', 'Marc Exemple')
    s.patients[102]!.ficha.appointments = []
    const { rows } = quirocitasBonoRows(s, zone)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ ref: 'QC-bono-900', ownerRef: 'QC-101', sharedWithRefs: ['QC-102'], sessionsTotal: 12, sessionsUsed: 2, isClosed: false, dateFromLedger: true })
  })

  it('models the ledger as QuiroFlow does: a charge per visit, payments, a bono sale with no charge', () => {
    const s = snapshot()
    // The sale is matched to its bono when the amount and timing fit.
    s.ledger[1]!.card = 450
    const bonos = quirocitasBonoRows(s, zone)
    expect(bonos.rows[0]!.dateFromLedger).toBe(true)
    const { charges, payments, invoiceNotes, unplaced } = quirocitasLedgerRows(s, bonos.bonoOfSale, zone)
    expect(unplaced).toEqual([])
    expect(charges).toEqual([expect.objectContaining({ ref: 'QC-inv-5001', appointmentRef: 'QC-5001', number: 'QC-12/2026', totalCents: 4000, status: 'paid' })])
    expect(payments).toEqual([
      expect.objectContaining({ ref: 'QC-pay-5001-cash', amountCents: 4000, chargeRef: 'QC-inv-5001', bonoRef: null }),
      expect.objectContaining({ ref: 'QC-pay-pb700-card', amountCents: 45000, chargeRef: null, bonoRef: 'QC-bono-900' }),
    ])
    // The invoice Quirocitas raised for the sale has no charge to sit on.
    expect(invoiceNotes).toHaveLength(1)
    expect(invoiceNotes[0]!.note).toContain('[Factura Quirocitas 13/2026]')
  })

  describe('who an appointment is with', () => {
    const team = [{ id: 'oriol', full_name: 'Oriol Demo Prueba' }, { id: 'isabel', full_name: 'Isabel' }]

    it('finds a chiropractor Quirocitas names more briefly than the team does', () => {
      // "Oriol Demo" there, "Oriol Demo Prueba" here: compared as written,
      // every appointment of his came in with no practitioner, and the
      // calendar -- which opens on one person's tab -- showed none of them.
      const of = quirocitasPractitionerMatcher(team)
      expect(of('Oriol Demo')).toBe('oriol')
      expect(of('  ORIOL  demo prueba ')).toBe('oriol')
      expect(of('Dra. Isabel')).toBe('isabel')
      expect(of('Isábel')).toBe('isabel')
    })

    it('guesses nobody when the name fits more than one person, or none', () => {
      const of = quirocitasPractitionerMatcher([...team, { id: 'oriol2', full_name: 'Oriol Demo Segundo' }])
      expect(of('Oriol Demo')).toBeNull()
      expect(of('Oriol Demo Prueba')).toBe('oriol')
      expect(of('Daniel')).toBeNull()
      // A shared surname is not the same person.
      expect(of('Demo')).toBeNull()
      expect(of('Dr. Demo Prueba')).toBeNull()
      expect(of('Cualquiera')).toBeNull()
      expect(of('')).toBeNull()
    })

    it('gives a clinic that names no chiropractor its only one', () => {
      const r = record('101', 'Laura Demo Prueba')
      expect(quirocitasNamesChiropractors({ patients: { 101: r } })).toBe(true)
      const solo = { ...r, ficha: { ...r.ficha, chiro: '', appointments: r.ficha.appointments.map((a) => ({ ...a, chiro: '' })), visits: r.ficha.visits.map((v) => ({ ...v, chiro: '' })) } }
      expect(quirocitasNamesChiropractors({ patients: { 101: solo } })).toBe(false)
      const of = quirocitasPractitionerMatcher([{ id: 'emma', full_name: 'Emma Demo' }], 'emma')
      expect(of('')).toBe('emma')
      // "Any of them" is still nobody in particular.
      expect(of('Cualquiera')).toBeNull()
    })
  })

  describe('a bono past its expiry date', () => {
    // Quirocitas greys an expired bono out ("pasado") and goes on taking
    // visits off it. The visit list marks those with a B.
    const withBono = (expires: string, remaining: number, bonoVisits: string[]) => {
      const s = snapshot()
      const f = s.patients[101]!.ficha
      f.bonos = [{ id: '900', name: 'Bono 12', remaining, expires, owed: 0, paid: 450, status: 'pasado' }]
      f.visits = bonoVisits.map((date) => ({ date, time: '10:00', type: 'Ajuste', chiro: 'Dra. Demo', paid: 0, bono: true, reason: '', status: 'pasado' }))
      return s
    }
    const closed = (s: QuirocitasSnapshot) => quirocitasBonoRows(s, zone, '2026-11-17').rows[0]!.isClosed

    it('stays open while the clinic is still taking visits off it', () => {
      // Two sessions left, used a month ago, months after it expired: closed
      // on import, it was not there to pay with at the desk.
      expect(closed(withBono('31-07-2026', 2, ['29-07-2026', '08-09-2026', '13-10-2026']))).toBe(false)
    })

    it('is closed when nobody has used it since it expired', () => {
      expect(closed(withBono('31-07-2026', 2, ['29-07-2026']))).toBe(true)
    })

    it('is closed when its last use is more than a year back', () => {
      expect(closed(withBono('31-07-2024', 2, ['08-09-2024']))).toBe(true)
    })

    it('is closed when it has nothing left, whenever it was used', () => {
      expect(closed(withBono('31-07-2026', 0, ['13-10-2026']))).toBe(true)
    })

    it('is closed when its holder has a later bono, which is the one in use', () => {
      const s = withBono('31-07-2026', 2, ['13-10-2026'])
      s.patients[101]!.ficha.bonos.push({ id: '901', name: 'Bono 12', remaining: 9, expires: '01-09-2027', owed: 0, paid: 450, status: 'presente' })
      const rows = quirocitasBonoRows(s, zone, '2026-11-17').rows
      expect(rows.map((b) => [b.ref, b.isClosed])).toEqual([['QC-bono-900', true], ['QC-bono-901', false]])
    })
  })

  describe('a bono whose number of sessions Quirocitas does not know', () => {
    // A type set up with no count ("Genérico", a gift bono) and a name with no
    // number in it: used up, it read as 0 sessions, which package_purchases
    // refuses -- and the refusal took every bono in the same batch with it.
    const bono = (name: string, remaining: number) => {
      const s = snapshot()
      s.patients[101]!.ficha.bonos = [{ id: '900', name, remaining, expires: '31-07-2026', owed: 0, paid: 0, status: 'pasado' }]
      return quirocitasBonoRows(s, zone, '2026-11-17').rows[0]!
    }

    it('comes in used up as 1 of 1, never 0, and says so', () => {
      expect(bono('Genérico', 0)).toMatchObject({ sessionsTotal: 1, sessionsUsed: 1, isClosed: true, sizeUnknown: true })
    })

    it('keeps what is left when there is some', () => {
      expect(bono('Genérico', 3)).toMatchObject({ sessionsTotal: 3, sessionsUsed: 0, sizeUnknown: false })
    })

    it('still takes the count from a name that ends in one', () => {
      expect(bono('Bono 12', 0)).toMatchObject({ sessionsTotal: 12, sessionsUsed: 12, sizeUnknown: false })
    })
  })

  describe('which patients a read fetches', () => {
    const ids = ['101', '102', '103']
    const copy = (over: Partial<QuirocitasSnapshot>): QuirocitasSnapshot => ({ ...snapshot(), version: QUIROCITAS_COPY_VERSION, ...over })

    it('reads everyone when there is no copy', () => {
      expect(quirocitasReadQueue(null, ids, '2026-11-16T10:00:00Z')).toEqual({ passStartedAt: '2026-11-16T10:00:00Z', queue: ids })
    })

    it('reads everyone again once the copy is finished, so changes since are seen', () => {
      // The clinic re-synced a finished copy and got only its new patients:
      // appointments booked since for everyone else never reached the import.
      const done = copy({ ledgerMonths: [{ month: '2026-11', rows: 1, printed: { cash: null, card: null, transfer: null }, summed: { cash: 0, card: 0, transfer: 0 } }], passStartedAt: '2026-11-05T09:00:00Z' })
      done.patients[101]!.readAt = '2026-11-05T09:01:00Z'
      expect(quirocitasReadQueue(done, ids, '2026-11-16T10:00:00Z')).toEqual({ passStartedAt: '2026-11-16T10:00:00Z', queue: ids })
    })

    it('carries on a stopped pass with only what that pass has not fetched', () => {
      const stopped = copy({ passStartedAt: '2026-11-16T10:00:00Z' })
      stopped.patients[101]!.readAt = '2026-11-16T10:02:00Z'
      stopped.patients[102] = { ...stopped.patients[101]!, readAt: '2026-11-05T09:01:00Z' }
      expect(quirocitasReadQueue(stopped, ids, '2026-11-16T11:00:00Z')).toEqual({ passStartedAt: '2026-11-16T10:00:00Z', queue: ['102', '103'] })
    })

    it('carries on a stopped copy from before passes were recorded with the patients it lacks', () => {
      expect(quirocitasReadQueue(copy({}), ids, '2026-11-16T11:00:00Z')).toEqual({ passStartedAt: '', queue: ['102', '103'] })
    })

    it('reads everyone again after a pass whose cash ledger could not be read', () => {
      // Such a copy has no months, like a stopped one, but its patients were
      // all read. Carried on from, it would fetch nobody on every later sync.
      const noLedger = copy({ passStartedAt: '2026-11-16T10:00:00Z', ledgerError: 'Quirocitas did not show a month of the cash ledger.' })
      noLedger.patients[101]!.readAt = '2026-11-16T10:02:00Z'
      expect(quirocitasReadQueue(noLedger, ids, '2026-11-17T09:00:00Z')).toEqual({ passStartedAt: '2026-11-17T09:00:00Z', queue: ids })
    })

    it('reads everyone again when the copy was left unfinished by an older reader', () => {
      // Its records were parsed the old way: only fetching them again brings
      // the visits that reader could not see.
      const old = copy({ passStartedAt: '2026-11-16T10:00:00Z', version: undefined })
      old.patients[101]!.readAt = '2026-11-16T10:02:00Z'
      expect(quirocitasReadQueue(old, ids, '2026-11-17T09:00:00Z')).toEqual({ passStartedAt: '2026-11-17T09:00:00Z', queue: ids })
    })
  })

  describe('whether a copy is finished', () => {
    const copy = (over: Partial<QuirocitasSnapshot>): QuirocitasSnapshot => ({ ...snapshot(), ...over })
    const month = { month: '2026-11', rows: 1, printed: { cash: null, card: null, transfer: null }, summed: { cash: 0, card: 0, transfer: 0 } }

    it('calls a copy with its ledger read finished', () => {
      expect(quirocitasReadState(copy({ ledgerMonths: [month], listTotal: 1 }))).toEqual({ finished: true, read: 1, total: 1 })
    })

    it('calls a copy stopped before the ledger unfinished, with how many of the list it holds', () => {
      // The clinic whose read stopped at 1,200 patients imported from a copy
      // like this, and the visits of everyone not read never arrived.
      const stopped = copy({ passStartedAt: '2026-11-16T10:00:00Z', listTotal: 3 })
      stopped.patients[101]!.readAt = '2026-11-16T10:02:00Z'
      expect(quirocitasReadState(stopped)).toEqual({ finished: false, read: 1, total: 3 })
    })

    it('counts only this pass when a "read again" stopped part way', () => {
      const again = copy({ passStartedAt: '2026-11-16T10:00:00Z', listTotal: 2 })
      again.patients[101]!.readAt = '2026-11-05T09:01:00Z'
      again.patients[102] = { ...again.patients[101]!, readAt: '2026-11-16T10:03:00Z' }
      expect(quirocitasReadState(again)).toEqual({ finished: false, read: 1, total: 2 })
    })

    it('still calls an older copy unfinished, without a total it never recorded', () => {
      expect(quirocitasReadState(copy({}))).toEqual({ finished: false, read: 1, total: null })
    })
  })
})

// A cash page laid out differently from the one the reader was written
// against: one chiropractor, a DNI and a time column, no transfer or
// invoicing column -- and so no visit or bono ids on its rows. Read by the
// first clinic's positions, a real one like it came back with its cash as
// "transfer" and its card payments as "debt", and not one payment imported.
const SHIFTED_CAJA = `<form action="diario.php" method="post"><input type="hidden" name="tipo" value="caja">
<b>Mes de Octubre de 2026</b>
<table><tr><th></th><th>Fecha</th><th>Nombre</th><th>DNI</th><th>Observ.</th><th>N</th><th>B</th><th>Hora</th><th>Efectivo</th><th>Tarjeta</th><th>Deuda</th><th>Valor</th></tr>
<tr><td>1</td><td>01-10-2026</td><td>Laura Demo Prueba</td><td>12345678Z</td><td>Bono 12</td><td>N</td><td></td><td>10:00</td><td></td><td>450,00</td><td></td><td></td></tr>
<tr><td>2</td><td>05-10-2026</td><td>Laura Demo Prueba</td><td>12345678Z</td><td></td><td></td><td>B</td><td>15:45</td><td></td><td></td><td></td><td>37,50</td></tr>
<tr><td>3</td><td>13-10-2026</td><td>Laura Demo Prueba</td><td>12345678Z</td><td></td><td></td><td></td><td>11:00</td><td>20,00</td><td></td><td></td><td></td></tr>
<tr><td>4</td><td>13-10-2026</td><td>Laura Demo Prueba</td><td>12345678Z</td><td></td><td></td><td></td><td>11:30</td><td>20,00</td><td></td><td></td><td></td></tr>
</table>
<input id="caja-6" type="text" value="40,00" readonly><input id="totalmeto-6[2]" type="text" value="450,00" readonly><input id="valortotal-6" type="text" value="37,50" readonly>
<input type="submit" name="previo" value="◄">
</form>`

describe('a cash page laid out differently', () => {
  const zone = 'Europe/Madrid'
  const monthOf = (m: ReturnType<typeof parseQuirocitasCajaMonth>) => {
    const sum = (k: 'cash' | 'card' | 'transfer') => Math.round(m.rows.reduce((a, r) => a + (r[k] ?? 0), 0) * 100) / 100
    return { month: m.month!, rows: m.rows.length, printed: m.totals, summed: { cash: sum('cash'), card: sum('card'), transfer: sum('transfer') } }
  }

  it('reads the columns by their header, not by where another clinic had them', () => {
    const m = parseQuirocitasCajaMonth(SHIFTED_CAJA)
    expect(m.layout.columns).toMatchObject({ date: 1, name: 2, note: 4, isNew: 5, usedBono: 6, cash: 8, card: 9, debt: 10, value: 11 })
    expect(m.layout.columns.transfer).toBeUndefined()
    expect(m.layout.fromTotals).toEqual([])
    expect(m.rows.map((r) => [r.date, r.note, r.cash, r.card, r.transfer, r.debt, r.value, r.usedBono, r.citaId])).toEqual([
      ['01-10-2026', 'Bono 12', null, 450, null, null, null, false, null],
      ['05-10-2026', '', null, null, null, null, 37.5, true, null],
      ['13-10-2026', '', 20, null, null, null, null, false, null],
      ['13-10-2026', '', 20, null, null, null, null, false, null],
    ])
    expect(quirocitasLedgerMismatches({ ledgerMonths: [monthOf(m)] })).toEqual([])
  })

  it('keeps reading the original layout exactly as before', () => {
    const m = parseQuirocitasCajaMonth(CAJA)
    expect(m.layout.columns).toMatchObject({ date: 1, name: 2, note: 3, isNew: 4, usedBono: 5, cash: 6, card: 7, transfer: 8, debt: 9, value: 11 })
    expect(m.layout.inputs).toEqual(['cita', 'factura', 'id', 'pagobono'])
  })

  it('finds a money column it cannot name by the total printed under it', () => {
    const m = parseQuirocitasCajaMonth(SHIFTED_CAJA.replace('<th>Tarjeta</th>', '<th>Datáfono</th>').replace('<th>Valor</th>', '<th>Importe</th>'))
    expect(m.layout.columns).toMatchObject({ card: 9, value: 11 })
    expect(m.layout.fromTotals).toEqual(['card', 'value'])
    expect(m.rows[0]).toMatchObject({ card: 450 })
  })

  it('lines a header cell spanning two columns up with both', () => {
    const m = parseQuirocitasCajaMonth(SHIFTED_CAJA.replace('<th>N</th><th>B</th>', '<th colspan="2">N B</th>'))
    expect(m.layout.columns).toMatchObject({ cash: 8, card: 9, value: 11 })
  })

  it('leaves a month that still does not add up flagged, so the import refuses it', () => {
    const m = parseQuirocitasCajaMonth(SHIFTED_CAJA.replace('value="450,00"', 'value="999,00"'))
    expect(quirocitasLedgerMismatches({ ledgerMonths: [monthOf(m)] }).map((x) => x.month)).toEqual(['2026-10'])
  })

  describe('rows with no visit or bono id', () => {
    const snapshot = (): QuirocitasSnapshot => ({
      baseUrl: '', readAt: '', bonoTypes: parseQuirocitasBonoTypes(FICHA('101', 'x')),
      patients: {
        101: {
          list: { id: '101', name: 'Laura Demo Prueba', phones: [] },
          ficha: parseQuirocitasFicha(FICHA('101', 'Laura Demo Prueba'))!,
          history: parseQuirocitasHistory(HISTORIAL),
          invoices: [],
          techniques: {},
        },
      },
      failed: {},
      ledger: parseQuirocitasCajaMonth(SHIFTED_CAJA).rows,
      ledgerMonths: [],
    })

    it('charges a visit against the appointment the record has that day', () => {
      const s = snapshot()
      const { charges, visitless } = quirocitasLedgerRows(s, quirocitasBonoRows(s, zone).bonoOfSale, zone)
      expect(visitless).toEqual([])
      expect(charges).toEqual([expect.objectContaining({ ref: 'QC-inv-5001', appointmentRef: 'QC-5001', totalCents: 3750, status: 'paid' })])
    })

    it('gives every payment its own reference, the same one on every read', () => {
      const s = snapshot()
      const first = quirocitasLedgerRows(s, quirocitasBonoRows(s, zone).bonoOfSale, zone).payments
      const again = quirocitasLedgerRows(snapshot(), quirocitasBonoRows(snapshot(), zone).bonoOfSale, zone).payments
      expect(new Set(first.map((p) => p.ref)).size).toBe(first.length)
      expect(again.map((p) => p.ref)).toEqual(first.map((p) => p.ref))
      expect(first.map((p) => [p.method, p.amountCents, p.chargeRef, p.bonoRef])).toEqual([
        ['card', 45000, null, 'QC-bono-900'],
        ['cash', 2000, null, null],
        ['cash', 2000, null, null],
      ])
      expect(first.every((p) => !p.ref.includes('null'))).toBe(true)
    })

    it('names a visit it cannot place rather than charging nothing quietly', () => {
      const s = snapshot()
      s.patients[101]!.ficha.appointments = []
      const { charges, visitless } = quirocitasLedgerRows(s, quirocitasBonoRows(s, zone).bonoOfSale, zone)
      expect(charges).toEqual([])
      expect(visitless).toHaveLength(1)
    })
  })
})

describe('the original cash page with a label spelled differently', () => {
  it('keeps that column where it always was', () => {
    const m = parseQuirocitasCajaMonth(CAJA.replace('<th>Observ.</th>', '<th>Notas</th>'))
    expect(m.layout.columns.note).toBe(3)
    expect(m.rows[1]!.note).toBe('Bono 12')
  })
})

// The second clinic's real cash header, as its read recorded it: no card
// column, and its transfers totalled in the footer's slot 2 -- the slot the
// first clinic uses for card.
const NO_CARD_CAJA = `<form action="diario.php" method="post"><input type="hidden" name="tipo" value="caja">
<b>Mes de Noviembre de 2026</b>
<table><tr><th></th><th>Fecha</th><th>Nombre</th><th>NIF</th><th>Observ.</th><th>N</th><th>I</th><th>B</th><th>Efectivo</th><th>Transferencia</th><th>Deuda</th><th>Valor</th></tr>
<tr><td>1</td><td>03-11-2026</td><td>Laura Demo Prueba</td><td>12345678Z</td><td></td><td></td><td></td><td></td><td>40,00</td><td></td><td></td><td>40,00</td></tr>
<tr><td>2</td><td>06-11-2026</td><td>Laura Demo Prueba</td><td>12345678Z</td><td>Bono 12</td><td></td><td></td><td></td><td></td><td>450,00</td><td></td><td></td></tr>
</table>
<input id="caja-6" type="text" value="40,00" readonly><input id="totalmeto-6[2]" type="text" value="450,00" readonly><input id="valortotal-6" type="text" value="40,00" readonly>
</form>`

describe('a clinic whose second payment method is transfer, not card', () => {
  const month = (m: ReturnType<typeof parseQuirocitasCajaMonth>) => {
    const sum = (k: 'cash' | 'card' | 'transfer') => Math.round(m.rows.reduce((a, r) => a + (r[k] ?? 0), 0) * 100) / 100
    return { month: m.month!, rows: m.rows.length, printed: m.totals, summed: { cash: sum('cash'), card: sum('card'), transfer: sum('transfer') } }
  }

  it('reads footer slot 2 as the method whose column follows Efectivo', () => {
    const m = parseQuirocitasCajaMonth(NO_CARD_CAJA)
    expect(m.layout.columns).toMatchObject({ cash: 8, transfer: 9, debt: 10, value: 11, usedBono: 7 })
    expect(m.layout.columns.card).toBeUndefined()
    expect(m.totals).toEqual({ cash: 40, card: null, transfer: 450, value: 40 })
    expect(m.rows[1]).toMatchObject({ transfer: 450, card: null, note: 'Bono 12' })
    expect(quirocitasLedgerMismatches({ ledgerMonths: [month(m)] })).toEqual([])
  })

  it('still reads the first clinic\'s slots as card then transfer', () => {
    expect(parseQuirocitasCajaMonth(CAJA).totals).toEqual({ cash: 40, card: 1000, transfer: 0, value: 40 })
  })

  it('accepts a copy saved before, with its transfer total filed under card', () => {
    // Exactly how that clinic's first corrected read stored November.
    const saved = { month: '2026-11', rows: 148, printed: { cash: 3062, card: 1450, transfer: null }, summed: { cash: 3062, card: 0, transfer: 1450 } }
    expect(quirocitasLedgerMismatches({ ledgerMonths: [saved] })).toEqual([])
  })

  it('still flags money the page printed that no column holds, or the other way round', () => {
    const missing = { month: '2026-11', rows: 1, printed: { cash: 40, card: 450, transfer: null }, summed: { cash: 40, card: 0, transfer: 0 } }
    const extra = { month: '2026-10', rows: 1, printed: { cash: 40, card: 0, transfer: null }, summed: { cash: 40, card: 0, transfer: 450 } }
    const cashOff = { month: '2026-09', rows: 1, printed: { cash: 40, card: null, transfer: null }, summed: { cash: 0, card: 0, transfer: 0 } }
    expect(quirocitasLedgerMismatches({ ledgerMonths: [missing, extra, cashOff] }).map((m) => m.month)).toEqual(['2026-11', '2026-10', '2026-09'])
  })
})

// A third shape of cash page, from a clinic with several chiropractors: a
// row of "franja" buttons, a Bizum column, a "<" for its previous button --
// and that button goes back a DAY even from the month view, landing on the
// day view. Invented data.
const ym = (d: Date) => d.toISOString().slice(0, 7)
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const LT_BUTTONS = `<input type="submit" name="previo" value="<" class="ajustado" title="Anterior">&nbsp;<input type="submit" name="siguiente" value=">" class="ajustado" title="Siguiente">
<input type="submit" name="aceptar" value="Aceptar"><input type="submit" name="cancelar" value="Cancelar">`
const LT_CHIROS = (all: boolean) => `<select name="quiro" id="quiro" onchange="forms[0].submit();"><option ${all ? 'selected ' : ''}value="-1">-- Todos --</option><option ${all ? '' : 'selected '}value="1">Dra. Demo</option><option value="2">Dr. Ejemplo</option></select>`
// One day: headed by its date, and "Mes entero" one of a row of buttons.
const LT_DAY = (all: boolean, day: Date) => `<form autocomplete="off" name="diario" action="diario.php" method="post"><input type="hidden" name="tipo" value="caja">
${LT_CHIROS(all)}
<input type="submit" name="franja" value="09:15-12:30" disabled><input type="submit" name="franja" value="Caja Mes"><input type="submit" name="franja" value="Mes entero"><input type="submit" name="franja" value="Todo">
<table><tr><th colspan="2" align="center">
    ${DIAS[day.getUTCDay()]}, ${day.getUTCDate()} de ${MESES[day.getUTCMonth()]} de ${day.getUTCFullYear()}    </th></tr></table>
<table><tr><th></th><th>Nombre</th><th>Observ.</th><th>N</th><th>I</th><th>B</th><th>Efectivo</th><th>Tarjeta</th><th>Bizum</th><th>Deuda</th><th>Fac.</th><th>Valor</th></tr></table>
${LT_BUTTONS}</form>`
const LT_MONTH = (month: string) => {
  const [y, m] = month.split('-')
  const day = (d: string) => `${d}-${m}-${y}`
  return `<form autocomplete="off" name="diario" action="diario.php" method="post"><input type="hidden" name="tipo" value="caja">
${LT_CHIROS(true)}
<input type="submit" name="franja" value="Caja Mes"><input type="submit" name="franja" value="Mes entero" disabled>
<table><tr><th colspan="2" align="center">
     Mes de ${MESES[Number(m) - 1]} de ${y}    </th></tr></table>
<table><tr><th></th><th>Fecha</th><th>Nombre</th><th>Observ.</th><th>N</th><th>I</th><th>B</th><th>Efectivo</th><th>Tarjeta</th><th>Bizum</th><th>Deuda</th><th>Fac.</th><th>Valor</th></tr>
<tr><td>1</td><td>${day('03')}</td><td>Laura Demo Prueba</td><td></td><td></td><td></td><td></td><td>40,00</td><td></td><td></td><td></td><td><input type="hidden" name="id1" value=""><input type="hidden" name="pagobono1" value="0"><input type="hidden" name="cita1" value="5001"></td><td>40,00</td></tr>
<tr><td>2</td><td>${day('04')}</td><td>Laura Demo Prueba</td><td></td><td></td><td></td><td></td><td></td><td></td><td>35,00</td><td></td><td><input type="hidden" name="id2" value=""><input type="hidden" name="pagobono2" value="0"><input type="hidden" name="cita2" value="5003"></td><td>35,00</td></tr>
<tr><td>3</td><td>${day('05')}</td><td>Laura Demo Prueba</td><td>Bono 12</td><td></td><td></td><td></td><td></td><td>450,00</td><td></td><td></td><td><input type="hidden" name="id3" value=""><input type="hidden" name="pagobono3" value="700"><input type="hidden" name="cita3" value="0"></td><td></td></tr>
</table>
<input id="caja-6" type="text" value="40,00" readonly><input id="totalmeto-6[1]" type="text" value="0,00" readonly><input id="totalmeto-6[2]" type="text" value="450,00" readonly><input id="totalmeto-6[3]" type="text" value="35,00" readonly><input id="valortotal-6" type="text" value="75,00" readonly>
${LT_BUTTONS}</form>`
}

describe('a cash page whose ◄ goes back a day', () => {
  it('reads the value a click on each button sends from the page', () => {
    expect(quirocitasCajaButton(LT_MONTH('2026-11'), 'previo')).toEqual(['previo', '<'])
    expect(quirocitasCajaButton(CAJA, 'previo')).toEqual(['previo', '◄'])
    // Among a row of "franja" buttons, the one asked for -- and a disabled
    // one is not there to click.
    expect(quirocitasCajaButton(LT_DAY(true, new Date('2026-11-24')), 'franja', /^mes entero$/i)).toEqual(['franja', 'Mes entero'])
    expect(quirocitasCajaButton(LT_MONTH('2026-11'), 'franja', /^mes entero$/i)).toBeNull()
    expect(quirocitasCajaButton(LT_MONTH('2026-11'), 'Facturas')).toBeNull()
  })

  it('tells a day view from a month view', () => {
    expect(parseQuirocitasCajaMonth(LT_DAY(true, new Date('2026-11-23')))).toMatchObject({ month: null, day: '2026-11-23' })
    expect(parseQuirocitasCajaMonth(LT_DAY(true, new Date('2026-10-01')))).toMatchObject({ month: null, day: '2026-10-01' })
    expect(parseQuirocitasCajaMonth(LT_MONTH('2026-11'))).toMatchObject({ month: '2026-11', day: null })
  })

  it('reads a Bizum column, and its total from the footer slot after card', () => {
    const m = parseQuirocitasCajaMonth(LT_MONTH('2026-11'))
    expect(m.layout.columns).toMatchObject({ date: 1, usedBono: 6, cash: 7, card: 8, bizum: 9, debt: 10, value: 12 })
    expect(m.layout.columns.transfer).toBeUndefined()
    expect(m.totals).toEqual({ cash: 40, card: 450, transfer: null, bizum: 35, value: 75 })
    expect(m.rows.map((r) => [r.citaId, r.bonoPaymentId, r.cash, r.card, r.bizum, r.value])).toEqual([
      ['5001', null, 40, null, null, 40],
      ['5003', null, null, null, 35, 35],
      [null, '700', null, 450, null, null],
    ])
    // A page with no Bizum column keeps the totals it always had.
    expect(parseQuirocitasCajaMonth(CAJA).totals).not.toHaveProperty('bizum')
  })

  it('counts Bizum when checking a month adds up', () => {
    const m = parseQuirocitasCajaMonth(LT_MONTH('2026-11'))
    const read = { month: '2026-11', rows: 3, printed: m.totals, summed: { cash: 40, card: 450, transfer: 0, bizum: m.rows.reduce((a, r) => a + (r.bizum ?? 0), 0) } }
    expect(quirocitasLedgerMismatches({ ledgerMonths: [read] })).toEqual([])
    // Bizum the page printed but nobody read is money missing, not a month that adds up.
    expect(quirocitasLedgerMismatches({ ledgerMonths: [{ ...read, summed: { ...read.summed, bizum: 0 } }] })).toHaveLength(1)
  })

  it('imports a Bizum payment as Bizum', () => {
    const s: QuirocitasSnapshot = {
      baseUrl: '', readAt: '', bonoTypes: parseQuirocitasBonoTypes(FICHA('101', 'x')),
      patients: { 101: { list: { id: '101', name: 'Laura Demo Prueba', phones: [] }, ficha: parseQuirocitasFicha(FICHA('101', 'Laura Demo Prueba'))!, history: parseQuirocitasHistory(HISTORIAL), invoices: [], techniques: {} } },
      failed: {},
      ledger: parseQuirocitasCajaMonth(LT_MONTH('2026-11')).rows,
      ledgerMonths: [],
    }
    const { payments } = quirocitasLedgerRows(s, quirocitasBonoRows(s, 'Europe/Madrid').bonoOfSale, 'Europe/Madrid')
    expect(payments.filter((p) => p.method === 'bizum').map((p) => [p.ref, p.amountCents, p.chargeRef])).toEqual([['QC-pay-5003-bizum', 3500, 'QC-inv-5003']])
  })

  describe('walking the ledger', () => {
    afterEach(() => { vi.unstubAllGlobals() })

    // A Quirocitas that keeps a day in the session. "Mes entero" shows that
    // day's month; ◄ goes back a day and shows the day view -- or, with
    // `monthly`, back a month in the month view, as the first clinics' did.
    function fakeQuirocitas({ monthly = false } = {}) {
      const posts: [string, string][][] = []
      let day = new Date(`${new Date().toISOString().slice(0, 10)}T12:00:00Z`)
      let view: 'day' | 'month' = 'day'
      vi.stubGlobal('fetch', async (url: string, init: { method?: string; body?: URLSearchParams } = {}) => {
        const path = new URL(url).pathname.split('/').pop()
        const html = (s: string) => new Response(s, { status: 200, headers: { 'content-type': 'text/html' } })
        if (path === 'login.php') {
          if (init.method !== 'POST') return html('<form><input name="usuario"><input type="password" name="passwd"></form>')
          day = new Date(`${new Date().toISOString().slice(0, 10)}T12:00:00Z`)
          view = 'day'
          return new Response(null, { status: 302, headers: { location: 'horario2.php', 'set-cookie': 'PHPSESSID=demo; path=/' } })
        }
        if (path !== 'diario.php') return html('')
        if (init.method !== 'POST') return html(LT_DAY(false, day))
        const body = [...init.body!.entries()]
        posts.push(body)
        const f = Object.fromEntries(body)
        if (f.franja === 'Mes entero') view = 'month'
        else if (f.previo !== undefined) {
          if (monthly && view === 'month') day = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() - 1, 15, 12))
          else { day = new Date(day.getTime() - 86_400_000); view = 'day' }
        }
        return html(view === 'month' ? LT_MONTH(ym(day)) : LT_DAY(true, day))
      })
      return { posts }
    }
    const back = (n: number) => { const d = new Date(); return ym(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 15))) }
    const client = () => new QuirocitasClient({ baseUrl: 'https://quirocitas-demo.test/chiro', username: 'demo', password: 'demo' })
    const presses = (posts: [string, string][][]) => posts.map((b) => b.find(([k]) => k === 'previo' || k === 'franja')?.join('=') ?? 'quiro')

    it('steps back a day at a time to the month before, then asks for the whole month', async () => {
      const { posts } = fakeQuirocitas()
      const c = client()
      const first = await c.ledger(null, 3)
      expect(first.months.map((m) => m.month)).toEqual([back(0), back(1), back(2)])
      expect(first.months.every((m) => m.rows.length === 3)).toBe(true)
      // Only ever the page's own buttons: the filter, "<", "Mes entero".
      expect(new Set(presses(posts))).toEqual(new Set(['quiro', 'previo=<', 'franja=Mes entero']))
      expect(presses(posts).filter((p) => p === 'franja=Mes entero')).toHaveLength(3)
      // The next call goes on from the cursor, in the same session.
      const next = await c.ledger(first.cursor, 2)
      expect(next.months.map((m) => m.month)).toEqual([back(3), back(4)])
    })

    it('stops between two months when its time is up, and goes on from there', async () => {
      fakeQuirocitas()
      const c = client()
      const first = await c.ledger(null, 1)
      // Already past: one step, then back with where it stands.
      const part = await c.ledger(first.cursor, 1, Date.now() - 1)
      expect(part.months).toEqual([])
      expect(part.cursor).toMatchObject({ month: back(0), day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
      const rest = await c.ledger(JSON.parse(JSON.stringify(part.cursor)), 1)
      expect(rest.months.map((m) => m.month)).toEqual([back(1)])
    })

    it('still walks a page whose ◄ shows the month before', async () => {
      const { posts } = fakeQuirocitas({ monthly: true })
      const read = await client().ledger(null, 3)
      expect(read.months.map((m) => m.month)).toEqual([back(0), back(1), back(2)])
      expect(presses(posts)).toEqual(['quiro', 'franja=Mes entero', 'previo=<', 'previo=<'])
    })

    it('resumes a cursor saved by the release before, as the bare form', async () => {
      const { posts } = fakeQuirocitas({ monthly: true })
      const c = client()
      await c.ledger(null, 1)
      const read = await c.ledger(quirocitasCajaFormBody(LT_MONTH(back(0))), 1)
      expect(posts.at(-1)).toContainEqual(['previo', '◄'])
      expect(read.months.map((m) => m.month)).toEqual([back(1)])
    })

    it('says where the month was lost when a page shows neither a month nor a day', async () => {
      fakeQuirocitas()
      vi.stubGlobal('fetch', async (url: string, init: { method?: string } = {}) => new URL(url).pathname.endsWith('login.php') && init.method === 'POST'
        ? new Response(null, { status: 302, headers: { location: 'horario2.php', 'set-cookie': 'PHPSESSID=demo' } })
        : new Response('<form action="diario.php"><input type="submit" name="franja" value="Mes entero"></form>', { status: 200 }))
      await expect(client().ledger(null, 1)).rejects.toThrow(QuirocitasLedgerError)
      await expect(client().ledger(null, 1)).rejects.toThrow('on opening it, after "Mes entero"')
    })
  })
})
