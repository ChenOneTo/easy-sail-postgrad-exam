/**
 * 阅读作答视图。
 *
 * 计时用墙钟 deadline，不用 tick 累减；退出/切后台不暂停，回到前台按真实时间重算。
 * 每次选择立即写 attempt，应用崩溃后可从 ongoing session 恢复。
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Clock, Eraser, Flag, Send } from 'lucide-react'
import { submitReadingSession, upsertReadingAttempt } from '../lib/exam-reading-db'
import {
  loadReadingHighlights,
  makeReadingHighlight,
  rangeOffsetsWithin,
  saveReadingHighlights,
  splitHighlightSegments,
  type ReadingHighlightColor,
  type ReadingHighlightMap,
} from '../lib/reading-highlights'
import type {
  ReadingAttempt,
  ReadingQuestionWithPassage,
  ReadingSession as ReadingSessionRow,
} from '../lib/exam-reading-db'
import { useExamReadingStore } from '../stores/exam-reading-store'

interface Props {
  session: ReadingSessionRow
  questions: ReadingQuestionWithPassage[]
  initialAttempts: ReadingAttempt[]
  onExit: () => void
  onSubmitted: (session: ReadingSessionRow) => void
}

interface SelectionMenu {
  x: number
  y: number
  passageKey: string
  paraIndex: number
  start: number
  end: number
  overlapping: boolean
}

const HIGHLIGHT_COLORS: { color: ReadingHighlightColor; label: string }[] = [
  { color: 'yellow', label: '黄色划线' },
  { color: 'green', label: '绿色划线' },
  { color: 'pink', label: '粉色划线' },
]

function fmtClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function globalNo(q: ReadingQuestionWithPassage): number {
  return 20 + (q.textNo - 1) * 5 + q.seq
}

function isCorrectAnswer(q: ReadingQuestionWithPassage, letter: string): boolean {
  return letter === q.answer || (q.disputed && !!q.answerAlt && letter === q.answerAlt)
}

export function ReadingSession({ session, questions, initialAttempts, onExit, onSubmitted }: Props) {
  const [answers, setAnswers] = useState<Record<number, string>>(() => {
    const map: Record<number, string> = {}
    for (const attempt of initialAttempts) {
      if (attempt.userAnswer) map[attempt.questionId] = attempt.userAnswer
    }
    return map
  })
  const [flags, setFlags] = useState<Record<number, boolean>>(() => {
    const map: Record<number, boolean> = {}
    for (const attempt of initialAttempts) {
      if (attempt.flagged) map[attempt.questionId] = true
    }
    return map
  })
  const [index, setIndex] = useState(0)
  const [remainingMs, setRemainingMs] = useState(() => {
    if (!session.deadlineAt) return 0
    return Math.max(0, new Date(session.deadlineAt).getTime() - Date.now())
  })
  const [elapsedMs, setElapsedMs] = useState(() => Math.max(0, Date.now() - new Date(session.startedAt).getTime()))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [highlightMap, setHighlightMap] = useState<ReadingHighlightMap>(() => loadReadingHighlights())
  const [selectionMenu, setSelectionMenu] = useState<SelectionMenu | null>(null)

  const submittedRef = useRef(false)
  const questionStartRef = useRef(0)
  const durationsRef = useRef<Record<number, number>>({})
  const onSubmittedRef = useRef(onSubmitted)
  const highlightToolbarRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    onSubmittedRef.current = onSubmitted
  }, [onSubmitted])

  useEffect(() => {
    questionStartRef.current = Date.now()
  }, [index])

  useEffect(() => {
    saveReadingHighlights(highlightMap)
  }, [highlightMap])

  useEffect(() => {
    if (!selectionMenu) return
    const onDown = (event: globalThis.MouseEvent) => {
      if (highlightToolbarRef.current?.contains(event.target as Node)) return
      setSelectionMenu(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [selectionMenu])

  const current = questions[Math.min(index, Math.max(0, questions.length - 1))]
  const answeredCount = questions.filter((q) => !!answers[q.id]).length
  const wrongbookCount = useExamReadingStore((s) => s.wrongbook.length)
  const currentHighlights = current ? highlightMap[current.passageKey] || [] : []

  const handleSubmit = useCallback(
    async (auto: boolean) => {
      if (submittedRef.current) return
      submittedRef.current = true
      setSubmitting(true)
      setError('')
      try {
        const submitted = await submitReadingSession(session.id, auto)
        if (submitted) {
          useExamReadingStore.getState().markDirty()
          onSubmittedRef.current(submitted)
        } else {
          submittedRef.current = false
        }
      } catch (err) {
        submittedRef.current = false
        setError(`交卷失败：${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setSubmitting(false)
      }
    },
    [session.id],
  )

  // 墙钟计时：后台节流/休眠后回到前台立即重算
  useEffect(() => {
    const tick = () => {
      const now = Date.now()
      if (session.deadlineAt) {
        const remain = Math.max(0, new Date(session.deadlineAt).getTime() - now)
        setRemainingMs(remain)
        setElapsedMs(Math.min(session.limitSeconds * 1000, now - new Date(session.startedAt).getTime()))
        if (remain <= 0) void handleSubmit(true)
      } else {
        setElapsedMs(Math.max(0, now - new Date(session.startedAt).getTime()))
      }
    }
    tick()
    const timer = setInterval(tick, 500)
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [session.deadlineAt, session.limitSeconds, session.startedAt, handleSubmit])

  const goTo = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(questions.length - 1, next))
      if (clamped === index) return
      setIndex(clamped)
      setSelectionMenu(null)
      questionStartRef.current = Date.now()
    },
    [index, questions.length],
  )

  const selectAnswer = useCallback(
    async (letter: string) => {
      if (!current) return
      if (answers[current.id] === letter) return
      const startedAt = questionStartRef.current || Date.now()
      const delta = Math.min(5 * 60 * 1000, Math.max(0, Date.now() - startedAt))
      durationsRef.current[current.id] = (durationsRef.current[current.id] || 0) + delta
      questionStartRef.current = Date.now()
      setAnswers((prev) => ({ ...prev, [current.id]: letter }))
      try {
        await upsertReadingAttempt({
          sessionId: session.id,
          questionId: current.id,
          userAnswer: letter,
          isCorrect: isCorrectAnswer(current, letter),
          durationMs: durationsRef.current[current.id],
          flagged: !!flags[current.id],
        })
        useExamReadingStore.getState().markDirty()
      } catch (err) {
        setError(`保存作答失败：${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [answers, current, flags, session.id],
  )

  const toggleFlag = useCallback(async () => {
    if (!current) return
    const next = !flags[current.id]
    setFlags((prev) => ({ ...prev, [current.id]: next }))
    try {
      await upsertReadingAttempt({
        sessionId: session.id,
        questionId: current.id,
        userAnswer: answers[current.id] || '',
        isCorrect: answers[current.id] ? isCorrectAnswer(current, answers[current.id]) : false,
        durationMs: durationsRef.current[current.id] || 0,
        flagged: next,
      })
      useExamReadingStore.getState().markDirty()
    } catch (err) {
      setError(`保存标记失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [answers, current, flags, session.id])

  /** 选中原文后弹出画线工具条 */
  const handlePassageMouseUp = () => {
    if (!current) return
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) {
      setSelectionMenu(null)
      return
    }
    const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null
    if (!range) return

    const startEl = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
    const endEl = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement
    const startP = startEl?.closest('p[data-para-index]') as HTMLElement | null
    const endP = endEl?.closest('p[data-para-index]') as HTMLElement | null
    if (!startP || startP !== endP) {
      setSelectionMenu(null)
      return
    }

    const paraIndex = Number(startP.dataset.paraIndex)
    if (!Number.isInteger(paraIndex) || paraIndex < 0 || paraIndex >= current.paragraphs.length) return
    const textEl = startP.querySelector('.reading-passage-text') as HTMLElement | null
    if (!textEl) return

    const offsets = rangeOffsetsWithin(textEl, range)
    if (!offsets) return
    const paragraph = current.paragraphs[paraIndex]
    let { start, end } = offsets
    while (start < end && /\s/.test(paragraph[start])) start++
    while (end > start && /\s/.test(paragraph[end - 1])) end--
    if (end - start < 2 || end - start > 500) {
      setSelectionMenu(null)
      return
    }

    const ranges = highlightMap[current.passageKey] || []
    const overlapping = ranges.some((h) => h.paraIndex === paraIndex && h.start < end && h.end > start)
    const rect = range.getBoundingClientRect()
    setSelectionMenu({
      x: Math.max(8, Math.min(rect.left, window.innerWidth - 290)),
      y: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 54)),
      passageKey: current.passageKey,
      paraIndex,
      start,
      end,
      overlapping,
    })
  }

  const applyHighlight = (color: ReadingHighlightColor) => {
    if (!selectionMenu) return
    const { passageKey, paraIndex, start, end } = selectionMenu
    const highlight = makeReadingHighlight(paraIndex, start, end, color)
    setHighlightMap((prev) => {
      const kept = (prev[passageKey] || []).filter(
        (h) => !(h.paraIndex === paraIndex && h.start < end && h.end > start),
      )
      return {
        ...prev,
        [passageKey]: [...kept, highlight].sort((a, b) => a.paraIndex - b.paraIndex || a.start - b.start),
      }
    })
    setSelectionMenu(null)
    window.getSelection()?.removeAllRanges()
  }

  const removeHighlight = () => {
    if (!selectionMenu) return
    const { passageKey, paraIndex, start, end } = selectionMenu
    setHighlightMap((prev) => ({
      ...prev,
      [passageKey]: (prev[passageKey] || []).filter(
        (h) => !(h.paraIndex === paraIndex && h.start < end && h.end > start),
      ),
    }))
    setSelectionMenu(null)
    window.getSelection()?.removeAllRanges()
  }

  const clearHighlights = () => {
    if (!current || currentHighlights.length === 0) return
    if (!window.confirm('清除本篇所有划线？')) return
    setHighlightMap((prev) => {
      const next = { ...prev }
      delete next[current.passageKey]
      return next
    })
    setSelectionMenu(null)
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        if (e.key === 'Enter') {
          e.preventDefault()
          void handleSubmit(false)
        }
        return
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        goTo(index + 1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goTo(index - 1)
      } else if (['1', '2', '3', '4'].includes(e.key) && current) {
        e.preventDefault()
        void selectAnswer('ABCD'[Number(e.key) - 1])
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [current, goTo, handleSubmit, index, selectAnswer])

  const manualSubmit = () => {
    const unanswered = questions.length - answeredCount
    if (unanswered > 0 && !window.confirm(`还有 ${unanswered} 题未作答，确定交卷？`)) return
    void handleSubmit(false)
  }

  const handleExit = () => {
    if (window.confirm('离开后计时继续，确定退出？')) onExit()
  }

  const timeMs = session.limitSeconds > 0 ? remainingMs : elapsedMs
  const timerTone = session.limitSeconds > 0
    ? remainingMs <= 60_000 ? ' danger' : remainingMs <= 300_000 ? ' warn' : ''
    : ''

  const passageQuestions = useMemo(
    () => questions.filter((q) => q.passageKey === current?.passageKey),
    [current?.passageKey, questions],
  )

  if (!current) {
    return (
      <div className="reading-session">
        <p className="placeholder-text">会话题目为空。</p>
        <button className="exam-ghost-btn" onClick={onExit}>返回</button>
      </div>
    )
  }

  const isSet = session.mode === 'set'
  const title = isSet
    ? `${current.year} 整套模考`
    : `${current.year} Text ${current.textNo}`

  return (
    <div className="reading-session">
      <header className="reading-session-head">
        <button className="exam-ghost-btn" onClick={handleExit}>
          <ArrowLeft size={14} /> 退出
        </button>
        <div className="reading-session-title">
          <b>{title}</b>
          <span>{isSet ? `${questions.length} 题 · 套卷` : `${questions.length} 题 · ${session.mode === 'close' ? '精读' : session.mode === 'wrong' ? '错题重做' : '限时'}`}</span>
        </div>
        <div className={`reading-timer${timerTone}`}>
          <Clock size={15} />
          <span>{fmtClock(timeMs)}</span>
          {session.limitSeconds > 0 && <small>{remainingMs <= 0 ? '已到时' : '剩余'}</small>}
        </div>
        <button className="exam-primary-btn" onClick={manualSubmit} disabled={submitting}>
          <Send size={14} /> {submitting ? '交卷中…' : '交卷'}
        </button>
      </header>

      {error && (
        <div className="exam-vocab-error">
          <span>{error}</span>
          <button className="exam-vocab-error-close" onClick={() => setError('')}>×</button>
        </div>
      )}

      <div className="reading-session-body">
        <section className="reading-passage-pane" onScroll={() => setSelectionMenu(null)}>
          <div className="reading-passage-meta">
            <span>{current.year} Text {current.textNo}</span>
            <span>{current.passageTitle}</span>
            <span>{current.paragraphs.join(' ').split(/\s+/).filter(Boolean).length} words</span>
            <div className="reading-passage-meta-ops">
              <span className="reading-hl-hint">选中文字可画线</span>
              {currentHighlights.length > 0 && (
                <button className="exam-ghost-btn reading-hl-clear" onClick={clearHighlights}>
                  <Eraser size={12} /> 清除划线
                </button>
              )}
            </div>
          </div>
          <article className="reading-passage" onMouseUp={handlePassageMouseUp}>
            {current.paragraphs.map((paragraph, i) => {
              const paraHighlights = currentHighlights.filter((h) => h.paraIndex === i)
              return (
                <p key={i} data-para-index={i}>
                  <span className="reading-para-no">[{i + 1}]</span>
                  <span className="reading-passage-text">
                    {splitHighlightSegments(paragraph, paraHighlights).map((segment, si) => (
                      segment.highlight ? (
                        <mark
                          key={segment.highlight.id}
                          className={`reading-hl reading-hl-${segment.highlight.color}`}
                          data-hl-id={segment.highlight.id}
                        >
                          {segment.text}
                        </mark>
                      ) : (
                        <Fragment key={`text-${si}`}>{segment.text}</Fragment>
                      )
                    ))}
                  </span>
                </p>
              )
            })}
          </article>
        </section>

        <section className="reading-question-pane">
          <div className="reading-question-nav">
            <span>{index + 1} / {questions.length}</span>
            <div>
              <button className="exam-ghost-btn" onClick={() => goTo(index - 1)} disabled={index === 0}>
                <ChevronLeft size={14} /> 上一题
              </button>
              <button className="exam-ghost-btn" onClick={() => goTo(index + 1)} disabled={index >= questions.length - 1}>
                下一题 <ChevronRight size={14} />
              </button>
            </div>
          </div>

          <div className="reading-question-card">
            <div className="reading-question-stem">
              <span className="reading-qno">{globalNo(current)}.</span>
              {current.stem}
            </div>
            <div className="reading-options">
              {current.options.map((option, i) => {
                const letter = 'ABCD'[i]
                const selected = answers[current.id] === letter
                return (
                  <button
                    key={letter}
                    className={`reading-option${selected ? ' selected' : ''}`}
                    onClick={() => void selectAnswer(letter)}
                  >
                    <span className="reading-option-letter">{letter}</span>
                    <span>{option}</span>
                  </button>
                )
              })}
            </div>
            <div className="reading-question-actions">
              <button
                className={`exam-ghost-btn${flags[current.id] ? ' reading-flag-active' : ''}`}
                onClick={() => void toggleFlag()}
              >
                <Flag size={13} /> {flags[current.id] ? '已标记存疑' : '标记存疑'}
              </button>
              <span className="reading-answer-hint">
                {answers[current.id] ? <><Check size={13} /> 已选 {answers[current.id]}</> : '未作答'}
              </span>
            </div>
          </div>

          <div className="reading-answer-card">
            <div className="reading-answer-card-title">答题卡 · 已答 {answeredCount}/{questions.length}</div>
            <div className="reading-answer-grid">
              {questions.map((q, i) => (
                <button
                  key={q.id}
                  className={`reading-answer-cell${i === index ? ' current' : ''}${answers[q.id] ? ' answered' : ''}${flags[q.id] ? ' flagged' : ''}`}
                  onClick={() => goTo(i)}
                  title={q.disputed ? '本题答案存在争议，复盘时可查看' : undefined}
                >
                  {globalNo(q)}
                </button>
              ))}
            </div>
            {isSet && passageQuestions.length > 0 && (
              <div className="reading-set-locate">
                本篇 {passageQuestions.length} 题 · 题号 {globalNo(passageQuestions[0])}–{globalNo(passageQuestions[passageQuestions.length - 1])}
              </div>
            )}
            <div className="reading-session-tip">
              答题卡可直接跳题；{session.limitSeconds > 0 ? '到时自动交卷，退出不暂停' : '精读模式不限时，交卷后进入复盘'}
              {wrongbookCount > 0 && <> · 当前错题本 {wrongbookCount} 条</>}
            </div>
          </div>
        </section>
      </div>

      {selectionMenu && (
        <div
          ref={highlightToolbarRef}
          className="reading-hl-toolbar"
          style={{ left: selectionMenu.x, top: selectionMenu.y }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <span className="reading-hl-toolbar-label">{selectionMenu.overlapping ? '调整' : '画线'}</span>
          {HIGHLIGHT_COLORS.map(({ color, label }) => (
            <button
              key={color}
              className={`reading-hl-color reading-hl-color-${color}`}
              title={label}
              aria-label={label}
              onClick={() => applyHighlight(color)}
            />
          ))}
          {selectionMenu.overlapping && (
            <button className="reading-hl-remove" onClick={removeHighlight} title="取消选中范围内的划线">
              <Eraser size={12} /> 取消
            </button>
          )}
        </div>
      )}
    </div>
  )
}
