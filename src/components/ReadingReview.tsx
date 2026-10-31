/**
 * 阅读复盘视图：逐题显示答案、定位、解析、干扰项与错因。
 */
import { useMemo, useState } from 'react'
import { ArrowLeft, Check, ChevronDown, Minus, RotateCw, X } from 'lucide-react'
import { updateReadingWrongReason } from '../lib/exam-reading-db'
import type {
  ReadingAttempt,
  ReadingQuestionWithPassage,
  ReadingSession as ReadingSessionRow,
  ReadingWrongItem,
} from '../lib/exam-reading-db'
import { useExamReadingStore } from '../stores/exam-reading-store'

interface Props {
  session: ReadingSessionRow
  questions: ReadingQuestionWithPassage[]
  attempts: ReadingAttempt[]
  wrongbook: ReadingWrongItem[]
  onBack: () => void
  onRedoWrong: (passageKey: string, questionIds: number[]) => void
}

const REASONS = [
  { value: '', label: '未标注' },
  { value: 'locate', label: '定位错误' },
  { value: 'vocab', label: '生词障碍' },
  { value: 'longsent', label: '长难句' },
  { value: 'option', label: '选项辨析' },
  { value: 'time', label: '时间不足' },
  { value: 'careless', label: '粗心' },
  { value: 'other', label: '其他' },
]

const QTYPE_LABEL: Record<string, string> = {
  detail: '细节题',
  infer: '推断题',
  main: '主旨题',
  vocab: '词义题',
  attitude: '态度题',
  example: '例证题',
  other: '其他',
}

function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function globalNo(q: ReadingQuestionWithPassage): number {
  return 20 + (q.textNo - 1) * 5 + q.seq
}

interface Group {
  passageKey: string
  title: string
  year: number
  textNo: number
  paragraphs: string[]
  questions: ReadingQuestionWithPassage[]
}

export function ReadingReview({ session, questions, attempts, wrongbook, onBack, onRedoWrong }: Props) {
  const [openPassages, setOpenPassages] = useState<Record<string, boolean>>({})
  const [notes, setNotes] = useState<Record<number, string>>(() => {
    const map: Record<number, string> = {}
    for (const item of wrongbook) map[item.questionId] = item.note
    return map
  })
  const attemptByQuestion = useMemo(
    () => new Map(attempts.map((a) => [a.questionId, a])),
    [attempts],
  )
  const wrongByQuestion = useMemo(
    () => new Map(wrongbook.map((w) => [w.questionId, w])),
    [wrongbook],
  )

  const groups = useMemo(() => {
    const map = new Map<string, Group>()
    for (const q of questions) {
      let group = map.get(q.passageKey)
      if (!group) {
        group = {
          passageKey: q.passageKey,
          title: `${q.year} Text ${q.textNo} · ${q.passageTitle}`,
          year: q.year,
          textNo: q.textNo,
          paragraphs: q.paragraphs,
          questions: [],
        }
        map.set(q.passageKey, group)
      }
      group.questions.push(q)
    }
    return [...map.values()]
  }, [questions])

  const wrongQuestions = questions.filter((q) => {
    const attempt = attemptByQuestion.get(q.id)
    return !attempt || !attempt.isCorrect
  })
  const scoreFull = session.mode === 'set' ? 40 : session.mode === 'timed' || session.mode === 'close' ? 10 : 0

  const setReason = async (questionId: number, reason: string) => {
    try {
      await updateReadingWrongReason(questionId, reason, notes[questionId] || '')
      useExamReadingStore.getState().markDirty()
      await useExamReadingStore.getState().refreshWrongbook()
    } catch {
      // 错因保存失败不阻塞复盘
    }
  }

  const setNote = async (questionId: number, note: string) => {
    setNotes((prev) => ({ ...prev, [questionId]: note }))
    const item = wrongByQuestion.get(questionId)
    if (!item) return
    try {
      await updateReadingWrongReason(questionId, item.reason, note)
      useExamReadingStore.getState().markDirty()
      await useExamReadingStore.getState().refreshWrongbook()
    } catch {
      // 备注保存失败不阻塞复盘
    }
  }

  return (
    <div className="reading-review">
      <header className="reading-review-head">
        <button className="exam-ghost-btn" onClick={onBack}>
          <ArrowLeft size={14} /> 返回
        </button>
        <div>
          <h3>{session.mode === 'set' ? '套卷复盘' : '阅读复盘'}</h3>
          <p>
            用时 {fmtDuration(session.elapsedMs)} · 答对 {session.correctCount}/{session.questionCount}
            {scoreFull > 0 && <> · {session.score}/{scoreFull} 分</>}
            {session.overtime && <span className="reading-overtime"> · 超时交卷</span>}
          </p>
        </div>
        <div className="reading-review-actions">
          {wrongQuestions.length > 0 && (
            <button
              className="exam-primary-btn"
              onClick={() => onRedoWrong('all', wrongQuestions.map((q) => q.id))}
            >
              <RotateCw size={14} /> 重做全部错题
            </button>
          )}
        </div>
      </header>

      {groups.map((group) => {
        const groupWrong = group.questions.filter((q) => wrongQuestions.some((w) => w.id === q.id))
        const open = !!openPassages[group.passageKey]
        return (
          <section className="reading-review-group" key={group.passageKey}>
            <div className="reading-review-group-head">
              <div>
                <b>{group.title}</b>
                <span>{group.questions.length} 题 · {group.paragraphs.length} 段</span>
              </div>
              <div className="reading-review-group-ops">
                <button className="exam-ghost-btn" onClick={() => setOpenPassages((prev) => ({ ...prev, [group.passageKey]: !open }))}>
                  {open ? '收起原文' : '查看原文'} <ChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : undefined }} />
                </button>
                {groupWrong.length > 0 && (
                  <button className="exam-ghost-btn" onClick={() => onRedoWrong(group.passageKey, groupWrong.map((q) => q.id))}>
                    <RotateCw size={13} /> 重做本篇错题
                  </button>
                )}
              </div>
            </div>

            {open && (
              <article className="reading-review-passage">
                {group.paragraphs.map((p, i) => (
                  <p key={i}><span className="reading-para-no">[{i + 1}]</span>{p}</p>
                ))}
              </article>
            )}

            {group.questions.map((q) => {
              const attempt = attemptByQuestion.get(q.id)
              const wrong = !attempt || !attempt.isCorrect
              const item = wrongByQuestion.get(q.id)
              const correctLetters = [q.answer, q.answerAlt].filter(Boolean).join(' / ')
              return (
                <div className={`reading-review-item${wrong ? ' wrong' : ' correct'}`} key={q.id}>
                  <div className="reading-review-item-head">
                    <span className="reading-review-result">
                      {!attempt || !attempt.userAnswer ? <Minus size={14} /> : wrong ? <X size={14} /> : <Check size={14} />}
                      {globalNo(q)}.
                    </span>
                    <span className="reading-review-type">{QTYPE_LABEL[q.qtype] || q.qtype}</span>
                    {q.disputed && <span className="reading-disputed-badge">答案存疑</span>}
                    <span className="reading-review-answers">
                      你的答案 <b>{attempt?.userAnswer || '未答'}</b>
                      <span className="reading-review-sep">·</span>
                      正确答案 <b>{correctLetters}</b>
                      {attempt && <><span className="reading-review-sep">·</span>{fmtDuration(attempt.durationMs)}</>}
                    </span>
                  </div>

                  <div className="reading-review-stem">{q.stem}</div>

                  <div className="reading-review-options">
                    {q.options.map((option, i) => {
                      const letter = 'ABCD'[i]
                      const isRight = letter === q.answer || (q.disputed && letter === q.answerAlt)
                      const isPicked = attempt?.userAnswer === letter
                      return (
                        <div key={letter} className={`reading-review-option${isRight ? ' right' : ''}${isPicked && !isRight ? ' picked-wrong' : ''}`}>
                          <span>{letter}</span>{option}
                          {isRight && <em>正确</em>}
                          {isPicked && !isRight && <em className="wrong-em">你的选择</em>}
                        </div>
                      )
                    })}
                  </div>

                  {q.locateHint && (
                    <div className="reading-review-block">
                      <b>定位</b>
                      <p>{q.locateHint}</p>
                    </div>
                  )}
                  {q.explanation && (
                    <div className="reading-review-block">
                      <b>解析</b>
                      <p>{q.explanation}</p>
                    </div>
                  )}
                  {q.distractors && (
                    <div className="reading-review-block">
                      <b>干扰项</b>
                      <p>{q.distractors}</p>
                    </div>
                  )}
                  {q.answerNote && (
                    <div className="reading-review-note">
                      <b>答案说明</b>
                      <p>{q.answerNote}</p>
                    </div>
                  )}

                  {wrong && (
                    <div className="reading-review-wrong-ops">
                      <label>
                        错因
                        <select
                          value={item?.reason || ''}
                          onChange={(e) => void setReason(q.id, e.target.value)}
                        >
                          {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                      </label>
                      <label className="reading-review-note-input">
                        备注
                        <input
                          value={notes[q.id] || ''}
                          onChange={(e) => setNotes((prev) => ({ ...prev, [q.id]: e.target.value }))}
                          onBlur={(e) => void setNote(q.id, e.target.value)}
                          placeholder="记录关键句/易错点"
                        />
                      </label>
                    </div>
                  )}
                </div>
              )
            })}
          </section>
        )
      })}
    </div>
  )
}
