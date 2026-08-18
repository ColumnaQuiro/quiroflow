export const DOC_TEMPLATE_FIELDS = [
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'date_of_birth', label: 'Date of birth' },
  { key: 'email', label: 'Email' },
  { key: 'clinic_name', label: 'Clinic name' },
  { key: 'today', label: "Today's date" },
]

// Deep-clones a TipTap JSON document, replacing {{field}} tokens inside
// text nodes. Generic tree walk since TipTap nodes nest arbitrarily
// (headings, lists, blockquotes...) and text can appear at any depth.
export function renderDocTemplate(node: unknown, vars: Record<string, string>): unknown {
  if (node == null) return node
  if (Array.isArray(node)) return node.map((n) => renderDocTemplate(n, vars))
  if (typeof node === 'object') {
    const source = node as Record<string, unknown>
    const copy: Record<string, unknown> = { ...source }
    if (typeof copy.text === 'string') {
      copy.text = copy.text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '')
    }
    if (copy.content) copy.content = renderDocTemplate(copy.content, vars)
    return copy
  }
  return node
}
