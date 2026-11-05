/**
 * 原文画线工具条：画线开关 + 颜色 + 橡皮 + 撤销 + 清除。
 * 作答页与复盘页共用，样式沿用 index.css 的 .reading-draw-*。
 */
import { Eraser, PenLine, Trash2, Undo2 } from 'lucide-react'
import { DRAWING_COLORS, type DrawingColor } from '../lib/reading-drawings'

interface Props {
  drawingMode: boolean
  /** 当前画笔颜色 */
  activeColor: DrawingColor
  eraser: boolean
  /** 当前文章的笔画数，用于禁用撤销/清除 */
  strokeCount: number
  onToggle: () => void
  onColorChange: (color: DrawingColor) => void
  onEraserToggle: () => void
  onUndo: () => void
  onClear: () => void
}

export function ReadingDrawingTools({
  drawingMode,
  activeColor,
  eraser,
  strokeCount,
  onToggle,
  onColorChange,
  onEraserToggle,
  onUndo,
  onClear,
}: Props) {
  return (
    <>
      <button
        className={`exam-ghost-btn reading-draw-toggle${drawingMode ? ' active' : ''}`}
        onClick={onToggle}
      >
        <PenLine size={12} /> {drawingMode ? '完成' : '画线'}
      </button>
      {drawingMode && (
        <>
          {DRAWING_COLORS.map((item) => (
            <button
              key={item.color}
              className={`reading-draw-color${activeColor === item.color && !eraser ? ' active' : ''}`}
              style={{ background: item.hex }}
              title={item.label}
              aria-label={item.label}
              onClick={() => onColorChange(item.color)}
            />
          ))}
          <button
            className={`exam-ghost-btn reading-draw-tool${eraser ? ' active' : ''}`}
            onClick={onEraserToggle}
            title="橡皮：拖动擦除整条线"
          >
            <Eraser size={12} />
          </button>
          <button
            className="exam-ghost-btn reading-draw-tool"
            onClick={onUndo}
            disabled={strokeCount === 0}
            title="撤销上一笔"
          >
            <Undo2 size={12} />
          </button>
          <button
            className="exam-ghost-btn reading-draw-tool"
            onClick={onClear}
            disabled={strokeCount === 0}
            title="清除本篇"
          >
            <Trash2 size={12} />
          </button>
          <span className="reading-draw-hint">{eraser ? '拖动橡皮擦除整条线' : '按住鼠标在原文上自由画线'}</span>
        </>
      )}
      {!drawingMode && strokeCount > 0 && (
        <span className="reading-draw-hint">已标注 {strokeCount} 笔</span>
      )}
    </>
  )
}
