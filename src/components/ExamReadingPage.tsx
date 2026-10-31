/**
 * 英语二阅读刷题页。
 *
 * Tab：今日计划 / 题库 / 错题本 / 统计；设置面板内嵌。
 * 作答会话与复盘是整页切换，避免顶部日历/看板切换器串入（TopBar 已 hideChrome）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowRight, BookOpen, CheckCircle2, Clock, Download,
  FileText, Flame, Newspaper, Play, RotateCw, Settings, Target, Upload, X,
} from 'lucide-react'
import {
  abandonReadingSession,
  createReadingSession,
  fetchOngoingReadingSessions,
  fetchSessionAttempts,
  fetchSessionQuestions,
  isInExamSlot,
  READING_RULES,
  removeReadingWrong,
  setReadingWrongStatus,
  updateReadingWrongReason,
} from '../lib/exam-reading-db'
import type {
  ReadingAttempt,
  ReadingPassageWithQuestions,
  ReadingQuestionWithPassage,
  ReadingSession as ReadingSessionRow,
  ReadingWrongItem,
} from '../lib/exam-reading-db'
import { useExamReadingStore } from '../stores/exam-reading-store'
import { localDateStr } from '../lib/utils'
import { ReadingSession } from './ReadingSession'
import { ReadingReview } from './ReadingReview'

type Tab = 'today' | 'bank' | 'wrong' | 'stats'
type Phase = 'close' | 'timed' | 'set' | 'final' | 'done'
type View =
  | { kind: 'list' }
  | { kind: 'session'; session: ReadingSessionRow; questions: ReadingQuestionWithPassage[]; attempts: ReadingAttempt[] }
  | { kind: 'review'; session: ReadingSessionRow; questions: ReadingQuestionWithPassage[]; attempts: ReadingAttempt[] }

type NextItem =
  | { kind: 'passage'; passage: ReadingPassageWithQuestions; mode: 'close' | 'timed' }
  | { kind: 'set'; year: number; passages: ReadingPassageWithQuestions[] }

const TABS: { id: Tab; label: string }[] = [
  { id: 'today', label: '今日计划' },
  { id: 'bank', label: '题库' },
  { id: 'wrong', label: '错题本' },
  { id: 'stats', label: '统计' },
]

const MODE_LABEL: Record<string, string> = {
  close: '精读',
  timed: '限时',
  set: '套卷',
  wrong: '错题重做',
}

const QTYPE_LABEL: Record<string, string> = {
  detail: '细节题',
  infer: '推断题',
  main: '主旨题',
  vocab: '词义题',
  attitude: '态度题',
  example: '例证题',
  other: '其他',
}

const REASON_LABEL: Record<string, string> = {
  locate: '定位错误',
  vocab: '生词障碍',
  longsent: '长难句',
  option: '选项辨析',
  time: '时间不足',
  careless: '粗心',
  other: '其他',
  unmarked: '未标注',
}

const PHASE_LABEL: Record<Phase, string> = {
  close: '精读期',
  timed: '限时期',
  set: '套卷期',
  final: '考前收尾',
  done: '已结束',
}

function daysUntil(dateStr: string, today: string): number {
  const a = new Date(`${dateStr}T00:00:00`)
  const b = new Date(`${today}T00:00:00`)
  return Math.round((a.getTime() - b.getTime()) / 86400000)
}

function phaseFor(days: number): Phase {
  if (days < 0) return 'done'
  if (days <= 3) return 'final'
  if (days <= 15) return 'set'
  if (days <= 35) return 'timed'
  return 'close'
}

function pct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${Math.round(value * 100)}%`
}

function fmtMs(ms: number): string {
  const total = Math.max(0, Math.round(ms / 60000))
  return total < 60 ? `${total}min` : `${Math.floor(total / 60)}h${String(total % 60).padStart(2, '0')}`
}

function fmtDate(value: string): string {
  if (!value) return ''
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return value.slice(5, 16)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function textTitle(p: ReadingPassageWithQuestions): string {
  return `${p.year} Text ${p.textNo}`
}

function computeNextItem(args: {
  examDate: string | null
  daysLeft: number | null
  phase: Phase
  closeYears: number[]
  timedYear: number | undefined
  mockYears: number[]
  passagesByYear: Map<number, ReadingPassageWithQuestions[]>
  completedSet: Set<string>
  completedSets: Set<number>
}): NextItem | null {
  const { examDate, daysLeft, phase, closeYears, timedYear, mockYears, passagesByYear, completedSet, completedSets } = args
  if (!examDate || daysLeft === null || daysLeft < 0) return null
  const closePool = closeYears.flatMap((year) => passagesByYear.get(year) || [])
  const timedPool = timedYear ? passagesByYear.get(timedYear) || [] : []
  const setPool = mockYears
    .map((year) => ({ year, list: passagesByYear.get(year) || [] }))
    .filter((x) => x.list.length >= 4)

  const pickPassage = (pool: ReadingPassageWithQuestions[]): ReadingPassageWithQuestions | undefined =>
    pool
      .filter((p) => !completedSet.has(p.key))
      .sort((a, b) => a.year - b.year || a.textNo - b.textNo)[0]

  const order: Phase[] = phase === 'close'
    ? ['close', 'timed', 'set']
    : phase === 'timed'
      ? ['timed', 'set']
      : phase === 'set'
        ? ['set']
        : []

  for (const step of order) {
    if (step === 'close') {
      const found = pickPassage(closePool)
      if (found) return { kind: 'passage', passage: found, mode: 'close' }
    }
    if (step === 'timed') {
      const found = pickPassage(timedPool)
      if (found) return { kind: 'passage', passage: found, mode: 'timed' }
    }
    if (step === 'set') {
      const found = setPool.find((x) => !completedSets.has(x.year))
      if (found) return { kind: 'set', year: found.year, passages: found.list }
    }
  }
  return null
}

export function ExamReadingPage() {
  const loaded = useExamReadingStore((s) => s.loaded)
  const loading = useExamReadingStore((s) => s.loading)
  const lastError = useExamReadingStore((s) => s.lastError)
  const passages = useExamReadingStore((s) => s.passages)
  const profile = useExamReadingStore((s) => s.profile)
  const examDate = useExamReadingStore((s) => s.examDate)
  const wrongbook = useExamReadingStore((s) => s.wrongbook)
  const stats = useExamReadingStore((s) => s.stats)
  const completedPassageKeys = useExamReadingStore((s) => s.completedPassageKeys)
  const completedSetYears = useExamReadingStore((s) => s.completedSetYears)
  const loadFromDb = useExamReadingStore((s) => s.loadFromDb)
  const clearError = useExamReadingStore((s) => s.clearError)
  const refreshWrongbook = useExamReadingStore((s) => s.refreshWrongbook)
  const refreshStats = useExamReadingStore((s) => s.refreshStats)
  const refreshProgress = useExamReadingStore((s) => s.refreshProgress)
  const saveProfile = useExamReadingStore((s) => s.saveProfile)
  const reimportBank = useExamReadingStore((s) => s.reimportBank)
  const backupToCloud = useExamReadingStore((s) => s.backupToCloud)
  const restoreFromCloud = useExamReadingStore((s) => s.restoreFromCloud)

  const [tab, setTab] = useState<Tab>('today')
  const [view, setView] = useState<View>({ kind: 'list' })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [resumeSessions, setResumeSessions] = useState<ReadingSessionRow[]>([])
  const [starting, setStarting] = useState(false)
  const [cloudBusy, setCloudBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [wrongFilter, setWrongFilter] = useState<'new' | 'grasped' | 'all'>('new')
  const [statsMode, setStatsMode] = useState<'first' | 'all'>('first')

  const today = localDateStr()
  const daysLeft = examDate ? daysUntil(examDate, today) : null
  const phase = daysLeft === null ? 'close' : phaseFor(daysLeft)
  const completedSet = useMemo(() => new Set(completedPassageKeys), [completedPassageKeys])
  const completedSets = useMemo(() => new Set(completedSetYears), [completedSetYears])

  const passagesByYear = useMemo(() => {
    const map = new Map<number, ReadingPassageWithQuestions[]>()
    for (const p of passages) {
      const list = map.get(p.year) || []
      list.push(p)
      map.set(p.year, list)
    }
    return map
  }, [passages])

  const years = useMemo(
    () => [...new Set(passages.map((p) => p.year))].sort((a, b) => b - a),
    [passages],
  )
  const mockYears = useMemo(
    () => (profile.mockYears.length ? profile.mockYears : years.slice(0, 2)),
    [profile.mockYears, years],
  )
  const timedYear = years[2]
  const closeYears = years.slice(3)

  const nextItem = computeNextItem({
    examDate,
    daysLeft,
    phase,
    closeYears,
    timedYear,
    mockYears,
    passagesByYear,
    completedSet,
    completedSets,
  })

  const refreshOngoing = useCallback(async () => {
    try {
      setResumeSessions(await fetchOngoingReadingSessions())
    } catch {
      // 未完成会话读取失败不阻塞页面
    }
  }, [])

  useEffect(() => {
    void loadFromDb()
  }, [loadFromDb])

  useEffect(() => {
    if (!loaded) return
    let alive = true
    fetchOngoingReadingSessions()
      .then((sessions) => { if (alive) setResumeSessions(sessions) })
      .catch(() => { /* 未完成会话读取失败不阻塞页面 */ })
    return () => { alive = false }
  }, [loaded])

  const ensureNoOngoing = useCallback((): boolean => {
    if (resumeSessions.length === 0) return true
    setMessage('有未完成的练习，请先继续或作废后再开始新的练习')
    return false
  }, [resumeSessions.length])

  const startPassage = async (passage: ReadingPassageWithQuestions, mode: 'close' | 'timed') => {
    if (!ensureNoOngoing() || starting) return
    if (passage.questions.length === 0) {
      setMessage('该篇题库不完整，请先重新导入题库')
      return
    }
    const inSlot = isInExamSlot(new Date(), profile.examSlotStart, profile.examSlotEnd)
    if (mode === 'timed' && profile.slotHint && !inSlot) {
      if (!window.confirm('当前不在英语二考试时段（14:00–17:00）。建议 14:15 开始以匹配考场状态。仍然开始？')) return
    }
    setStarting(true)
    setMessage('')
    try {
      const limitSeconds = mode === 'close' ? profile.closeSeconds : profile.timedSeconds
      const session = await createReadingSession({
        mode,
        scope: passage.key,
        questionIds: passage.questions.map((q) => q.id),
        limitSeconds,
        inExamSlot: inSlot,
      })
      const questions = await fetchSessionQuestions(session.id)
      setView({ kind: 'session', session, questions, attempts: [] })
    } catch (err) {
      setMessage(`开始练习失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setStarting(false)
    }
  }

  const startSet = async (year: number) => {
    if (!ensureNoOngoing() || starting) return
    const list = (passagesByYear.get(year) || []).filter((p) => p.questions.length > 0).sort((a, b) => a.textNo - b.textNo)
    if (list.length < 4) {
      setMessage(`${year} 年题库不完整（需 4 篇），暂不能整套模考`)
      return
    }
    const inSlot = isInExamSlot(new Date(), profile.examSlotStart, profile.examSlotEnd)
    if (profile.slotHint && !inSlot) {
      if (!window.confirm('当前不在英语二考试时段（14:00–17:00）。建议 14:15 开始以匹配考场状态。仍然开始？')) return
    }
    setStarting(true)
    setMessage('')
    try {
      const session = await createReadingSession({
        mode: 'set',
        scope: String(year),
        questionIds: list.flatMap((p) => p.questions.map((q) => q.id)),
        limitSeconds: profile.setSeconds,
        inExamSlot: inSlot,
      })
      const questions = await fetchSessionQuestions(session.id)
      setView({ kind: 'session', session, questions, attempts: [] })
    } catch (err) {
      setMessage(`开始套卷失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setStarting(false)
    }
  }

  const startWrong = async (passageKey: string, questionIds: number[]) => {
    if (!ensureNoOngoing() || starting) return
    if (questionIds.length === 0) {
      setMessage('没有可重做的错题')
      return
    }
    setStarting(true)
    setMessage('')
    try {
      const session = await createReadingSession({
        mode: 'wrong',
        scope: passageKey,
        questionIds: [...new Set(questionIds)],
        limitSeconds: 0,
        inExamSlot: isInExamSlot(new Date(), profile.examSlotStart, profile.examSlotEnd),
      })
      const questions = await fetchSessionQuestions(session.id)
      setView({ kind: 'session', session, questions, attempts: [] })
    } catch (err) {
      setMessage(`开始错题重做失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setStarting(false)
    }
  }

  const resumeSession = async (session: ReadingSessionRow) => {
    try {
      const [questions, attempts] = await Promise.all([
        fetchSessionQuestions(session.id),
        fetchSessionAttempts(session.id),
      ])
      setView({ kind: 'session', session, questions, attempts })
    } catch (err) {
      setMessage(`恢复练习失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const abandonSession = async (session: ReadingSessionRow) => {
    if (!window.confirm('作废后本次作答不计入统计，确定？')) return
    try {
      await abandonReadingSession(session.id)
      useExamReadingStore.getState().markDirty()
      await refreshOngoing()
      setMessage('已作废未完成练习')
    } catch (err) {
      setMessage(`作废失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const openReview = async (session: ReadingSessionRow) => {
    try {
      const [questions, attempts] = await Promise.all([
        fetchSessionQuestions(session.id),
        fetchSessionAttempts(session.id),
      ])
      setView({ kind: 'review', session, questions, attempts })
    } catch (err) {
      setMessage(`加载复盘失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleSubmitted = async (session: ReadingSessionRow) => {
    const [questions, attempts] = await Promise.all([
      fetchSessionQuestions(session.id),
      fetchSessionAttempts(session.id),
    ])
    // 先刷新未完成会话，避免复盘页立刻“重做错题”时被旧会话拦住
    await refreshOngoing()
    setView({ kind: 'review', session, questions, attempts })
    void refreshWrongbook()
    void refreshStats()
    void refreshProgress()
  }

  const handleRedoWrong = (passageKey: string, questionIds: number[]) => {
    setView({ kind: 'list' })
    void startWrong(passageKey, questionIds)
  }

  const onBackup = async () => {
    setCloudBusy(true)
    setMessage('')
    try {
      const result = await backupToCloud()
      setMessage(`已备份到云盘：${result.path}`)
    } catch (err) {
      setMessage(`备份失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setCloudBusy(false)
    }
  }

  const onRestore = async () => {
    if (!window.confirm('从云盘恢复会覆盖本机阅读作答与错题，确定？')) return
    setCloudBusy(true)
    setMessage('')
    try {
      const result = await restoreFromCloud()
      setMessage(result.message)
    } catch (err) {
      setMessage(`恢复失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setCloudBusy(false)
    }
  }

  const onReimport = async () => {
    if (!window.confirm('重新导入题库不会删除作答记录，确定？')) return
    setCloudBusy(true)
    try {
      const result = await reimportBank()
      setMessage(`题库已重导：${result.passages} 篇 / ${result.questions} 题`)
    } catch (err) {
      setMessage(`题库重导失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setCloudBusy(false)
    }
  }

  if (!loaded || loading) {
    return <div className="exam-reading-page"><p className="placeholder-text">加载题库…</p></div>
  }

  if (view.kind === 'session') {
    return (
      <ReadingSession
        session={view.session}
        questions={view.questions}
        initialAttempts={view.attempts}
        onExit={() => {
          setView({ kind: 'list' })
          void refreshOngoing()
        }}
        onSubmitted={(session) => { void handleSubmitted(session) }}
      />
    )
  }

  if (view.kind === 'review') {
    return (
      <ReadingReview
        session={view.session}
        questions={view.questions}
        attempts={view.attempts}
        wrongbook={wrongbook}
        onBack={() => {
          setView({ kind: 'list' })
          void refreshWrongbook()
          void refreshStats()
          void refreshProgress()
        }}
        onRedoWrong={handleRedoWrong}
      />
    )
  }

  const wrongNew = wrongbook.filter((w) => w.status === 'new')
  const finished = passages.length > 0 && passages.every((p) => completedSet.has(p.key))
  const progress = passages.length ? completedSet.size / passages.length : 0

  return (
    <div className="exam-reading-page">
      <header className="exam-reading-header">
        <div>
          <h2><Newspaper size={18} /> 英语二阅读</h2>
          <p className="exam-reading-sub">
            题库 {passages.length} 篇 / {passages.reduce((n, p) => n + p.questions.length, 0)} 题
            {daysLeft !== null && daysLeft >= 0 && <> · 距考试 {daysLeft} 天</>}
            {' '}· 建议 {READING_RULES.readingBlockStart} 开始
          </p>
        </div>
        <div className="exam-reading-head-ops">
          <span className={`reading-slot-chip${isInExamSlot(new Date(), profile.examSlotStart, profile.examSlotEnd) ? ' active' : ''}`}>
            <Clock size={13} /> 考场时段 {profile.examSlotStart}–{profile.examSlotEnd}
          </span>
          <button className="exam-ghost-btn" onClick={() => setSettingsOpen((v) => !v)}>
            <Settings size={13} /> 设置
          </button>
        </div>
      </header>

      {lastError && (
        <div className="exam-vocab-error">
          <span>{lastError}</span>
          <button className="exam-vocab-error-close" onClick={clearError}>×</button>
        </div>
      )}
      {message && (
        <div className="reading-message">
          <span>{message}</span>
          <button className="exam-vocab-error-close" onClick={() => setMessage('')}>×</button>
        </div>
      )}

      <div className="exam-reading-overview">
        <OverviewStat label="今日练习" value={fmtMs(stats?.todayMs ?? 0)} icon={<Clock size={13} />} />
        <OverviewStat label="今日正确率" value={pct(stats?.todayAccuracy)} icon={<Target size={13} />} />
        <OverviewStat label="累计篇数" value={`${stats?.passagesPracticed ?? 0}/${passages.length}`} icon={<BookOpen size={13} />} />
        <OverviewStat label="待复习错题" value={String(wrongNew.length)} icon={<Flame size={13} />} />
      </div>

      <div className="exam-vocab-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`exam-vocab-tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'wrong' && wrongNew.length > 0 && <span className="exam-vocab-tab-badge">{wrongNew.length}</span>}
          </button>
        ))}
      </div>

      {settingsOpen && (
        <section className="reading-settings">
          <div className="reading-settings-row">
            <b>单篇限时</b>
            <div className="reading-choice">
              <button className={profile.timedSeconds === 900 ? 'active' : ''} onClick={() => void saveProfile({ timedSeconds: 900 })}>15 min</button>
              <button className={profile.timedSeconds === 1080 ? 'active' : ''} onClick={() => void saveProfile({ timedSeconds: 1080 })}>18 min</button>
            </div>
          </div>
          <div className="reading-settings-row">
            <b>套卷限时</b>
            <div className="reading-choice">
              <button className={profile.setSeconds === 3600 ? 'active' : ''} onClick={() => void saveProfile({ setSeconds: 3600 })}>60 min</button>
              <button className={profile.setSeconds === 4200 ? 'active' : ''} onClick={() => void saveProfile({ setSeconds: 4200 })}>70 min</button>
            </div>
          </div>
          <div className="reading-settings-row">
            <b>非考场时段提示</b>
            <label className="reading-check">
              <input
                type="checkbox"
                checked={profile.slotHint}
                onChange={(e) => void saveProfile({ slotHint: e.target.checked })}
              />
              开始限时/套卷时提示建议 14:15 开始
            </label>
          </div>
          <div className="reading-settings-row">
            <b>题库</b>
            <span>版本 v{profile.bankVersion} · {passages.length} 篇 / {passages.reduce((n, p) => n + p.questions.length, 0)} 题</span>
            <button className="exam-ghost-btn" onClick={() => void onReimport()} disabled={cloudBusy}>
              <RotateCw size={13} /> 重新导入
            </button>
          </div>
          <div className="reading-settings-row">
            <b>云同步</b>
            <button className="exam-ghost-btn" onClick={() => void onBackup()} disabled={cloudBusy}>
              <Upload size={13} /> 备份到云盘
            </button>
            <button className="exam-ghost-btn" onClick={() => void onRestore()} disabled={cloudBusy}>
              <Download size={13} /> 从云盘恢复
            </button>
          </div>
        </section>
      )}

      {resumeSessions.length > 0 && (
        <div className="reading-resume">
          <AlertTriangle size={15} />
          <div>
            <b>有未完成的练习</b>
            {resumeSessions.map((s) => (
              <div className="reading-resume-row" key={s.id}>
                <span>{MODE_LABEL[s.mode]} · {s.scope} · {fmtDate(s.startedAt)}</span>
                <button className="exam-primary-btn" onClick={() => void resumeSession(s)}>继续</button>
                <button className="exam-ghost-btn" onClick={() => void abandonSession(s)}>作废</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="exam-reading-body">
        {tab === 'today' && (
          <div className="reading-today">
            {daysLeft !== null && daysLeft < 0 && (
              <div className="reading-empty">
                <CheckCircle2 size={28} />
                <b>本年度考研已结束</b>
                <p>题库与历史统计仍可查看；可在「考研计划」中更新考试日后重新排期。</p>
              </div>
            )}

            {daysLeft === null && (
              <div className="reading-empty">
                <Target size={28} />
                <b>尚未设置考试日</b>
                <p>请先到「考研计划」设置考试日期，今日计划会按剩余天数自动排期。</p>
              </div>
            )}

            {daysLeft !== null && daysLeft >= 0 && (
              <section className="reading-plan-card">
                <div className="reading-plan-head">
                  <div>
                    <span className="reading-plan-phase">{PHASE_LABEL[phase]}</span>
                    <h3>
                      {nextItem?.kind === 'passage' && `${textTitle(nextItem.passage)} · ${nextItem.mode === 'close' ? '精读' : '限时'}`}
                      {nextItem?.kind === 'set' && `${nextItem.year} 整套模考`}
                      {!nextItem && (phase === 'final' ? '考前收尾：只复盘错题' : '题库已全部完成')}
                    </h3>
                    <p>
                      {nextItem?.kind === 'passage' && `${nextItem.passage.questions.length} 题 · ${nextItem.passage.wordCount} 词 · ${nextItem.passage.title}`}
                      {nextItem?.kind === 'set' && `4 篇 20 题 · ${profile.setSeconds / 60}:00`}
                      {!nextItem && (phase === 'final' ? '重做错题 + 1 篇旧题保持手感，不刷新题' : '去错题本复盘，或从题库里二刷')}
                    </p>
                  </div>
                  <div className="reading-plan-dday">
                    <b>D-{daysLeft}</b>
                    <span>{examDate}</span>
                  </div>
                </div>

                <div className="reading-plan-ops">
                  {nextItem?.kind === 'passage' && (
                    <>
                      <button className="exam-primary-btn" onClick={() => void startPassage(nextItem.passage, nextItem.mode)} disabled={starting}>
                        <Play size={14} /> {nextItem.mode === 'close' ? '开始精读' : `开始限时 ${profile.timedSeconds / 60}:00`}
                      </button>
                      <button className="exam-ghost-btn" onClick={() => void startPassage(nextItem.passage, 'close')} disabled={starting}>
                        精读（不限时）
                      </button>
                      <button className="exam-ghost-btn" onClick={() => void startPassage(nextItem.passage, 'timed')} disabled={starting}>
                        限时 {profile.timedSeconds / 60}:00
                      </button>
                    </>
                  )}
                  {nextItem?.kind === 'set' && (
                    <button className="exam-primary-btn" onClick={() => void startSet(nextItem.year)} disabled={starting}>
                      <Play size={14} /> 开始套卷 {profile.setSeconds / 60}:00
                    </button>
                  )}
                  {!nextItem && (
                    <button className="exam-ghost-btn" onClick={() => setTab('wrong')}>
                      去错题本 <ArrowRight size={14} />
                    </button>
                  )}
                </div>

                <div className="reading-progress">
                  <div className="reading-progress-label">
                    <span>题库进度 {completedSet.size}/{passages.length} 篇</span>
                    <span>{finished ? '全部完成' : `剩余 ${passages.length - completedSet.size} 篇`}</span>
                  </div>
                  <div className="reading-progress-bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
                </div>
              </section>
            )}

            {stats && stats.recent.length > 0 && (
              <section className="reading-recent">
                <div className="reading-section-title">
                  <b>最近练习</b>
                  <button className="exam-ghost-btn" onClick={() => setTab('stats')}>看统计 <ArrowRight size={13} /></button>
                </div>
                {stats.recent.slice(0, 5).map((s) => (
                  <div className="reading-recent-row" key={s.id}>
                    <span className="reading-recent-mode">{MODE_LABEL[s.mode] || s.mode}</span>
                    <span>{fmtDate(s.startedAt)}</span>
                    <span>{s.correctCount}/{s.questionCount} 题</span>
                    <span>{fmtMs(s.elapsedMs)}</span>
                    {s.overtime && <span className="reading-overtime">超时</span>}
                    <button className="exam-ghost-btn" onClick={() => void openReview(s)}>复盘</button>
                  </div>
                ))}
              </section>
            )}
          </div>
        )}

        {tab === 'bank' && (
          <div className="reading-bank">
            {years.map((year) => {
              const list = (passagesByYear.get(year) || []).slice().sort((a, b) => a.textNo - b.textNo)
              const done = list.filter((p) => completedSet.has(p.key)).length
              const yearWrong = list.reduce(
                (n, p) => n + wrongNew.filter((w) => w.passageKey === p.key).length,
                0,
              )
              const isMock = mockYears.includes(year)
              return (
                <section className="reading-year" key={year}>
                  <div className="reading-year-head">
                    <div>
                      <b>{year}</b>
                      <span>{isMock ? '套卷池 · 建议留到考前' : year === timedYear ? '限时池' : '精读池'}</span>
                      <span>{done}/{list.length} 篇已完成</span>
                      {yearWrong > 0 && <span className="reading-year-wrong">错题 {yearWrong}</span>}
                    </div>
                    <button
                      className="exam-ghost-btn"
                      onClick={() => void startSet(year)}
                      disabled={starting || list.length < 4}
                    >
                      <FileText size={13} /> 整套模考 {profile.setSeconds / 60}:00
                    </button>
                  </div>
                  {list.map((p) => {
                    const passageWrong = wrongNew.filter((w) => w.passageKey === p.key)
                    const isDone = completedSet.has(p.key)
                    return (
                      <div className="reading-bank-row" key={p.key}>
                        <div className="reading-bank-title">
                          <b>Text {p.textNo}</b>
                          <span>{p.title}</span>
                        </div>
                        <div className="reading-bank-meta">
                          <span>{p.topic}</span>
                          <span>{p.wordCount} 词</span>
                          <span>{p.questions.length} 题</span>
                          {passageWrong.length > 0 && <span className="reading-year-wrong">错题 {passageWrong.length}</span>}
                          {isDone ? <span className="reading-done-tag">已完成</span> : <span className="reading-todo-tag">未做</span>}
                        </div>
                        <div className="reading-bank-ops">
                          <button className="exam-ghost-btn" onClick={() => void startPassage(p, 'close')} disabled={starting}>精读</button>
                          <button className="exam-ghost-btn" onClick={() => void startPassage(p, 'timed')} disabled={starting}>限时 {profile.timedSeconds / 60}:00</button>
                          {passageWrong.length > 0 && (
                            <button className="exam-ghost-btn" onClick={() => void startWrong(p.key, passageWrong.map((w) => w.questionId))} disabled={starting}>
                              <RotateCw size={13} /> 错题 {passageWrong.length}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </section>
              )
            })}
          </div>
        )}

        {tab === 'wrong' && (
          <div className="reading-wrong">
            <div className="reading-wrong-filter">
              {(['new', 'grasped', 'all'] as const).map((f) => (
                <button
                  key={f}
                  className={wrongFilter === f ? 'active' : ''}
                  onClick={() => setWrongFilter(f)}
                >
                  {f === 'new' ? '待复习' : f === 'grasped' ? '已掌握' : '全部'}
                </button>
              ))}
              <span>共 {wrongbook.length} 条</span>
            </div>
            {wrongbook.filter((w) => wrongFilter === 'all' || w.status === wrongFilter).length === 0 && (
              <div className="reading-empty">
                <CheckCircle2 size={28} />
                <b>没有符合条件的错题</b>
                <p>做完一篇并交卷后，答错和未答的题会自动进来。</p>
              </div>
            )}
            {wrongbook
              .filter((w) => wrongFilter === 'all' || w.status === wrongFilter)
              .map((w) => (
                <WrongRow
                  key={w.id}
                  item={w}
                  onRedo={() => {
                    const ids = wrongNew.filter((x) => x.passageKey === w.passageKey).map((x) => x.questionId)
                    void startWrong(w.passageKey, ids.length ? ids : [w.questionId])
                  }}
                  onGrasp={async () => {
                    await setReadingWrongStatus(w.questionId, 'grasped')
                    useExamReadingStore.getState().markDirty()
                    await refreshWrongbook()
                  }}
                  onRemove={async () => {
                    if (!window.confirm('从错题本移除？')) return
                    await removeReadingWrong(w.questionId)
                    useExamReadingStore.getState().markDirty()
                    await refreshWrongbook()
                  }}
                  onReason={async (reason) => {
                    await updateReadingWrongReason(w.questionId, reason, w.note)
                    useExamReadingStore.getState().markDirty()
                    await refreshWrongbook()
                  }}
                />
              ))}
          </div>
        )}

        {tab === 'stats' && stats && (
          <div className="reading-stats">
            <div className="reading-stats-mode">
              <button className={statsMode === 'first' ? 'active' : ''} onClick={() => setStatsMode('first')}>首刷</button>
              <button className={statsMode === 'all' ? 'active' : ''} onClick={() => setStatsMode('all')}>含重做</button>
              <span>首刷按每题最早一次作答统计；含重做包含所有提交</span>
            </div>

            <div className="reading-stat-cards">
              <StatCard label="正确率" value={pct(statsMode === 'first' ? stats.firstAccuracy : stats.allAccuracy)} />
              <StatCard label="已答题数" value={String(stats.questionsAnswered)} />
              <StatCard label="平均每题" value={stats.avgMs ? `${Math.round(stats.avgMs / 1000)}s` : '—'} />
              <StatCard label="限时完成率" value={pct(stats.timedCompletionRate)} />
              <StatCard label="套卷平均分" value={stats.setAvgScore === null ? '—' : `${stats.setAvgScore.toFixed(1)}/40`} />
              <StatCard label="考场时段练习" value={pct(stats.slotRatio)} />
              <StatCard label="考场时段正确率" value={pct(stats.slotAccuracy)} />
              <StatCard label="非考场时段正确率" value={pct(stats.offSlotAccuracy)} />
            </div>

            <StatBars title="按年份正确率（首刷）" rows={stats.byYear} />
            <StatBars title="按题型正确率（首刷）" rows={stats.byType.map((r) => ({ ...r, label: QTYPE_LABEL[r.label] || r.label }))} />
            <StatBars
              title="最近 10 次正确率"
              rows={stats.recent.map((s) => ({
                label: fmtDate(s.startedAt),
                total: s.questionCount,
                correct: s.correctCount,
                accuracy: s.questionCount ? s.correctCount / s.questionCount : 0,
              }))}
            />

            <div className="reading-stat-reasons">
              <b>错因分布</b>
              {stats.wrongByReason.length === 0 && <span>暂无</span>}
              {stats.wrongByReason.map((r) => (
                <span key={r.reason}>{REASON_LABEL[r.reason] || '未标注'} {r.count}</span>
              ))}
            </div>

            {stats.disputedCount > 0 && (
              <div className="reading-stat-disputed">
                <AlertTriangle size={14} /> 题库含 {stats.disputedCount} 道争议题，两个答案均判对；复盘会显示来源说明。
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function OverviewStat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="exam-vocab-overview-stat">
      <span className="exam-vocab-overview-label">{icon}{label}</span>
      <b>{value}</b>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="reading-stat-card">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  )
}

function StatBars({
  title,
  rows,
}: {
  title: string
  rows: { label: string; total: number; correct: number; accuracy: number }[]
}) {
  return (
    <div className="reading-stat-bars">
      <b>{title}</b>
      {rows.length === 0 && <span className="reading-stat-empty">暂无数据</span>}
      {rows.map((row) => (
        <div className="reading-stat-bar-row" key={row.label}>
          <span className="reading-stat-bar-label">{row.label}</span>
          <div className="reading-stat-bar"><i style={{ width: `${Math.round(row.accuracy * 100)}%` }} /></div>
          <span className="reading-stat-bar-value">{Math.round(row.accuracy * 100)}% <small>({row.total})</small></span>
        </div>
      ))}
    </div>
  )
}

function WrongRow({
  item,
  onRedo,
  onGrasp,
  onRemove,
  onReason,
}: {
  item: ReadingWrongItem
  onRedo: () => void
  onGrasp: () => void
  onRemove: () => void
  onReason: (reason: string) => void
}) {
  return (
    <div className={`reading-wrong-row${item.status === 'grasped' ? ' grasped' : ''}`}>
      <div className="reading-wrong-main">
        <div className="reading-wrong-head">
          <b>{item.year} Text {item.textNo} Q{item.questionKey.split('-q')[1] || ''}</b>
          <span className={`reading-wrong-status ${item.status}`}>{item.status === 'grasped' ? '已掌握' : '待复习'}</span>
          {item.disputed && <span className="reading-disputed-badge">存疑</span>}
          <span>错 {item.wrongCount} 次</span>
          <span>你 {item.lastWrongAnswer || '未答'} / 对 {item.answer}{item.answerAlt ? ` 或 ${item.answerAlt}` : ''}</span>
        </div>
        <p className="reading-wrong-stem">{item.stem}</p>
        <div className="reading-wrong-ops">
          <label>
            错因
            <select value={item.reason} onChange={(e) => onReason(e.target.value)}>
              <option value="">未标注</option>
              <option value="locate">定位错误</option>
              <option value="vocab">生词障碍</option>
              <option value="longsent">长难句</option>
              <option value="option">选项辨析</option>
              <option value="time">时间不足</option>
              <option value="careless">粗心</option>
              <option value="other">其他</option>
            </select>
          </label>
          <button className="exam-primary-btn" onClick={onRedo}>重做</button>
          {item.status === 'new' && <button className="exam-ghost-btn" onClick={onGrasp}>标记掌握</button>}
          <button className="exam-ghost-btn" onClick={onRemove}><X size={13} /> 移除</button>
        </div>
      </div>
      {item.explanation && (
        <details className="reading-wrong-detail">
          <summary>看解析</summary>
          <p><b>定位：</b>{item.locateHint || '—'}</p>
          <p><b>解析：</b>{item.explanation}</p>
          {item.distractors && <p><b>干扰项：</b>{item.distractors}</p>}
          {item.answerNote && <p><b>答案说明：</b>{item.answerNote}</p>}
        </details>
      )}
    </div>
  )
}
