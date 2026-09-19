import { MAX_RECORDS_PER_SUBMISSION, transmissionBlockedBy } from '../../../utils/verifactuSoap'

// Whether anything may go out at all.
//
// Checked before a submission is built rather than while sending it: a
// half-assembled envelope that then cannot go is harder to reason about than
// one that was never started. Two of these reasons are not temporary -- they
// are what is still missing from the whole VeriFactu effort, so they are
// answered in words rather than discovered as a failed request.
describe('Whether the records may be sent', () => {
  const NIF = 'B99999999'
  const cert = { environment: 'test' as const, certificatePath: '/tmp/sello.p12' }
  const past = new Date(Date.now() - 60_000)
  const future = new Date(Date.now() + 60_000)

  it('will not send without the producer NIF, whatever else is ready', () => {
    // The real SIF_PRODUCER.nif is still blank, so this is today's answer for
    // every caller. It is a required field of the SistemaInformatico block on
    // every record: sending without it would put a malformed block on real
    // fiscal records at the AEAT.
    expect(transmissionBlockedBy({ config: cert, pendingCount: 10, readyAt: past })).to.eq('no-producer-nif')
  })

  it('will not send without a certificate', () => {
    expect(
      transmissionBlockedBy({ config: { environment: 'test' }, pendingCount: 10, readyAt: past, producerNif: NIF }),
    ).to.eq('no-certificate')
  })

  it('says there is nothing to send rather than sending an empty envelope', () => {
    // An empty envío is rejected, and it would reset the pace for no reason.
    expect(transmissionBlockedBy({ config: cert, pendingCount: 0, readyAt: past, producerNif: NIF })).to.eq(
      'nothing-to-send',
    )
  })

  it('waits when the AEAT said to wait', () => {
    expect(transmissionBlockedBy({ config: cert, pendingCount: 5, readyAt: future, producerNif: NIF })).to.eq(
      'waiting-on-aeat-pace',
    )
  })

  it('sends once the wait has elapsed', () => {
    expect(transmissionBlockedBy({ config: cert, pendingCount: 5, readyAt: past, producerNif: NIF })).to.eq(null)
  })

  it('does not hold a full batch back waiting for a timer', () => {
    // "deberá esperar a que transcurran <TiempoEsperaEnvio> segundos desde el
    // anterior envío O deberá esperar a tener acumulados un número de
    // registros igual al límite ... la circunstancia que ocurra primero."
    //
    // Both halves matter. A sender that only waited would sit on a thousand
    // ready records for no reason; one that only counted would hammer the
    // service.
    expect(MAX_RECORDS_PER_SUBMISSION).to.eq(1000)
    expect(
      transmissionBlockedBy({
        config: cert,
        pendingCount: MAX_RECORDS_PER_SUBMISSION,
        readyAt: future,
        producerNif: NIF,
      }),
      'a full batch goes immediately',
    ).to.eq(null)

    // One short of the limit still waits -- the escape is the limit itself,
    // not "nearly".
    expect(
      transmissionBlockedBy({
        config: cert,
        pendingCount: MAX_RECORDS_PER_SUBMISSION - 1,
        readyAt: future,
        producerNif: NIF,
      }),
    ).to.eq('waiting-on-aeat-pace')
  })
})
