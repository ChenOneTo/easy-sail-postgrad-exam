/**
 * 完形复盘：左侧把正确答案回填后的原文，右侧单空选项/解析；
 * 「错题 / 题目」切换，题号格 + 上一空/下一空。
 */
import { useMemo, useState } from 'react'
import {
  ArrowLeft, Check, ChevronLeft, ChevronRight, Minus, RotateCw, X,
} from 'lucide-react'
import { splitClozeText } from '../lib/cloze-text'
import { updateClozeWrongReason } from '../lib/exam-cloze-db'
import type {
  ClozeAttempt,
  ClozeQuestion,
  ClozeQuestionWithPassage,
  ClozeSession as ClozeSessionRow,
  ClozeWrongItem,
} from '../lib/exam-cloze-db'
import { useExamClozeStore } from '../stores/exam-cloze-store'

interface Props {
  session: ClozeSessionRow
  questions: ClozeQuestionWithPassage[]
  attempts: ClozeAttempt[]
  wrongbook: ClozeWrongItem[]
  /** 题库全量空位，用于把复盘原文的其余空也回填出来 */
  bankByPassage: Map<string, ClozeQuestion[]>
  onBack: () => void
  onRedoWrong: (passageKey: string, questionIds: number[]) => void
}

const REASONS = [
  { value: '', label: '未标注' },
  { value: 'vocab', label: '词义不明' },
  { value: 'logic', label: '逻辑关系' },
  { value: 'collocation', label: '固定搭配' },
  { value: 'grammar', label: '语法结构' },
  { value: 'context', label: '上下文理解' },
  { value: 'careless', label: '粗心' },
  { value: 'time', label: '时间不足' },
  { value: 'other', label: '其他' },
]

function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function fmtSessionTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function fmtContext(value: string): string {
  return value.replace(/\{\{\d+\}\}/g, '____')
}

export function ClozeReview({ session, questions, attempts, wrongbook, bankByPassage, onBack, onRedoWrong }: Props) {
  const [notes, setNotes] = useState<Record<number, string>>(() => {
    const map: Record<number, string> = {}
    for (const item of wrongbook) map[item.questionId] = item.note || ''
    return map
  })
  const attemptByQuestion = useMemo(() => new Map(attempts.map((a) => [a.questionId, a])), [attempts])
  const wrongByQuestion = useMemo(() => new Map(wrongbook.map((w) => [w.questionId, w])), [wrongbook])
  const questionByPassageSeq = useMemo(
    () => new Map(questions.map((q) => [`${q.passageKey}:${q.seq}`, q])),
    [questions],
  )
  const wrongQuestions = useMemo(
    () => questions.filter((q) => {
      const attempt = attemptByQuestion.get(q.id)
      return !attempt || !attempt.isCorrect
    }),
    [attemptByQuestion, questions],
  )

  const [reviewFilter, setReviewFilter] = useState<'wrong' | 'all'>(() => (
    wrongQuestions.length > 0 ? 'wrong' : 'all'
  ))
  const [selectedId, setSelectedId] = useState<number | null>(() => (
    wrongQuestions[0]?.id ?? questions[0]?.id ?? null
  ))

  const visibleQuestions = reviewFilter === 'wrong' ? wrongQuestions : questions
  const selected = visibleQuestions.find((q) => q.id === selectedId) ?? visibleQuestions[0]
  const selectedIndex = selected ? visibleQuestions.findIndex((q) => q.id === selected.id) : -1
  const selectedAttempt = selected ? attemptByQuestion.get(selected.id) : undefined
  const selectedWrong = !selectedAttempt || !selectedAttempt.isCorrect
  const selectedItem = selected ? wrongByQuestion.get(selected.id) : undefined
  const selectedParagraphs = selected?.paragraphs || []
  const selectedGroupWrong = selected
    ? wrongQuestions.filter((q) => q.passageKey === selected.passageKey)
    : []

  const changeFilter = (next: 'wrong' | 'all') => {
    const list = next === 'wrong' ? wrongQuestions : questions
    setReviewFilter(next)
    setSelectedId(list[0]?.id ?? null)
  }

  const step = (delta: number) => {
    if (selectedIndex < 0) return
    const next = visibleQuestions[selectedIndex + delta]
    if (next) setSelectedId(next.id)
  }

  const setReason = async (questionId: number, reason: string) => {
    const item = wrongByQuestion.get(questionId)
    await updateClozeWrongReason(questionId, reason, item?.note || notes[questionId] || '')
    useExamClozeStore.getState().markDirty()
    await useExamClozeStore.getState().refreshWrongbook()
  }

  const setNote = async (questionId: number, note: string) => {
    const item = wrongByQuestion.get(questionId)
    await updateClozeWrongReason(questionId, item?.reason || '', note)
    useExamClozeStore.getState().markDirty()
    await useExamClozeStore.getState().refreshWrongbook()
  }

  const fullScore = (questions.length * 0.5).toFixed(1)

  return (
    <div className="reading-review">
      <div className="reading-review-head">
        <button className="exam-ghost-btn" onClick={onBack}>
          <ArrowLeft size={14} /> 返回
        </button>
        <div>
          <h3>{selected?.year || ''} 完形填空复盘</h3>
          <p>
            {session.correctCount}/{questions.length} 空 · {session.score.toFixed(1)}/{fullScore} 分
            <span className="reading-review-sep">·</span>
            用时 {fmtSessionTime(session.elapsedMs)}
            {session.overtime ? ' · 超时' : ''}
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
      </div>

      <div className="reading-review-split">
        {selected ? (
          <section className="reading-review-passage-pane" key={selected.passageKey}>
            <div className="reading-review-pane-head">
              <div>
                <b>{selected.year} 完形填空</b>
                <span>{selectedGroupWrong.length} 个错题</span>
              </div>
              {selectedGroupWrong.length > 0 && (
                <button
                  className="exam-ghost-btn"
                  onClick={() => onRedoWrong(selected.passageKey, selectedGroupWrong.map((q) => q.id))}
                >
                  <RotateCw size={13} /> 重做本篇错题
                </button>
              )}
            </div>
            <article className="reading-review-passage cloze-review-passage">
              {selectedParagraphs.map((paragraph, pi) => (
                <p key={pi}>
                  {splitClozeText(paragraph).map((part, ti) => {
                    if (!part.seq) return <span key={`t-${ti}`}>{part.text}</span>
                    const sessionQuestion = questionByPassageSeq.get(`${selected.passageKey}:${part.seq}`)
                    const bankQuestion = sessionQuestion
                      || bankByPassage.get(selected.passageKey)?.find((item) => item.seq === part.seq)
                    if (!bankQuestion) return <span key={`b-${part.seq}`}>____</span>
                    const attempt = sessionQuestion ? attemptByQuestion.get(sessionQuestion.id) : undefined
                    const correct = sessionQuestion ? !!attempt?.isCorrect : undefined
                    const fillWord = bankQuestion.answerWord
                      || bankQuestion.options['ABCD'.indexOf(bankQuestion.answer)]
                      || '____'
                    return (
                      <span
                        key={`b-${part.seq}`}
                        className={`cloze-review-fill ${correct === undefined ? 'neutral' : correct ? 'correct' : 'wrong'}`}
                      >
                        {fillWord}
                        {sessionQuestion && !correct && (
                          <small>{attempt?.userAnswer ? `你选 ${attempt.userAnswer}` : '未答'}</small>
                        )}
                      </span>
                    )
                  })}
                </p>
              ))}
            </article>
          </section>
        ) : (
          <section className="reading-review-passage-pane">
            <div className="reading-empty">
              <b>没有原文</b>
              <p>本次会话没有可显示的完形原文。</p>
            </div>
          </section>
        )}

        <section className="reading-review-question-pane" key={selected?.id ?? 'empty'}>
          <div className="reading-review-pane-head">
            <div>
              <b>{reviewFilter === 'wrong' ? '错题' : '全部题目'}</b>
              <span>{visibleQuestions.length} 空</span>
            </div>
            <div className="reading-review-stepper">
              <button className="exam-ghost-btn" onClick={() => step(-1)} disabled={selectedIndex <= 0} title="上一空">
                <ChevronLeft size={13} />
              </button>
              <span>{selectedIndex >= 0 ? selectedIndex + 1 : 0} / {visibleQuestions.length}</span>
              <button
                className="exam-ghost-btn"
                onClick={() => step(1)}
                disabled={selectedIndex < 0 || selectedIndex >= visibleQuestions.length - 1}
                title="下一空"
              >
                <ChevronRight size={13} />
              </button>
            </div>
          </div>

          <div className="reading-review-filter">
            <button
              className={reviewFilter === 'wrong' ? 'active' : ''}
              onClick={() => changeFilter('wrong')}
              disabled={wrongQuestions.length === 0}
            >
              错题 <b>{wrongQuestions.length}</b>
            </button>
            <button
              className={reviewFilter === 'all' ? 'active' : ''}
              onClick={() => changeFilter('all')}
            >
              题目 <b>{questions.length}</b>
            </button>
            <span className="reading-review-filter-hint">
              {reviewFilter === 'wrong' ? '只显示答错/未答' : '显示全部空'}
            </span>
          </div>

          <div className="reading-review-qgrid">
            {visibleQuestions.map((q) => {
              const attempt = attemptByQuestion.get(q.id)
              const qWrong = !attempt || !attempt.isCorrect
              return (
                <button
                  key={q.id}
                  className={`reading-review-qbtn${q.id === selected?.id ? ' active' : ''}${qWrong ? ' wrong' : ''}`}
                  onClick={() => setSelectedId(q.id)}
                  title={`第 ${q.seq} 空`}
                >
                  {q.seq}
                </button>
              )
            })}
          </div>

          {selected ? (
            <div className={`reading-review-item${selectedWrong ? ' wrong' : ' correct'}`}>
              <div className="reading-review-item-head">
                <span className="reading-review-result">
                  {!selectedAttempt || !selectedAttempt.userAnswer
                    ? <Minus size={14} />
                    : selectedWrong ? <X size={14} /> : <Check size={14} />}
                  第 {selected.seq} 空
                </span>
                <span className="reading-review-type">{selected.qtype || '完形'}</span>
                <span className="reading-review-answers">
                  你的答案 <b>{selectedAttempt?.userAnswer || '未答'}</b>
                  <span className="reading-review-sep">·</span>
                  正确答案 <b>{selected.answer}</b>
                  {selectedAttempt && <><span className="reading-review-sep">·</span>{fmtDuration(selectedAttempt.durationMs)}</>}
                </span>
              </div>

              {selectedWrong && (
                <div className="reading-review-question-actions">
                  <button className="exam-ghost-btn" onClick={() => onRedoWrong(selected.passageKey, [selected.id])}>
                    <RotateCw size={12} /> 重做本空
                  </button>
                </div>
              )}

              <div className="cloze-review-context">{fmtContext(selected.context)}</div>

              <div className="reading-review-options">
                {selected.options.map((option, i) => {
                  const letter = 'ABCD'[i]
                  const isRight = letter === selected.answer
                  const isPicked = selectedAttempt?.userAnswer === letter
                  return (
                    <div
                      key={letter}
                      className={`reading-review-option${isRight ? ' right' : ''}${isPicked && !isRight ? ' picked-wrong' : ''}`}
                    >
                      <span>{letter}</span>{option}
                      {isRight && <em>正确</em>}
                      {isPicked && !isRight && <em className="wrong-em">你的选择</em>}
                    </div>
                  )
                })}
              </div>

              {selected.answerWord && (
                <div className="cloze-review-answer-word">
                  <b>正确词</b>
                  <span>{selected.answerWord}</span>
                </div>
              )}

              {selected.explanation && (
                <div className="reading-review-block">
                  <b>解析</b>
                  <p>{selected.explanation}</p>
                </div>
              )}

              {selectedWrong && (
                <div className="reading-review-wrong-ops">
                  <label>
                    错因
                    <select value={selectedItem?.reason || ''} onChange={(e) => void setReason(selected.id, e.target.value)}>
                      {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </label>
                  <label className="reading-review-note-input">
                    备注
                    <input
                      value={notes[selected.id] || ''}
                      onChange={(e) => setNotes((prev) => ({ ...prev, [selected.id]: e.target.value }))}
                      onBlur={(e) => void setNote(selected.id, e.target.value)}
                      placeholder="记录搭配/逻辑线索"
                    />
                  </label>
                </div>
              )}
            </div>
          ) : (
            <div className="reading-empty">
              <b>{reviewFilter === 'wrong' ? '本次没有错题' : '没有题目'}</b>
              <p>{reviewFilter === 'wrong' ? '切换到「题目」查看全部作答。' : '本次会话没有可复盘的题目。'}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
