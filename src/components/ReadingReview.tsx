/**
 * 阅读复盘视图：逐题显示答案、定位、解析、干扰项与错因。
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { ArrowLeft, Check, ChevronDown, Loader2, Minus, RotateCw, Sparkles, X } from 'lucide-react'
import { canUseAi } from '../lib/ai'
import type { AiReadingWordDraft } from '../lib/ai-json'
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

  const { translateReadingWord, loading: aiLoading, error: aiError, abort } = useAiTask()
  const [aiMenu, setAiMenu] = useState<AiMenuState | null>(null)
  const [aiWord, setAiWord] = useState<AiWordState | null>(null)
  const lastSelectionRef = useRef<{ word: string; sentence: string; at: number } | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setAiMenu(null)
      setAiWord(null)
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
    if (ctx) lastSelectionRef.current = { ...ctx, at: Date.now() }
  }

  /** 右键原文：弹出 AI 翻译菜单 */
  const openAiMenu = (e: MouseEvent<HTMLElement>, group: Group) => {
    const current = getSelectionContext(group)
    const last = lastSelectionRef.current
    const fallback = last && Date.now() - last.at < 5000
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
              <article
                className="reading-review-passage"
                onMouseDown={(e) => { if (e.button === 2) captureSelection(group) }}
                onMouseUp={() => captureSelection(group)}
                onContextMenu={(e) => openAiMenu(e, group)}
              >
                <div className="reading-review-passage-hint">
                  <Sparkles size={13} /> 选中单词后右键，可使用 AI 翻译
                </div>
                {group.paragraphs.map((p, i) => (
                  <p key={i} data-para-index={i}><span className="reading-para-no">[{i + 1}]</span>{p}</p>
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
