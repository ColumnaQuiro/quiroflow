import { describe, it, expect } from 'vitest'
import { describeUnjudged, parseSoapFault } from '../../utils/verifactuSoap'

// When the AEAT answers with a SOAP Fault it WAS reached, and the faultcode
// says whose side the problem is on. The stored text has to keep that, so
// Settings > VeriFactu can tell the AEAT's own outage from our document being
// refused -- on 26 Sep an internal error on the AEAT's test service read as
// "Could not reach the AEAT", with the raw XML beneath it.
describe('An AEAT answer that judged nothing', () => {
  const serverFault =
    '<?xml version="1.0" encoding="UTF-8"?><env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Body><env:Fault><faultcode>env:Server</faultcode><faultstring>Codigo[102].Error interno en el servidor, Id. Error: 132499179</faultstring></env:Fault></env:Body></env:Envelope>'

  it('is stored as the AEAT fault it is, in words', () => {
    expect(describeUnjudged(299, serverFault)).to.eq('AEAT fault env:Server: Codigo[102].Error interno en el servidor, Id. Error: 132499179')
  })

  it('is read back the same whether it was stored as words or, before this, as raw XML', () => {
    const fromWords = parseSoapFault(describeUnjudged(299, serverFault))
    const fromOldRow = parseSoapFault(`HTTP 299: response was not a VERI*FACTU answer: ${serverFault}`)
    expect(fromWords).to.deep.eq({ code: 'env:Server', text: 'Codigo[102].Error interno en el servidor, Id. Error: 132499179' })
    expect(fromOldRow).to.deep.eq(fromWords)
  })

  it('keeps a client fault apart: the document was refused, not the service down', () => {
    const clientFault = '<env:Fault><faultcode>env:Client</faultcode><faultstring>Codigo[4102].El XML no cumple el esquema.</faultstring></env:Fault>'
    expect(parseSoapFault(clientFault)?.code).to.eq('env:Client')
  })

  it('is not a fault at all when it is some other page, and says so with the status', () => {
    expect(describeUnjudged(502, '<html>Bad gateway</html>')).to.match(/^HTTP 502: response was not a VERI\*FACTU answer/)
    expect(parseSoapFault('<html>Bad gateway</html>')).to.eq(null)
  })
})
