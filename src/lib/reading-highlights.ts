/**
 * 阅读原文划线：按 passageKey + 段落 + 字符偏移持久化到 localStorage。
 *
 * 划线只是阅读辅助，不进 SQLite / 云快照；换机器或清缓存后不保留。
 */

export type ReadingHighlightColor = 'yellow' | 'green' | 'pink'

export interface ReadingHighlight {
  id: string
  /** 0-based 段落下标 */
  paraIndex: number
  /** 段落纯文本内的起止偏移，end 不含 */
  start: number
  end: number
  color: ReadingHighlightColor
  createdAt: number
}

export type ReadingHighlightMap = Record<string, ReadingHighlight[]>

const STORAGE_KEY = 'easysail-exam-reading-highlights'
const COLORS = new Set<ReadingHighlightColor>(['yellow', 'green', 'pink'])

function isHighlight(value: unknown): value is ReadingHighlight {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string' &&
    Number.isInteger(item.paraIndex) &&
    (item.paraIndex as number) >= 0 &&
    Number.isInteger(item.start) &&
    Number.isInteger(item.end) &&
    (item.start as number) >= 0 &&
    (item.end as number) > (item.start as number) &&
    typeof item.color === 'string' &&
    COLORS.has(item.color as ReadingHighlightColor) &&
    typeof item.createdAt === 'number'
  )
}

/** 读取全部划线；脏数据逐条丢弃，不阻塞阅读 */
export function loadReadingHighlights(): ReadingHighlightMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const map: ReadingHighlightMap = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue
      const list = value
        .filter(isHighlight)
        .sort((a, b) => a.paraIndex - b.paraIndex || a.start - b.start)
      if (list.length > 0) map[key] = list
    }
    return map
  } catch {
    return {}
  }
}

/** 保存全部划线；存储失败（隐私模式/配额）时静默降级 */
export function saveReadingHighlights(map: ReadingHighlightMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // 划线是辅助功能，保存失败不影响作答
  }
}

export interface HighlightSegment {
  text: string
  highlight?: ReadingHighlight
}

/** 把段落切成普通文本/划线文本片段；跳过越界和重叠片段 */
export function splitHighlightSegments(text: string, highlights: ReadingHighlight[] | undefined): HighlightSegment[] {
  if (!highlights?.length) return [{ text }]
  const sorted = highlights
    .filter((h) => h.start >= 0 && h.start < h.end && h.end <= text.length)
    .sort((a, b) => a.start - b.start)
  const segments: HighlightSegment[] = []
  let cursor = 0
  for (const highlight of sorted) {
    if (highlight.start < cursor) continue
    if (highlight.start > cursor) segments.push({ text: text.slice(cursor, highlight.start) })
    segments.push({ text: text.slice(highlight.start, highlight.end), highlight })
    cursor = highlight.end
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) })
  return segments
}

/** 生成不会与已有划线冲突的稳定 id */
export function makeHighlightId(): string {
  return `hl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 新建一条划线记录（把时间戳/随机 id 收在模块内，避免组件渲染期调用 impure 函数） */
export function makeReadingHighlight(
  paraIndex: number,
  start: number,
  end: number,
  color: ReadingHighlightColor,
): ReadingHighlight {
  return {
    id: makeHighlightId(),
    paraIndex,
    start,
    end,
    color,
    createdAt: Date.now(),
  }
}

/**
 * 计算 Range 在某个纯文本容器内的起止偏移。
 * 选区起点/终点不在容器内时返回 null（例如选中了段落号）。
 */
export function rangeOffsetsWithin(container: HTMLElement, range: Range): { start: number; end: number } | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let offset = 0
  let start = -1
  let end = -1
  let node: Node | null
  while ((node = walker.nextNode())) {
    const length = node.textContent?.length || 0
    if (node === range.startContainer) start = offset + range.startOffset
    if (node === range.endContainer) end = offset + range.endOffset
    offset += length
  }
  if (start < 0 || end < 0 || end <= start) return null
  return { start, end }
}
