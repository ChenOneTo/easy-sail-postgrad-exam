/**
 * 原文自由画线画布：透明覆盖在文章上。
 *
 * - 作答时 interactive=true：鼠标/触控拖动即画线；
 * - 复盘或未开启画线时 interactive=false：pointer-events: none，不挡文本选择。
 * 笔画坐标归一化，窗口缩放时按比例重绘。
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  DRAWING_COLORS,
  clampPoint,
  makeDrawingStroke,
  type DrawingColor,
  type DrawingPoint,
  type DrawingStroke,
} from '../lib/reading-drawings'

interface Props {
  strokes: DrawingStroke[]
  interactive?: boolean
  color?: DrawingColor
  eraser?: boolean
  onChange?: (strokes: DrawingStroke[]) => void
}

const COLOR_HEX = Object.fromEntries(
  DRAWING_COLORS.map((item) => [item.color, item.hex]),
) as Record<DrawingColor, string>

const ERASER_RADIUS = 14

function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: DrawingStroke,
  width: number,
  height: number,
) {
  if (stroke.points.length === 0) return
  const color = COLOR_HEX[stroke.color] || COLOR_HEX.red
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = stroke.width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (stroke.points.length === 1) {
    const p = stroke.points[0]
    ctx.beginPath()
    ctx.arc(p.x * width, p.y * height, stroke.width / 2, 0, Math.PI * 2)
    ctx.fill()
    return
  }

  ctx.beginPath()
  ctx.moveTo(stroke.points[0].x * width, stroke.points[0].y * height)
  for (let i = 1; i < stroke.points.length; i++) {
    ctx.lineTo(stroke.points[i].x * width, stroke.points[i].y * height)
  }
  ctx.stroke()
}

export function ReadingDrawingCanvas({
  strokes,
  interactive = false,
  color = 'red',
  eraser = false,
  onChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const strokesRef = useRef(strokes)
  const activeRef = useRef<DrawingStroke | null>(null)
  const pointerDownRef = useRef(false)
  const rafRef = useRef(0)
  const lastEraseRef = useRef(-1000)
  const [size, setSize] = useState({ w: 0, h: 0 })

  const drawAll = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || size.w <= 0 || size.h <= 0) return
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)
    const list = activeRef.current
      ? [...strokesRef.current, activeRef.current]
      : strokesRef.current
    for (const stroke of list) drawStroke(ctx, stroke, size.w, size.h)
  }, [size])

  const scheduleDraw = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      drawAll()
    })
  }, [drawAll])

  // 监听文章尺寸变化；用 rAF 延后一次 setState，避免同步 effect setState
  useEffect(() => {
    const canvas = canvasRef.current
    const parent = canvas?.parentElement
    if (!canvas || !parent) return
    const measure = () => {
      const rect = canvas.getBoundingClientRect()
      const w = Math.round(rect.width)
      const h = Math.round(rect.height)
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }))
    }
    const raf = requestAnimationFrame(measure)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(parent)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(raf)
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  // 尺寸或笔画变化时重设像素尺寸并重绘
  useEffect(() => {
    strokesRef.current = strokes
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.round(size.w * dpr))
    const h = Math.max(1, Math.round(size.h * dpr))
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    drawAll()
  }, [drawAll, size, strokes])

  useEffect(() => {
    if (interactive) return
    activeRef.current = null
    pointerDownRef.current = false
    scheduleDraw()
  }, [interactive, scheduleDraw])

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
  }, [])

  const pointFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>): DrawingPoint | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return clampPoint(
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height,
    )
  }

  const eraseAt = (point: DrawingPoint, timestamp: number) => {
    if (!onChange) return
    if (timestamp - lastEraseRef.current < 40) return
    lastEraseRef.current = timestamp
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const radiusSq = ERASER_RADIUS * ERASER_RADIUS
    const next = strokesRef.current.filter((stroke) => !stroke.points.some((p) => {
      const dx = (p.x - point.x) * rect.width
      const dy = (p.y - point.y) * rect.height
      return dx * dx + dy * dy <= radiusSq
    }))
    if (next.length === strokesRef.current.length) return
    strokesRef.current = next
    onChange(next)
    scheduleDraw()
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!interactive || !onChange) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const point = pointFromEvent(event)
    if (!point) return
    event.preventDefault()
    pointerDownRef.current = true
    try {
      canvasRef.current?.setPointerCapture(event.pointerId)
    } catch {
      // 部分环境不支持 pointer capture，不影响绘制
    }

    if (eraser) {
      eraseAt(point, event.timeStamp)
      return
    }
    activeRef.current = makeDrawingStroke(color, [point])
    scheduleDraw()
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!interactive || !onChange) return
    const point = pointFromEvent(event)
    if (!point) return
    if (eraser) {
      if (!pointerDownRef.current) return
      eraseAt(point, event.timeStamp)
      return
    }
    const active = activeRef.current
    if (!active) return
    active.points.push(point)
    scheduleDraw()
  }

  const finishStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!interactive || !onChange) return
    pointerDownRef.current = false
    try {
      canvasRef.current?.releasePointerCapture(event.pointerId)
    } catch {
      // ignore
    }
    const active = activeRef.current
    activeRef.current = null
    if (!active || active.points.length < 2) {
      scheduleDraw()
      return
    }
    const next = [...strokesRef.current, active]
    strokesRef.current = next
    onChange(next)
    scheduleDraw()
  }

  const cancelStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!interactive) return
    pointerDownRef.current = false
    try {
      canvasRef.current?.releasePointerCapture(event.pointerId)
    } catch {
      // ignore
    }
    activeRef.current = null
    scheduleDraw()
  }

  return (
    <canvas
      ref={canvasRef}
      className={`reading-draw-canvas${interactive ? ' interactive' : ''}${eraser ? ' eraser' : ''}`}
      aria-hidden="true"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishStroke}
      onPointerCancel={cancelStroke}
    />
  )
}
