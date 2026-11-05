/**
 * 阅读原文自由画线：按 passageKey 持久化到 localStorage。
 *
 * 坐标统一归一化到 0..1，画布缩放/窗口变化时按比例重绘。
 * 笔画与当时的字号、换行绑定，因此作答页与复盘页各存一份（scope 区分），
 * 互不覆盖：两边原文宽度/字号不同，混用会整体错位。
 */

export type DrawingColor = 'red' | 'blue' | 'green'

/** 画线所属视图：作答页 / 复盘页 */
export type DrawingScope = 'session' | 'review'

export interface DrawingPoint {
  x: number
  y: number
}

export interface DrawingStroke {
  id: string
  color: DrawingColor
  /** CSS 像素线宽 */
  width: number
  points: DrawingPoint[]
}

export type DrawingMap = Record<string, DrawingStroke[]>

export const DRAWING_COLORS: { color: DrawingColor; label: string; hex: string }[] = [
  { color: 'red', label: '红色', hex: '#e5484d' },
  { color: 'blue', label: '蓝色', hex: '#3b82f6' },
  { color: 'green', label: '绿色', hex: '#2e9e4f' },
]

const STORAGE_KEYS: Record<DrawingScope, string> = {
  session: 'easysail-exam-reading-drawings',
  review: 'easysail-exam-reading-review-drawings',
}
const COLOR_SET = new Set<DrawingColor>(DRAWING_COLORS.map((item) => item.color))

function isPoint(value: unknown): value is DrawingPoint {
  if (!value || typeof value !== 'object') return false
  const point = value as Record<string, unknown>
  return (
    typeof point.x === 'number' &&
    typeof point.y === 'number' &&
    point.x >= 0 && point.x <= 1 &&
    point.y >= 0 && point.y <= 1
  )
}

function isStroke(value: unknown): value is DrawingStroke {
  if (!value || typeof value !== 'object') return false
  const stroke = value as Record<string, unknown>
  return (
    typeof stroke.id === 'string' &&
    typeof stroke.color === 'string' &&
    COLOR_SET.has(stroke.color as DrawingColor) &&
    typeof stroke.width === 'number' &&
    stroke.width > 0 &&
    stroke.width <= 8 &&
    Array.isArray(stroke.points) &&
    stroke.points.length >= 2 &&
    stroke.points.every(isPoint)
  )
}

/** 读取全部手绘线；脏数据逐条丢弃，不阻塞阅读 */
export function loadReadingDrawings(scope: DrawingScope = 'session'): DrawingMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS[scope])
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const map: DrawingMap = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue
      const list = value.filter(isStroke)
      if (list.length > 0) map[key] = list
    }
    return map
  } catch {
    return {}
  }
}

/** 保存全部手绘线；失败静默降级，不影响作答 */
export function saveReadingDrawings(map: DrawingMap, scope: DrawingScope = 'session'): void {
  try {
    localStorage.setItem(STORAGE_KEYS[scope], JSON.stringify(map))
  } catch {
    // 标注是辅助功能
  }
}

function makeDrawingId(): string {
  return `draw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 新建一条手绘线（时间戳/随机 id 收在模块内，避免组件渲染期调用 impure 函数） */
export function makeDrawingStroke(color: DrawingColor, points: DrawingPoint[]): DrawingStroke {
  return {
    id: makeDrawingId(),
    color,
    width: 2.2,
    points,
  }
}

/** 画布坐标归一化，超出边界时夹紧 */
export function clampPoint(x: number, y: number): DrawingPoint {
  return {
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y)),
  }
}
