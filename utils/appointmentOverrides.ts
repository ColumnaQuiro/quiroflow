export interface AppointmentTypeOverride {
  appointment_type_id: string
  team_member_id: string
  duration_minutes: number | null
  price_cents: number | null
}

export function effectiveDuration(
  typeDuration: number,
  appointmentTypeId: string,
  teamMemberId: string | null | undefined,
  overrides: AppointmentTypeOverride[],
): number {
  const o = teamMemberId && overrides.find((x) => x.appointment_type_id === appointmentTypeId && x.team_member_id === teamMemberId)
  return (o && o.duration_minutes) ?? typeDuration
}

export function effectivePriceCents(
  typeDefaultPriceCents: number,
  appointmentTypeId: string,
  teamMemberId: string | null | undefined,
  overrides: AppointmentTypeOverride[],
): number {
  const o = teamMemberId && overrides.find((x) => x.appointment_type_id === appointmentTypeId && x.team_member_id === teamMemberId)
  return (o && o.price_cents) ?? typeDefaultPriceCents
}
