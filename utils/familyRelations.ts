// Family links between two patients (patient_relations,
// 20261021171628_patient_family.sql). A row (patient, related, relation)
// reads "related is patient's <relation>", and every link is stored both
// ways: the other row carries the inverse.

export const FAMILY_RELATIONS = ['parent', 'child', 'partner', 'sibling', 'other'] as const
export type FamilyRelation = (typeof FAMILY_RELATIONS)[number]

/** What the other person is to them: my parent's row for me says "child". */
export function inverseRelation(relation: FamilyRelation): FamilyRelation {
  if (relation === 'parent') return 'child'
  if (relation === 'child') return 'parent'
  return relation
}

/**
 * The relation as the desk says it, by the sex on the related person's record
 * when it has one: "Madre", "Hijo"; "Padre/madre" when it does not.
 */
export function relationLabel(relation: string, gender: string | null | undefined, t: (en: string, es: string) => string): string {
  const female = gender === 'female'
  const male = gender === 'male'
  switch (relation) {
    case 'parent':
      return female ? t('Mother', 'Madre') : male ? t('Father', 'Padre') : t('Parent', 'Padre/madre')
    case 'child':
      return female ? t('Daughter', 'Hija') : male ? t('Son', 'Hijo') : t('Child', 'Hijo/a')
    case 'partner':
      return t('Partner', 'Pareja')
    case 'sibling':
      return female ? t('Sister', 'Hermana') : male ? t('Brother', 'Hermano') : t('Sibling', 'Hermano/a')
    default:
      return t('Family', 'Familiar')
  }
}
