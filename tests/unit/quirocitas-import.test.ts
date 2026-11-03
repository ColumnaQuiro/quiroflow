import { describe, expect, it } from 'vitest'
import {
  parseQuirocitasBonoTypes,
  parseQuirocitasCajaMonth,
  parseQuirocitasFicha,
  parseQuirocitasHistory,
  parseQuirocitasInvoice,
  parseQuirocitasPatientList,
  quirocitasCajaFormBody,
} from '../../utils/quirocitasPages'
import {
  quirocitasAppointmentRows,
  quirocitasBonoRows,
  quirocitasDate,
  quirocitasLedgerRows,
  quirocitasPatientRow,
  quirocitasPhone,
  quirocitasVisitNotes,
  splitQuirocitasName,
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
})
