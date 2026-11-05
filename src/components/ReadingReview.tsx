/**
 * 阅读复盘视图：逐题显示答案、定位、解析、干扰项与错因。
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import {
  ArrowLeft, Check, ChevronLeft, ChevronRight, Loader2, Minus, RotateCw, Sparkles, X,
} from 'lucide-react'
import { canUseAi } from '../lib/ai'
import type { AiReadingExplainDraft, AiReadingWordDraft } from '../lib/ai-json'
import { updateReadingWrongReason } from '../lib/exam-reading-db'
import type {
  ReadingAttempt,
  ReadingQuestionWithPassage,
  ReadingSession as ReadingSessionRow,
  ReadingWrongItem,
} from '../lib/exam-reading-db'
import { useAiTask } from '../hooks/useAiTask'
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

interface AiMenuState {
  x: number
  y: number
  word: string
  sentence: string
  title: string
  ready: boolean
}

interface AiWordState extends Omit<AiMenuState, 'ready'> {
  draft: AiReadingWordDraft | null
}

/** 去掉选中文本两端标点、压缩空白；只处理英文原文 */
function cleanSelection(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '')
}

/** 取包含目标词的句子；找不到时退化为段落开头 */
function sentenceAround(text: string, word: string): string {
  const idx = text.toLowerCase().indexOf(word.toLowerCase())
  if (idx < 0) return text.slice(0, 400)
  let start = idx
  while (start > 0 && !'.!?'.includes(text[start - 1])) start--
  let end = idx + word.length
  while (end < text.length && !'.!?'.includes(text[end])) end++
  if (end < text.length) end++
  return text.slice(start, end).trim().slice(0, 500)
}

interface Group {
  passageKey: string
  title: string
  year: number
  textNo: number
  paragraphs: string[]
}

export function ReadingReview({ session, questions, attempts, wrongbook, onBack, onRedoWrong }: Props) {
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

  const groupByPassage = useMemo(() => {
    const map = new Map<string, Group>()
    for (const q of questions) {
      if (map.has(q.passageKey)) continue
      map.set(q.passageKey, {
        passageKey: q.passageKey,
        title: `${q.year} Text ${q.textNo} · ${q.passageTitle}`,
        year: q.year,
        textNo: q.textNo,
        paragraphs: q.paragraphs,
      })
    }
    return map
  }, [questions])

  const wrongQuestions = questions.filter((q) => {
    const attempt = attemptByQuestion.get(q.id)
    return !attempt || !attempt.isCorrect
  })
  const scoreFull = session.mode === 'set' ? 40 : session.mode === 'timed' || session.mode === 'close' ? 10 : 0

  const { translateReadingWord, loading: aiLoading, error: aiError, abort } = useAiTask()
  const [aiMenu, setAiMenu] = useState<AiMenuState | null>(null)
  const [aiWord, setAiWord] = useState<AiWordState | null>(null)
  const lastSelectionRef = useRef<{ word: string; sentence: string; passageKey: string; at: number } | null>(null)
  // 题目讲解另用一个 useAiTask 实例：与选词翻译各自维护 loading/error，互不打断
  const explainAi = useAiTask()
  const [explainOpenId, setExplainOpenId] = useState<number | null>(null)
  const [explainPendingId, setExplainPendingId] = useState<number | null>(null)
  const [explainCache, setExplainCache] = useState<Record<number, AiReadingExplainDraft>>({})
  const [reviewFilter, setReviewFilter] = useState<'wrong' | 'all'>(() => (
    wrongQuestions.length > 0 ? 'wrong' : 'all'
  ))
  const [selectedId, setSelectedId] = useState<number | null>(() => (
    wrongQuestions[0]?.id ?? questions[0]?.id ?? null
  ))

  const visibleQuestions = reviewFilter === 'wrong' ? wrongQuestions : questions
  const selected = visibleQuestions.find((q) => q.id === selectedId) ?? visibleQuestions[0]
  const selectedIndex = selected ? visibleQuestions.findIndex((q) => q.id === selected.id) : -1
  const selectedGroup = selected ? groupByPassage.get(selected.passageKey) : undefined
  const selectedGroupWrong = selectedGroup
    ? wrongQuestions.filter((q) => q.passageKey === selectedGroup.passageKey)
    : []
  const selectedAttempt = selected ? attemptByQuestion.get(selected.id) : undefined
  const selectedWrong = !selectedAttempt || !selectedAttempt.isCorrect
  const selectedItem = selected ? wrongByQuestion.get(selected.id) : undefined
  const selectedCorrectLetters = selected
    ? [selected.answer, selected.answerAlt].filter(Boolean).join(' / ')
    : ''
  const aiReady = canUseAi()
  const explainOpen = !!selected && explainOpenId === selected.id
  const explainDraft = selected ? explainCache[selected.id] : undefined
  const explainLoading = explainOpen && !!selected
    && explainPendingId === selected.id && explainAi.loading
  const explainError = explainOpen && !explainDraft && !explainLoading ? explainAi.error : ''

  const changeReviewFilter = (next: 'wrong' | 'all') => {
    const list = next === 'wrong' ? wrongQuestions : questions
    setReviewFilter(next)
    setSelectedId(list[0]?.id ?? null)
  }

  const stepQuestion = (delta: number) => {
    if (selectedIndex < 0) return
    const next = visibleQuestions[selectedIndex + delta]
    if (next) setSelectedId(next.id)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setAiMenu(null)
      setAiWord(null)
      setExplainOpenId(null)
      abort()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [abort])

  /** 读取当前选区并定位所在段落；返回 null 表示不是有效的英文原文选区 */
  const getSelectionContext = (group: Group): { word: string; sentence: string } | null => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return null
    const word = cleanSelection(selection.toString())
    if (word.length < 2 || word.length > 80) return null

    const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null
    const startNode = range?.startContainer
    const startEl = startNode instanceof Element ? startNode : startNode?.parentElement
    if (!startEl || !startEl.closest('.reading-review-passage')) return null

    const paraEl = startEl.closest('p[data-para-index]') as HTMLElement | null
    const paraIndex = paraEl ? Number(paraEl.dataset.paraIndex) : -1
    const paragraph = Number.isInteger(paraIndex) && paraIndex >= 0
      ? group.paragraphs[paraIndex] || ''
      : group.paragraphs.join(' ')
    return { word, sentence: sentenceAround(paragraph, word) }
  }

  /** 左键选词或右键按下时缓存，防止部分 WebView 在右键时清空 selection */
  const captureSelection = (group: Group) => {
    const ctx = getSelectionContext(group)
    if (ctx) lastSelectionRef.current = { ...ctx, passageKey: group.passageKey, at: Date.now() }
  }

  /** 右键原文：弹出 AI 翻译菜单 */
  const openAiMenu = (e: MouseEvent<HTMLElement>, group: Group) => {
    const current = getSelectionContext(group)
    const last = lastSelectionRef.current
    const fallback = last && last.passageKey === group.passageKey && Date.now() - last.at < 5000
      ? { word: last.word, sentence: last.sentence }
      : null
    const ctx = current || fallback
    if (!ctx) return

    e.preventDefault()
    setAiWord(null)
    setAiMenu({
      x: Math.max(8, Math.min(e.clientX, window.innerWidth - 240)),
      y: Math.max(8, Math.min(e.clientY, window.innerHeight - 140)),
      word: ctx.word,
      sentence: ctx.sentence,
      title: group.title,
      ready: canUseAi(),
    })
  }

  const runTranslation = async (word: string, sentence: string, title: string, x: number, y: number) => {
    setAiWord({ x, y, word, sentence, title, draft: null })
    const draft = await translateReadingWord(word, sentence, title)
    if (!draft) return
    setAiWord((prev) => (
      prev && prev.word === word && prev.sentence === sentence
        ? { ...prev, draft }
        : prev
    ))
  }

  const startAiTranslate = () => {
    if (!aiMenu) return
    const { word, sentence, title } = aiMenu
    setAiMenu(null)
    void runTranslation(
      word,
      sentence,
      title,
      Math.max(8, Math.min(aiMenu.x, window.innerWidth - 400)),
      Math.max(8, Math.min(aiMenu.y + 8, window.innerHeight - 360)),
    )
  }

  const retryTranslation = () => {
    if (!aiWord) return
    void runTranslation(aiWord.word, aiWord.sentence, aiWord.title, aiWord.x, aiWord.y)
  }

  const closeAiWord = () => {
    setAiWord(null)
    abort()
  }

  const runExplain = async (question: ReadingQuestionWithPassage) => {
    setExplainPendingId(question.id)
    const draft = await explainAi.explainReadingQuestion({
      title: `${question.year} Text ${question.textNo} · ${question.passageTitle}`,
      passage: question.paragraphs.map((p, i) => `[${i + 1}] ${p}`).join('\n'),
      stem: question.stem,
      options: question.options,
      answer: [question.answer, question.disputed ? question.answerAlt : ''].filter(Boolean).join(' / '),
      qtype: QTYPE_LABEL[question.qtype] || question.qtype,
      userAnswer: attemptByQuestion.get(question.id)?.userAnswer || '',
    })
    setExplainPendingId((prev) => (prev === question.id ? null : prev))
    if (draft) setExplainCache((prev) => ({ ...prev, [question.id]: draft }))
  }

  /** 打开/收起讲解；已有结果时直接复用，不重复消耗额度 */
  const toggleExplain = () => {
    if (!selected) return
    if (explainOpenId === selected.id) {
      setExplainOpenId(null)
      return
    }
    setExplainOpenId(selected.id)
    if (!aiReady || explainCache[selected.id]) return
    void runExplain(selected)
  }

  const retryExplain = () => {
    if (!selected) return
    void runExplain(selected)
  }

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

      <div className="reading-review-split">
        {selectedGroup ? (
          <section className="reading-review-passage-pane" key={selectedGroup.passageKey}>
            <div className="reading-review-pane-head">
              <div>
                <b>{selectedGroup.title}</b>
                <span>{selectedGroup.paragraphs.length} 段</span>
              </div>
              {selectedGroupWrong.length > 0 && (
                <button
                  className="exam-ghost-btn"
                  onClick={() => onRedoWrong(selectedGroup.passageKey, selectedGroupWrong.map((q) => q.id))}
                >
                  <RotateCw size={13} /> 重做本篇错题
                </button>
              )}
            </div>

            <article
              className="reading-review-passage"
              onMouseDown={(e) => { if (e.button === 2) captureSelection(selectedGroup) }}
              onMouseUp={() => captureSelection(selectedGroup)}
              onContextMenu={(e) => openAiMenu(e, selectedGroup)}
            >
              <div className="reading-review-passage-hint">
                <Sparkles size={13} /> 选中单词后右键，可使用 AI 翻译
              </div>
              {selectedGroup.paragraphs.map((p, i) => (
                <p key={i} data-para-index={i}><span className="reading-para-no">[{i + 1}]</span>{p}</p>
              ))}
            </article>
          </section>
        ) : (
          <section className="reading-review-passage-pane">
            <div className="reading-empty">
              <b>没有原文</b>
              <p>本次会话没有可显示的阅读原文。</p>
            </div>
          </section>
        )}

        <section className="reading-review-question-pane" key={selected?.id ?? 'empty'}>
          <div className="reading-review-pane-head">
            <div>
              <b>{reviewFilter === 'wrong' ? '错题' : '全部题目'}</b>
              <span>{visibleQuestions.length} 题</span>
            </div>
            <div className="reading-review-stepper">
              <button
                className="exam-ghost-btn"
                onClick={() => stepQuestion(-1)}
                disabled={selectedIndex <= 0}
                title="上一题"
              >
                <ChevronLeft size={13} />
              </button>
              <span>{selectedIndex >= 0 ? selectedIndex + 1 : 0} / {visibleQuestions.length}</span>
              <button
                className="exam-ghost-btn"
                onClick={() => stepQuestion(1)}
                disabled={selectedIndex < 0 || selectedIndex >= visibleQuestions.length - 1}
                title="下一题"
              >
                <ChevronRight size={13} />
              </button>
            </div>
          </div>

          <div className="reading-review-filter">
            <button
              className={reviewFilter === 'wrong' ? 'active' : ''}
              onClick={() => changeReviewFilter('wrong')}
              disabled={wrongQuestions.length === 0}
            >
              错题 <b>{wrongQuestions.length}</b>
            </button>
            <button
              className={reviewFilter === 'all' ? 'active' : ''}
              onClick={() => changeReviewFilter('all')}
            >
              题目 <b>{questions.length}</b>
            </button>
            <span className="reading-review-filter-hint">
              {reviewFilter === 'wrong' ? '只显示答错/未答' : '显示全部题目'}
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
                  title={q.disputed ? '本题答案存在争议' : undefined}
                >
                  {globalNo(q)}
                </button>
              )
            })}
          </div>

          {selected ? (
            <div className={`reading-review-item${selectedWrong ? ' wrong' : ' correct'}`}>
              <div className="reading-review-item-head">
                <span className="reading-review-result">
                  {!selectedAttempt || !selectedAttempt.userAnswer ? <Minus size={14} /> : selectedWrong ? <X size={14} /> : <Check size={14} />}
                  {globalNo(selected)}.
                </span>
                <span className="reading-review-type">{QTYPE_LABEL[selected.qtype] || selected.qtype}</span>
                {selected.disputed && <span className="reading-disputed-badge">答案存疑</span>}
                <span className="reading-review-answers">
                  你的答案 <b>{selectedAttempt?.userAnswer || '未答'}</b>
                  <span className="reading-review-sep">·</span>
                  正确答案 <b>{selectedCorrectLetters}</b>
                  {selectedAttempt && <><span className="reading-review-sep">·</span>{fmtDuration(selectedAttempt.durationMs)}</>}
                </span>
              </div>

              <div className="reading-review-question-actions">
                <button
                  className={`exam-ghost-btn${explainOpen ? ' active' : ''}`}
                  onClick={toggleExplain}
                  title={aiReady ? '让 AI 结合原文讲透这道题' : 'AI 未开启或未配置，请到设置中检查'}
                >
                  <Sparkles size={12} /> AI 讲解
                </button>
                {selectedWrong && (
                  <button
                    className="exam-ghost-btn"
                    onClick={() => onRedoWrong(selected.passageKey, [selected.id])}
                  >
                    <RotateCw size={12} /> 重做本题
                  </button>
                )}
              </div>

              <div className="reading-review-stem">{selected.stem}</div>

              <div className="reading-review-options">
                {selected.options.map((option, i) => {
                  const letter = 'ABCD'[i]
                  const isRight = letter === selected.answer || (selected.disputed && letter === selected.answerAlt)
                  const isPicked = selectedAttempt?.userAnswer === letter
                  return (
                    <div key={letter} className={`reading-review-option${isRight ? ' right' : ''}${isPicked && !isRight ? ' picked-wrong' : ''}`}>
                      <span>{letter}</span>{option}
                      {isRight && <em>正确</em>}
                      {isPicked && !isRight && <em className="wrong-em">你的选择</em>}
                    </div>
                  )
                })}
              </div>

              {selected.locateHint && (
                <div className="reading-review-block">
                  <b>定位</b>
                  <p>{selected.locateHint}</p>
                </div>
              )}
              {selected.explanation && (
                <div className="reading-review-block">
                  <b>解析</b>
                  <p>{selected.explanation}</p>
                </div>
              )}
              {selected.distractors && (
                <div className="reading-review-block">
                  <b>干扰项</b>
                  <p>{selected.distractors}</p>
                </div>
              )}
              {selected.answerNote && (
                <div className="reading-review-note">
                  <b>答案说明</b>
                  <p>{selected.answerNote}</p>
                </div>
              )}

              {explainOpen && (
                <div className="reading-ai-explain">
                  <div className="reading-ai-explain-head">
                    <span className="reading-ai-card-title"><Sparkles size={13} /> AI 讲解</span>
                    <span className="reading-ai-explain-sub">{QTYPE_LABEL[selected.qtype] || selected.qtype}</span>
                    <button className="icon-btn" onClick={() => setExplainOpenId(null)} aria-label="关闭讲解">
                      <X size={13} />
                    </button>
                  </div>

                  {!aiReady && (
                    <p className="reading-ai-menu-hint">AI 未开启或未配置，请到设置中检查</p>
                  )}

                  {aiReady && explainLoading && (
                    <div className="reading-ai-loading">
                      <Loader2 size={15} className="spin" /> 正在结合原文讲解…
                    </div>
                  )}

                  {aiReady && explainError && !explainLoading && (
                    <div className="reading-ai-error">
                      <b>讲解失败</b>
                      <p>{explainError}</p>
                      <div className="reading-ai-error-ops">
                        <button className="exam-ghost-btn" onClick={retryExplain}>重试</button>
                        <span>请确认已在设置中开启 AI 并配置模型</span>
                      </div>
                    </div>
                  )}

                  {aiReady && !explainLoading && !explainError && !explainDraft && (
                    <div className="reading-ai-error-ops">
                      <span>未拿到可用讲解</span>
                      <button className="exam-ghost-btn" onClick={retryExplain}>重新讲解</button>
                    </div>
                  )}

                  {explainDraft && !explainLoading && (
                    <div className="reading-ai-explain-body">
                      {explainDraft.verdict && (
                        <div className="reading-ai-row"><span>结论</span><p>{explainDraft.verdict}</p></div>
                      )}
                      {explainDraft.approach && (
                        <div className="reading-ai-row"><span>思路</span><p>{explainDraft.approach}</p></div>
                      )}
                      {explainDraft.evidence && (
                        <div className="reading-ai-sentence">
                          <span>原文依据</span>
                          <p>{explainDraft.evidence}</p>
                          {explainDraft.evidenceZh && (
                            <>
                              <span>译文</span>
                              <p>{explainDraft.evidenceZh}</p>
                            </>
                          )}
                        </div>
                      )}
                      {explainDraft.options.length > 0 && (
                        <div className="reading-ai-explain-options">
                          {explainDraft.options.map((item) => (
                            <div key={item.letter} className={`reading-ai-option ${item.verdict}`}>
                              <b>{item.letter}</b>
                              <p>{item.reason}</p>
                            </div>
                          ))}
                        </div>
                      )}
                      {explainDraft.tip && (
                        <div className="reading-ai-row"><span>点拨</span><p>{explainDraft.tip}</p></div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {selectedWrong && (
                <div className="reading-review-wrong-ops">
                  <label>
                    错因
                    <select
                      value={selectedItem?.reason || ''}
                      onChange={(e) => void setReason(selected.id, e.target.value)}
                    >
                      {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </label>
                  <label className="reading-review-note-input">
                    备注
                    <input
                      value={notes[selected.id] || ''}
                      onChange={(e) => setNotes((prev) => ({ ...prev, [selected.id]: e.target.value }))}
                      onBlur={(e) => void setNote(selected.id, e.target.value)}
                      placeholder="记录关键句/易错点"
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

      {aiMenu && (
        <div className="reading-ai-layer" onMouseDown={() => setAiMenu(null)}>
          <div
            className="reading-ai-menu"
            style={{ left: aiMenu.x, top: aiMenu.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="reading-ai-menu-word">{aiMenu.word}</div>
            <button
              className="reading-ai-menu-item"
              disabled={!aiMenu.ready}
              onClick={startAiTranslate}
            >
              <Sparkles size={14} />
              <span>AI 翻译 · 语境释义</span>
            </button>
            {!aiMenu.ready && (
              <p className="reading-ai-menu-hint">AI 未开启或未配置，请到设置中检查</p>
            )}
          </div>
        </div>
      )}

      {aiWord && (
        <div className="reading-ai-layer" onMouseDown={closeAiWord}>
          <div
            className="reading-ai-card"
            style={{ left: aiWord.x, top: aiWord.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="reading-ai-card-head">
              <span className="reading-ai-card-title"><Sparkles size={14} /> AI 翻译</span>
              <b>{aiWord.draft?.word || aiWord.word}</b>
              {aiWord.draft?.phonetic && <span className="reading-ai-phonetic">{aiWord.draft.phonetic}</span>}
              <button className="icon-btn" onClick={closeAiWord} aria-label="关闭"><X size={14} /></button>
            </div>

            {aiLoading && (
              <div className="reading-ai-loading"><Loader2 size={15} className="spin" /> 正在结合语境翻译…</div>
            )}

            {aiError && !aiLoading && (
              <div className="reading-ai-error">
                <b>翻译失败</b>
                <p>{aiError}</p>
                <div className="reading-ai-error-ops">
                  <button className="exam-ghost-btn" onClick={retryTranslation}>重试</button>
                  <span>请确认已在设置中开启 AI 并配置模型</span>
                </div>
              </div>
            )}

            {aiWord.draft && !aiLoading && (
              <div className="reading-ai-body">
                <div className="reading-ai-row">
                  <span>释义</span>
                  <p>{aiWord.draft.meaning}</p>
                </div>
                {aiWord.draft.context && (
                  <div className="reading-ai-row">
                    <span>语境</span>
                    <p>{aiWord.draft.context}</p>
                  </div>
                )}
                <div className="reading-ai-sentence">
                  <span>原句</span>
                  <p>{aiWord.sentence}</p>
                  {aiWord.draft.sentenceTranslation && (
                    <>
                      <span>翻译</span>
                      <p>{aiWord.draft.sentenceTranslation}</p>
                    </>
                  )}
                </div>
                {aiWord.draft.note && (
                  <div className="reading-ai-row">
                    <span>提示</span>
                    <p>{aiWord.draft.note}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
