/**
 * 完形作答视图：左侧挖空原文，右侧当前空的四个选项 + 20 空答题卡。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, Clock, Send } from 'lucide-react'
import { submitClozeSession, upsertClozeAttempt } from '../lib/exam-cloze-db'
import type {
  ClozeAttempt,
  ClozeQuestionWithPassage,
  ClozeSession as ClozeSessionRow,
} from '../lib/exam-cloze-db'
import { splitClozeText } from '../lib/cloze-text'

interface Props {
  session: ClozeSessionRow
  questions: ClozeQuestionWithPassage[]
  initialAttempts: ClozeAttempt[]
  onExit: () => void
  onSubmitted: (session: ClozeSessionRow) => void
}

const MODE_LABEL: Record<string, string> = {
  close: '精读',
  timed: '限时',
  wrong: '错题重做',
}

function fmtClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds))
  const m = Math.floor(safe / 60)
  const s = safe % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function ClozeSession({ session, questions, initialAttempts, onExit, onSubmitted }: Props) {
  const [answers, setAnswers] = useState<Record<number, string>>(() => {
    const map: Record<number, string> = {}
    for (const attempt of initialAttempts) {
      if (attempt.userAnswer) map[attempt.questionId] = attempt.userAnswer
    }
    return map
  })
  const [index, setIndex] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submittedRef = useRef(false)
  const questionStartRef = useRef(0)
  const durationsRef = useRef<Record<number, number>>(
    Object.fromEntries(initialAttempts.map((a) => [a.questionId, a.durationMs])),
  )
  const onSubmittedRef = useRef(onSubmitted)

  useEffect(() => {
    onSubmittedRef.current = onSubmitted
  }, [onSubmitted])

  useEffect(() => {
    questionStartRef.current = Date.now()
  }, [index])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [])

  const current = questions[Math.min(index, Math.max(0, questions.length - 1))]
  const totalCount = questions.length
  const fullScore = (totalCount * 0.5).toFixed(1)
  const answeredCount = questions.filter((q) => !!answers[q.id]).length
  const currentAnswer = current ? answers[current.id] || '' : ''
  const startedMs = new Date(session.startedAt).getTime()
  const elapsedSeconds = Math.max(0, Math.floor((now - startedMs) / 1000))
  const remainingSeconds = session.limitSeconds > 0
    ? Math.max(0, Math.ceil(((session.deadlineAt ? new Date(session.deadlineAt).getTime() : now) - now) / 1000))
    : 0
  const displaySeconds = session.limitSeconds > 0 ? remainingSeconds : elapsedSeconds
  const timerClass = session.limitSeconds > 0
    ? remainingSeconds <= 60 ? ' danger' : remainingSeconds <= 300 ? ' warn' : ''
    : ''

  const seqToIndex = useMemo(() => {
    const map = new Map<number, number>()
    questions.forEach((q, i) => {
      if (q.passageKey === current?.passageKey && !map.has(q.seq)) map.set(q.seq, i)
    })
    return map
  }, [current?.passageKey, questions])

  const finish = useCallback(async (auto = false) => {
    if (submittedRef.current) return
    if (!auto) {
      const unanswered = questions.length - answeredCount
      if (unanswered > 0 && !window.confirm(`还有 ${unanswered} 空未作答，确定交卷？`)) return
    }
    submittedRef.current = true
    setSubmitting(true)
    setError('')
    try {
      const updated = await submitClozeSession(session.id, auto)
      if (updated) {
        onSubmittedRef.current(updated)
      } else {
        submittedRef.current = false
        setSubmitting(false)
      }
    } catch (err) {
      submittedRef.current = false
      setSubmitting(false)
      setError(`交卷失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [answeredCount, questions.length, session.id])

  useEffect(() => {
    if (session.limitSeconds <= 0) return
    if (remainingSeconds > 0 || submittedRef.current) return
    void finish(true)
  }, [finish, remainingSeconds, session.limitSeconds])

  const selectAnswer = (letter: string) => {
    if (!current || submittedRef.current) return
    const delta = Math.min(5 * 60 * 1000, Math.max(0, Date.now() - (questionStartRef.current || Date.now())))
    durationsRef.current[current.id] = (durationsRef.current[current.id] || 0) + delta
    questionStartRef.current = Date.now()
    setAnswers((prev) => ({ ...prev, [current.id]: letter }))
    void upsertClozeAttempt({
      sessionId: session.id,
      questionId: current.id,
      userAnswer: letter,
      isCorrect: letter === current.answer,
      durationMs: durationsRef.current[current.id] || 0,
      flagged: false,
    }).catch((err) => setError(`作答保存失败：${err instanceof Error ? err.message : String(err)}`))

    if (index < questions.length - 1) setIndex((prev) => prev + 1)
  }

  const goTo = (next: number) => {
    if (next < 0 || next >= questions.length) return
    setIndex(next)
  }

  const handleExit = () => {
    if (window.confirm('退出后计时继续，可在题库页继续本次练习。确定退出？')) onExit()
  }

  const format = (value: string) => value.replace(/\{\{\d+\}\}/g, '____')

  if (!current) {
    return (
      <div className="reading-session">
        <div className="reading-empty">
          <b>题库不完整</b>
          <p>本次会话没有可作答的完形题目，请返回题库重新导入。</p>
        </div>
      </div>
    )
  }

  return (
    <div className="reading-session">
      <div className="reading-session-head">
        <button className="exam-ghost-btn" onClick={handleExit}>
          <ArrowLeft size={14} /> 返回
        </button>
        <div className="reading-session-title">
          <b>{current.year} 完形填空</b>
          <span>{MODE_LABEL[session.mode] || session.mode} · {totalCount} 空 · {fullScore} 分 · {answeredCount}/{totalCount} 已答</span>
        </div>
        <div className={`reading-timer${timerClass}`}>
          <Clock size={15} />
          {fmtClock(displaySeconds)}
          <small>{session.limitSeconds > 0 ? '剩余' : '已用'}</small>
        </div>
      </div>

      {error && (
        <div className="reading-message">
          <span>{error}</span>
        </div>
      )}

      <div className="reading-session-body">
        <section className="reading-passage-pane">
          <div className="reading-passage-meta">
            <span>{current.year} · {current.passageTitle}</span>
            <span>完形填空</span>
            <span>20 空</span>
          </div>
          <article className="reading-passage cloze-passage">
            {current.paragraphs.map((paragraph, pi) => (
              <p key={pi}>
                {splitClozeText(paragraph).map((part, ti) => {
                  if (!part.seq) return <span key={`t-${ti}`}>{part.text}</span>
                  const qIndex = seqToIndex.get(part.seq)
                  const question = qIndex === undefined ? undefined : questions[qIndex]
                  if (!question) {
                    return (
                      <span key={`b-${part.seq}`} className="cloze-blank inactive" title={`第 ${part.seq} 空（本次未选）`}>
                        {part.seq}
                      </span>
                    )
                  }
                  const picked = answers[question.id] || ''
                  return (
                    <button
                      key={`b-${part.seq}`}
                      type="button"
                      className={`cloze-blank${picked ? ' answered' : ''}${question.id === current.id ? ' current' : ''}`}
                      onClick={() => { if (qIndex !== undefined) goTo(qIndex) }}
                      title={picked ? `第 ${part.seq} 空：${picked}` : `第 ${part.seq} 空`}
                    >
                      {picked || part.seq}
                    </button>
                  )
                })}
              </p>
            ))}
          </article>
        </section>

        <section className="reading-question-pane cloze-question-pane">
          <div className="reading-question-nav">
            <span>第 {current.seq} 空 · 本次 {index + 1}/{totalCount}</span>
            <div>
              <button className="exam-ghost-btn" onClick={() => goTo(index - 1)} disabled={index <= 0}>
                <ChevronLeft size={13} /> 上一空
              </button>
              <button className="exam-ghost-btn" onClick={() => goTo(index + 1)} disabled={index >= questions.length - 1}>
                下一空 <ChevronRight size={13} />
              </button>
            </div>
          </div>

          <div className="cloze-current">
            <span className="cloze-current-no">第 {current.seq} 空</span>
            <p>{format(current.context)}</p>
          </div>

          <div className="reading-options cloze-options">
            {current.options.map((option, i) => {
              const letter = 'ABCD'[i]
              return (
                <button
                  key={letter}
                  type="button"
                  className={`reading-option${currentAnswer === letter ? ' selected' : ''}`}
                  onClick={() => selectAnswer(letter)}
                >
                  <span className="reading-option-letter">{letter}</span>
                  {option}
                </button>
              )
            })}
          </div>

          <div className="reading-answer-card">
            <div className="reading-answer-card-title">答题卡 · {answeredCount}/{totalCount}</div>
            <div className="reading-answer-grid">
              {questions.map((q, i) => (
                <button
                  key={q.id}
                  className={`reading-answer-cell${answers[q.id] ? ' answered' : ''}${i === index ? ' current' : ''}`}
                  onClick={() => goTo(i)}
                  title={`第 ${q.seq} 空${answers[q.id] ? `：${answers[q.id]}` : ''}`}
                >
                  {q.seq}
                </button>
              ))}
            </div>
          </div>

          <button className="exam-primary-btn cloze-submit" onClick={() => void finish(false)} disabled={submitting}>
            <Send size={14} /> {submitting ? '正在交卷…' : '交卷'}
          </button>
          <p className="reading-session-tip">
            完形建议 10–15 分钟完成；先通读全文，再逐空作答。退出后计时继续，可在题库页继续本次练习。
          </p>
        </section>
      </div>
    </div>
  )
}
