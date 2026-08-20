/**
 * `{name}` placeholders. Deliberately not a template engine: every message is
 * written by us, and anything that needs real formatting (dates, plurals) is
 * either `Intl` at the call site or a `.one` / `.other` pair.
 */
export function format(
  template: string,
  values?: Record<string, string | number>,
): string {
  if (!values) return template
  return template.replace(/\{(\w+)\}/gu, (match, name: string) =>
    name in values ? String(values[name]) : match,
  )
}
