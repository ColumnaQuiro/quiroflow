import { describe, expect, it } from 'vitest'
import { templateMetaProblem } from '../../utils/whatsappTemplateMetaError'

describe('templateMetaProblem', () => {
  it("names the edit limit, from Meta's code or from its sentence alone", () => {
    expect(templateMetaProblem({ code: 100, error_subcode: 2388039, message: 'Invalid parameter' })?.es).toContain('una vez al día y hasta 10 veces al mes')
    // Since v16 the subcode is not always sent; the sentence still says it.
    expect(templateMetaProblem({ code: 100, message: 'Invalid parameter', error_user_msg: 'You can only edit an approved template once every 24 hours.' })?.en).toContain('once a day and up to 10 times a month')
    expect(templateMetaProblem({ code: 100, error_user_title: "Message template status can't be changed" })?.en).toContain('Try again tomorrow')
  })

  it('says what to change for the content Meta refuses', () => {
    expect(templateMetaProblem({ code: 100, error_subcode: 2388299 })?.es).toContain('no puede empezar ni terminar con una variable')
    expect(templateMetaProblem({ code: 100, error_subcode: 2388293 })?.es).toContain('demasiadas variables')
    expect(templateMetaProblem({ code: 100, error_subcode: 2388073 })?.es).toContain('pie')
    expect(templateMetaProblem({ code: 100, error_subcode: 2388040 })?.es).toContain('Acórtalo')
    expect(templateMetaProblem({ code: 100, error_subcode: 2388024 })?.es).toContain('otro título')
  })

  it('tells an expired or under-permitted connection apart from a bad template', () => {
    expect(templateMetaProblem({ code: 190, message: 'Error validating access token: Session has expired.' })?.es).toContain('ha caducado')
    expect(templateMetaProblem({ code: 200, message: 'Permissions error' })?.es).toContain('no tiene permiso')
    expect(templateMetaProblem({ code: 80008, message: 'Too many calls' })?.es).toContain('demasiadas peticiones')
  })

  it("leaves a refusal it does not know to Meta's own words", () => {
    expect(templateMetaProblem({ code: 100, message: 'Invalid parameter', error_user_msg: 'The button text is not allowed.' })).toBeNull()
    expect(templateMetaProblem(null)).toBeNull()
    expect(templateMetaProblem(undefined)).toBeNull()
  })
})
