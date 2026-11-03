/** 完形原文按 {{n}} 空位切分，供作答与复盘渲染。 */
export interface ClozeTextPart {
  text?: string
  seq?: number
}

export function splitClozeText(text: string): ClozeTextPart[] {
  const parts: ClozeTextPart[] = []
  const re = /\{\{(\d+)\}\}/g
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index) })
    parts.push({ seq: Number(match[1]) })
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) })
  return parts
}
