/**
 * Webster stores each part of speech as a paragraph, but its numbered senses
 * inside that paragraph are one long line. Put sequential senses on their own
 * lines without mistaking citations such as `Gen. vii. 17.` or `Col. iii. 2.`
 * for dictionary numbering.
 */
export function formatDefinition(raw: string): string {
  return raw
    .trim()
    .split(/\n\s*\n/gu)
    .map(formatDefinitionParagraph)
    .filter(Boolean)
    .join('\n\n')
}

function formatDefinitionParagraph(raw: string): string {
  let text = raw.replace(/\s+/gu, ' ').trim()
  if (!/^1\.\s/u.test(text)) return text

  let from = 0
  for (let sense = 2; sense <= 50; sense += 1) {
    const marker = ` ${sense}. `
    let at = text.indexOf(marker, from)
    while (at >= 0 && isCitationNumber(text, at)) {
      at = text.indexOf(marker, at + marker.length)
    }
    if (at < 0) break
    text = `${text.slice(0, at)}\n${text.slice(at + 1)}`
    from = at + marker.length
  }
  return text
}

function isCitationNumber(text: string, markerAt: number): boolean {
  return /\b[A-Za-z]{1,20}\.\s+[ivxlcdm]+\.$/iu.test(text.slice(0, markerAt))
}
