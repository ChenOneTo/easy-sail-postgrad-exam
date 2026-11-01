/**
 * 199 管综作答 / 复盘视图。
 *
 * 计时用墙钟 deadline，不用 tick 累减；退出或休眠后回到前台按真实时间重算。
 * 每次选择立即写 attempt，崩溃后可从 ongoing session 恢复。
 * 「精练」模式选完即时判分并展开解析；限时 / 套卷交卷后统一进复盘。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, Check, ChevronLeft, ChevronRight, Clock, Flag, RotateCw, Send, X,
} from 'lucide-react'
import {
  submitMgmtSession,
  subjectRule,
  upsertMgmtAttempt,
} from '../lib/exam-mgmt-db'
import type { MgmtAttempt, MgmtQuestion, MgmtSession as MgmtSessionRow } from '../lib/exam-mgmt-db'
import { useExamMgmtStore } from '../stores/exam-mgmt-store'

interface Props {
  session: MgmtSessionRow
  questions: MgmtQuestion[]
  initialAttempts: MgmtAttempt[]
  onExit: () => void
  onSubmitted: (session: MgmtSessionRow) => void
  onRedoWrong: (questionIds: number[]) => void
}

const MODE_LABEL: Record<string, string> = {
  drill: '精练',
  timed: '限时',
  set: '整套',
  wrong: '错题重做',
}

function fmtClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 60000))
  return total < 60 ? `${total} 分` : `${Math.floor(total / 60)} 时 ${total % 60} 分`
}

function isCorrectAnswer(q: MgmtQuestion, letter: string): boolean {
  return letter === q.answer || (q.disputed && !!q.answerAlt && letter === q.answerAlt)
}

export function MgmtSession({
  session, questions, initialAttempts, onExit, onSubmitted, onRedoWrong,
}: Props) {
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
  const [revealed, setRevealed] = useState<Record<number, boolean>>(() => {
    const map: Record<number, boolean> = {}
    for (const attempt of initialAttempts) {
      if (attempt.userAnswer) map[attempt.questionId] = true
    }
    return map
  })
  const [index, setIndex] = useState(0)
  // 传入已交卷会话时直接进复盘（历史复盘入口）
  const [review, setReview] = useState(session.status === 'submitted')
  const [submitted, setSubmitted] = useState<MgmtSessionRow | null>(
    session.status === 'submitted' ? session : null,
  )
  const [remainingMs, setRemainingMs] = useState(() =>
    session.deadlineAt ? Math.max(0, new Date(session.deadlineAt).getTime() - Date.now()) : 0,
  )
  const [elapsedMs, setElapsedMs] = useState(
    () => Math.max(0, Date.now() - new Date(session.startedAt).getTime()),
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submittedRef = useRef(session.status === 'submitted')
  const questionStartRef = useRef(0)
  const durationsRef = useRef<Record<number, number>>({})
  const onSubmittedRef = useRef(onSubmitted)

  useEffect(() => {
    onSubmittedRef.current = onSubmitted
  }, [onSubmitted])

  useEffect(() => {
    questionStartRef.current = Date.now()
  }, [index])

  const current = questions[Math.min(index, Math.max(0, questions.length - 1))]
  const answeredCount = questions.filter((q) => !!answers[q.id]).length
  const wrongIds = useMemo(
    () => questions.filter((q) => {
      const picked = answers[q.id]
      return !picked || !isCorrectAnswer(q, picked)
    }).map((q) => q.id),
    [answers, questions],
  )
  const instantFeedback = session.mode === 'drill' || session.mode === 'wrong'

  const handleSubmit = useCallback(
    async (auto: boolean) => {
      if (submittedRef.current) return
      submittedRef.current = true
      setSubmitting(true)
      setError('')
      try {
        const done = await submitMgmtSession(session.id, auto)
        if (done) {
          setSubmitted(done)
          setReview(true)
          useExamMgmtStore.getState().markDirty()
          onSubmittedRef.current(done)
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

  // 墙钟计时：后台节流 / 休眠后回到前台立即重算
  useEffect(() => {
    if (review) return
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
  }, [review, session.deadlineAt, session.limitSeconds, session.startedAt, handleSubmit])

  const goTo = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(questions.length - 1, next))
      if (clamped === index) return
      setIndex(clamped)
      questionStartRef.current = Date.now()
    },
    [index, questions.length],
  )

  const selectAnswer = useCallback(
    async (letter: string) => {
      if (!current || review) return
      if (answers[current.id] === letter) return
      const startedAt = questionStartRef.current || Date.now()
      const delta = Math.min(5 * 60 * 1000, Math.max(0, Date.now() - startedAt))
      durationsRef.current[current.id] = (durationsRef.current[current.id] || 0) + delta
      questionStartRef.current = Date.now()
      const nextAnswers = { ...answers, [current.id]: letter }
      setAnswers(nextAnswers)
      if (instantFeedback) setRevealed((prev) => ({ ...prev, [current.id]: true }))
      try {
        await upsertMgmtAttempt({
          sessionId: session.id,
          questionId: current.id,
          userAnswer: letter,
          isCorrect: isCorrectAnswer(current, letter),
          durationMs: durationsRef.current[current.id],
          flagged: !!flags[current.id],
        })
        useExamMgmtStore.getState().markDirty()
      } catch (err) {
        setError(`保存作答失败：${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [answers, current, flags, instantFeedback, review, session.id],
  )

  const toggleFlag = useCallback(async () => {
    if (!current) return
    const next = !flags[current.id]
    setFlags((prev) => ({ ...prev, [current.id]: next }))
    try {
      await upsertMgmtAttempt({
        sessionId: session.id,
        questionId: current.id,
        userAnswer: answers[current.id] || '',
        isCorrect: answers[current.id] ? isCorrectAnswer(current, answers[current.id]) : false,
        durationMs: durationsRef.current[current.id] || 0,
        flagged: next,
      })
      useExamMgmtStore.getState().markDirty()
    } catch (err) {
      setError(`保存标记失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [answers, current, flags, session.id])

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
      } else if (['1', '2', '3', '4', '5'].includes(e.key) && current) {
        e.preventDefault()
        void selectAnswer('ABCDE'[Number(e.key) - 1])
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
    if (review) {
      onExit()
      return
    }
    if (window.confirm('离开后计时继续，确定退出？')) onExit()
  }

  const timeMs = session.limitSeconds > 0 ? remainingMs : elapsedMs
  const timerTone = session.limitSeconds > 0
    ? remainingMs <= 60_000 ? ' danger' : remainingMs <= 300_000 ? ' warn' : ''
    : ''

  // ========== 复盘 ==========
  if (review && submitted) {
    const correctCount = submitted.correctCount
    const accuracy = submitted.questionCount ? Math.round((correctCount / submitted.questionCount) * 100) : 0
    return (
      <div className="mgmt-review">
        <header className="mgmt-review-head">
          <button className="exam-ghost-btn" onClick={handleExit}>
            <ArrowLeft size={14} /> 返回
          </button>
          <div className="reading-session-title">
            <b>
              {subjectRule(session.subject).label} ·{' '}
              {session.mode === 'set' ? `${session.scope} 年整套` : MODE_LABEL[session.mode]} · 复盘
            </b>
            <span>
              得分 {submitted.score}/{submitted.fullScore} · 正确 {correctCount}/{submitted.questionCount}
              {' '}· 正确率 {accuracy}% · 用时 {fmtDuration(submitted.elapsedMs)}
              {submitted.overtime && ' · 超时'}
            </span>
          </div>
          <div className="mgmt-review-ops">
            {wrongIds.length > 0 && (
              <button className="exam-primary-btn" onClick={() => onRedoWrong(wrongIds)}>
                <RotateCw size={14} /> 重做这 {wrongIds.length} 道错题
              </button>
            )}
            <button className="exam-ghost-btn" onClick={onExit}>回到刷题台</button>
          </div>
        </header>

        <div className="mgmt-review-list">
          {questions.map((q) => {
            const picked = answers[q.id] || ''
            const ok = picked !== '' && isCorrectAnswer(q, picked)
            return (
              <article className={`mgmt-review-card${ok ? ' ok' : ' bad'}`} key={q.id}>
                <div className="mgmt-review-card-head">
                  <b>{q.qno}.</b>
                  <span className={`mgmt-verdict ${ok ? 'ok' : 'bad'}`}>
                    {ok ? <><Check size={12} /> 正确</> : <><X size={12} /> {picked ? '答错' : '未作答'}</>}
                  </span>
                  <span className="mgmt-q-meta">
                    {q.year} 年 · {q.topic || '未分类'}{q.knowledge ? ` · ${q.knowledge}` : ''}
                  </span>
                  {q.disputed && <span className="reading-disputed-badge">存疑</span>}
                  {q.hasFigure && <span className="mgmt-figure-tag">原卷含图</span>}
                </div>
                <p className="mgmt-review-stem">{q.stem}</p>
                <div className="mgmt-review-options">
                  {q.options.map((text, i) => {
                    const letter = 'ABCDE'[i]
                    const cls = letter === q.answer
                      ? ' answer'
                      : letter === picked ? ' picked' : ''
                    return (
                      <div className={`mgmt-review-option${cls}`} key={letter}>
                        <span className="mgmt-opt-letter">{letter}</span>
                        <span>{text}</span>
                      </div>
                    )
                  })}
                </div>
                <div className="mgmt-review-answer-line">
                  你选 <b>{picked || '—'}</b> · 正确答案 <b>{q.answer}{q.answerAlt ? ` / ${q.answerAlt}` : ''}</b>
                </div>
                {q.explanation && (
                  <details className="mgmt-review-expl" open={!ok}>
                    <summary>看解析</summary>
                    <p>{q.explanation}</p>
                  </details>
                )}
              </article>
            )
          })}
        </div>
      </div>
    )
  }

  if (!current) {
    return (
      <div className="reading-session">
        <p className="placeholder-text">会话题目为空。</p>
        <button className="exam-ghost-btn" onClick={onExit}>返回</button>
      </div>
    )
  }

  const shown = instantFeedback && revealed[current.id]
  const picked = answers[current.id] || ''
  const showAnalysis = shown && picked !== ''

  return (
    <div className="reading-session mgmt-session">
      <header className="reading-session-head">
        <button className="exam-ghost-btn" onClick={handleExit}>
          <ArrowLeft size={14} /> 退出
        </button>
        <div className="reading-session-title">
          <b>
            {subjectRule(session.subject).label}
            {session.mode === 'set' ? ` · ${session.scope} 年整套` : ` · ${MODE_LABEL[session.mode]}`}
          </b>
          <span>
            {questions.length} 题 · 满分 {session.fullScore} · 单题 {subjectRule(session.subject).pointsPerQuestion} 分
            {session.limitSeconds > 0 && ` · 限时 ${Math.round(session.limitSeconds / 60)} 分钟`}
          </span>
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

      <div className="mgmt-session-body">
        <section className="mgmt-question-pane">
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

          <div className="reading-question-card mgmt-question-card">
            <div className="mgmt-question-meta">
              <span className="mgmt-qno">{current.qno}</span>
              <span>{current.year} 年</span>
              {current.topic && <span>{current.topic}</span>}
              {current.knowledge && <span>{current.knowledge}</span>}
              {current.qtype === 'csd' && <span className="mgmt-csd-tag">条件充分性判断</span>}
              {current.hasFigure && <span className="mgmt-figure-tag">原卷含图</span>}
            </div>
            <div className="reading-question-stem">{current.stem}</div>
            <div className="reading-options">
              {current.options.map((text, i) => {
                const letter = 'ABCDE'[i]
                const selected = picked === letter
                const verdict = showAnalysis
                  ? letter === current.answer ? ' correct' : selected ? ' wrong' : ''
                  : ''
                return (
                  <button
                    key={letter}
                    className={`reading-option${selected ? ' selected' : ''}${verdict}`}
                    onClick={() => void selectAnswer(letter)}
                    disabled={showAnalysis}
                  >
                    <span className="reading-option-letter">{letter}</span>
                    <span>{text}</span>
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
                {picked ? <><Check size={13} /> 已选 {picked}</> : '未作答'}
              </span>
              {current.qtype === 'csd' && (
                <span className="mgmt-csd-hint">A 条件(1)充分 / B 条件(2)充分 / C 联合充分 / D 各自充分 / E 都不充分</span>
              )}
            </div>

            {showAnalysis && (
              <div className={`mgmt-inline-verdict ${picked && isCorrectAnswer(current, picked) ? 'ok' : 'bad'}`}>
                <b>{picked && isCorrectAnswer(current, picked) ? '答对了' : `答错了，正确答案是 ${current.answer}`}</b>
                {current.explanation && <p>{current.explanation}</p>}
              </div>
            )}
          </div>
        </section>

        <section className="mgmt-side-pane">
          <div className="reading-answer-card">
            <div className="reading-answer-card-title">答题卡 · 已答 {answeredCount}/{questions.length}</div>
            <div className="reading-answer-grid">
              {questions.map((q, i) => (
                <button
                  key={q.id}
                  className={`reading-answer-cell${i === index ? ' current' : ''}${answers[q.id] ? ' answered' : ''}${flags[q.id] ? ' flagged' : ''}`}
                  onClick={() => goTo(i)}
                >
                  {q.qno}
                </button>
              ))}
            </div>
            <div className="reading-session-tip">
              {instantFeedback
                ? '精练模式选完即判分并显示解析，不计时；交卷后计入统计与错题本。'
                : session.limitSeconds > 0
                  ? '到时自动交卷，退出不暂停；交卷后统一进复盘。'
                  : '不限时，交卷后进入复盘。'}
              {' '}键盘 1–5 作答，← → 切题，⌘/Ctrl+Enter 交卷。
            </div>
          </div>
          <div className="mgmt-pace-card">
            <b>考场节奏参考</b>
            <p>
              {session.subject === 'math'
                ? '数学 25 题 / 60 分钟，平均每题 2 分 24 秒。问题求解 15 题控制在 36 分钟内，条件充分性判断 10 题 24 分钟。'
                : '逻辑 30 题 / 55 分钟，平均每题 1 分 50 秒。30 题分 6 组，每组 5 题约 9 分钟，组题不要恋战。'}
            </p>
            <p>
              剩余 {questions.length - answeredCount} 题，
              {session.limitSeconds > 0
                ? ` 剩余时间 ${fmtClock(remainingMs)}，平均每题 ${answeredCount < questions.length ? fmtClock(remainingMs / Math.max(1, questions.length - answeredCount)) : '00:00'}。`
                : ' 不限时也建议按考场节奏控制单题用时。'}
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
