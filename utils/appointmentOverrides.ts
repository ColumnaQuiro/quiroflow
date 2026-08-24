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
  // Ternary, not `teamMemberId && ...` -- when teamMemberId is '' (unassigned),
  // `&&` short-circuits to '' itself rather than false/undefined, and `?? typeDuration`
  // below doesn't treat '' as missing, so the empty string used to leak straight
  // through as the "effective" value instead of falling back to the type default.
  const o = teamMemberId ? overrides.find((x) => x.appointment_type_id === appointmentTypeId && x.team_member_id === teamMemberId) : undefined
  return o?.duration_minutes ?? typeDuration
}

export function effectivePriceCents(
  typeDefaultPriceCents: number,
  appointmentTypeId: string,
  teamMemberId: string | null | undefined,
  overrides: AppointmentTypeOverride[],
): number {
  const o = teamMemberId ? overrides.find((x) => x.appointment_type_id === appointmentTypeId && x.team_member_id === teamMemberId) : undefined
  return o?.price_cents ?? typeDefaultPriceCents
}
