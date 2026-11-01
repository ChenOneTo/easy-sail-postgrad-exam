/**
 * 199 管综刷题页（数学 / 逻辑共用）。
 *
 * Tab：今日计划 / 题库 / 错题本 / 统计；设置面板内嵌。
 * 「按考试时间推算」是主逻辑：整套限时 = 数学 60 分钟 / 逻辑 55 分钟，
 * 分块与单题限时按题量 × 单题均时推算；考试日上午 8:30–11:30 为考场时段。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowRight, CheckCircle2, Clock, Download, Flame, Layers,
  Play, RotateCw, Settings, Target, Upload, X,
} from 'lucide-react'
import {
  abandonMgmtSession,
  createMgmtSession,
  estimateSeconds,
  fetchOngoingMgmtSessions,
  fetchSessionAttempts,
  fetchSessionQuestions,
  fullScoreOf,
  isInMgmtSlot,
  MGMT_RULES,
  phaseForDays,
  PHASE_HINT,
  PHASE_LABEL,
  perQuestionSeconds,
  removeMgmtWrong,
  setMgmtWrongStatus,
  subjectRule,
  suggestSlot,
  updateMgmtWrongReason,
} from '../lib/exam-mgmt-db'
import type {
  MgmtAttempt,
  MgmtPhase,
  MgmtQuestion,
  MgmtSession as MgmtSessionRow,
  MgmtSessionMode,
  MgmtSubject,
  MgmtWrongItem,
} from '../lib/exam-mgmt-db'
import { useExamMgmtStore } from '../stores/exam-mgmt-store'
import { localDateStr } from '../lib/utils'
import { MgmtSession } from './MgmtSession'

type Tab = 'today' | 'bank' | 'wrong' | 'stats'

type View =
  | { kind: 'list' }
  | { kind: 'session'; session: MgmtSessionRow; questions: MgmtQuestion[]; attempts: MgmtAttempt[] }

const MODE_LABEL: Record<MgmtSessionMode, string> = {
  drill: '精练',
  timed: '限时',
  set: '整套',
  wrong: '错题重做',
}

const REASON_LABEL: Record<string, string> = {
  concept: '概念不清',
  calc: '计算失误',
  typenew: '题型没见过',
  csd: '充分性陷阱',
  read: '读题偏差',
  time: '时间不足',
  careless: '粗心',
  other: '其他',
  unmarked: '未标注',
}

const QTYPE_LABEL: Record<string, string> = {
  ps: '问题求解',
  csd: '条件充分性判断',
  logic: '逻辑推理',
}

function daysUntil(dateStr: string, today: string): number {
  const a = new Date(`${dateStr}T00:00:00`)
  const b = new Date(`${today}T00:00:00`)
  return Math.round((a.getTime() - b.getTime()) / 86400000)
}

function pct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${Math.round(value * 100)}%`
}

function fmtMinutes(seconds: number): string {
  if (seconds <= 0) return '不限时'
  const m = Math.round(seconds / 60)
  return m >= 60 ? `${Math.floor(m / 60)} 时 ${m % 60} 分` : `${m} 分钟`
}

function fmtDate(value: string): string {
  if (!value) return ''
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return value.slice(5, 16)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function fmtMs(ms: number): string {
  const total = Math.max(0, Math.round(ms / 60000))
  return total < 60 ? `${total}min` : `${Math.floor(total / 60)}h${String(total % 60).padStart(2, '0')}`
}

/** 逻辑按题号分两组；数学按题型分块 */
function blockSpecs(subject: MgmtSubject): { key: string; label: string; from: number; to: number; minutes: number }[] {
  if (subject === 'math') {
    return MGMT_RULES.blocks.map((b) => ({
      key: b.key,
      label: b.label,
      from: b.from,
      to: b.to,
      minutes: b.minutes,
    }))
  }
  return [
    { key: 'logic-1', label: '26–40 题', from: 26, to: 40, minutes: Math.round(15 * perQuestionSeconds('logic') / 60) },
    { key: 'logic-2', label: '41–55 题', from: 41, to: 55, minutes: Math.round(15 * perQuestionSeconds('logic') / 60) },
  ]
}

export function MgmtPracticePage({ subject }: { subject: MgmtSubject }) {
  const rule = subjectRule(subject)

  const loaded = useExamMgmtStore((s) => s.loaded)
  const loading = useExamMgmtStore((s) => s.loading)
  const lastError = useExamMgmtStore((s) => s.lastError)
  const allQuestions = useExamMgmtStore((s) => s.questions)
  const profile = useExamMgmtStore((s) => s.profile)
  const examDate = useExamMgmtStore((s) => s.examDate)
  const allWrong = useExamMgmtStore((s) => s.wrongbook)
  const stats = useExamMgmtStore((s) => s.stats[subject])
  const completedSetYears = useExamMgmtStore((s) => s.completedSetYears[subject])
  const attemptedIds = useExamMgmtStore((s) => s.attemptedIds[subject])
  const loadFromDb = useExamMgmtStore((s) => s.loadFromDb)
  const clearError = useExamMgmtStore((s) => s.clearError)
  const refreshWrongbook = useExamMgmtStore((s) => s.refreshWrongbook)
  const refreshStats = useExamMgmtStore((s) => s.refreshStats)
  const refreshProgress = useExamMgmtStore((s) => s.refreshProgress)
  const saveProfile = useExamMgmtStore((s) => s.saveProfile)
  const reimportBank = useExamMgmtStore((s) => s.reimportBank)
  const backupToCloud = useExamMgmtStore((s) => s.backupToCloud)
  const restoreFromCloud = useExamMgmtStore((s) => s.restoreFromCloud)

  const [tab, setTab] = useState<Tab>('today')
  const [view, setView] = useState<View>({ kind: 'list' })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [resumeSessions, setResumeSessions] = useState<MgmtSessionRow[]>([])
  const [starting, setStarting] = useState(false)
  const [cloudBusy, setCloudBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [wrongFilter, setWrongFilter] = useState<'new' | 'grasped' | 'all'>('new')
  const [statsMode, setStatsMode] = useState<'first' | 'all'>('first')
  const [openYear, setOpenYear] = useState<number | null>(null)

  const questions = useMemo(
    () => allQuestions.filter((q) => q.subject === subject),
    [allQuestions, subject],
  )
  const wrongbook = useMemo(
    () => allWrong.filter((w) => w.subject === subject),
    [allWrong, subject],
  )
  const wrongNew = wrongbook.filter((w) => w.status === 'new')
  const attemptedSet = useMemo(() => new Set(attemptedIds), [attemptedIds])

  const years = useMemo(
    () => [...new Set(questions.map((q) => q.year))].sort((a, b) => b - a),
    [questions],
  )
  const byYear = useMemo(() => {
    const map = new Map<number, MgmtQuestion[]>()
    for (const q of questions) {
      const list = map.get(q.year) || []
      list.push(q)
      map.set(q.year, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.qno - b.qno)
    return map
  }, [questions])

  const today = localDateStr()
  const daysLeft = examDate ? daysUntil(examDate, today) : null
  const phase: MgmtPhase = daysLeft === null ? 'base' : phaseForDays(daysLeft)
  const inSlot = isInMgmtSlot(new Date())
  const slot = suggestSlot(subject)
  const paperSeconds = subject === 'math' ? profile.mathSeconds : profile.logicSeconds

  const refreshOngoing = useCallback(async () => {
    try {
      setResumeSessions(await fetchOngoingMgmtSessions(subject))
    } catch {
      // 未完成会话读取失败不阻塞页面
    }
  }, [subject])

  useEffect(() => {
    void loadFromDb()
  }, [loadFromDb])

  useEffect(() => {
    if (!loaded) return
    let alive = true
    fetchOngoingMgmtSessions(subject)
      .then((sessions) => { if (alive) setResumeSessions(sessions) })
      .catch(() => { /* 未完成会话读取失败不阻塞页面 */ })
    return () => { alive = false }
  }, [loaded, subject])

  // ========== 今日推荐：按阶段推算下一次该练什么 ==========
  const nextSet = useMemo(() => {
    const unfinished = years.find((y) => !completedSetYears.includes(y))
    const year = unfinished ?? years[0]
    if (!year) return null
    const list = byYear.get(year) || []
    if (list.length === 0) return null
    return { year, list }
  }, [byYear, completedSetYears, years])

  const ensureNoOngoing = useCallback((): boolean => {
    if (resumeSessions.length === 0) return true
    setMessage('有未完成的练习，请先继续或作废后再开始新的练习')
    return false
  }, [resumeSessions.length])

  const confirmSlot = (mode: MgmtSessionMode): boolean => {
    if (mode === 'drill' || mode === 'wrong' || !profile.slotHint || inSlot) return true
    return window.confirm(
      `199 管综在上午 8:30–11:30 开考，本模块建议 ${slot.start} 开始${rule.label}。\n当前不在该时段，仍然开始限时？`,
    )
  }

  const startSession = async (input: {
    mode: MgmtSessionMode
    scope: string
    list: MgmtQuestion[]
    limitSeconds: number
  }) => {
    if (!ensureNoOngoing() || starting) return
    if (input.list.length === 0) {
      setMessage('没有可练的题目')
      return
    }
    if (!confirmSlot(input.mode)) return
    setStarting(true)
    setMessage('')
    try {
      const session = await createMgmtSession({
        subject,
        mode: input.mode,
        scope: input.scope,
        questionIds: input.list.map((q) => q.id),
        limitSeconds: input.limitSeconds,
        inExamSlot: inSlot,
      })
      const list = await fetchSessionQuestions(session.id)
      setView({ kind: 'session', session, questions: list, attempts: [] })
    } catch (err) {
      setMessage(`开始练习失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setStarting(false)
    }
  }

  const startSet = (year: number) => {
    const list = byYear.get(year) || []
    void startSession({
      mode: 'set',
      scope: String(year),
      list,
      limitSeconds: paperSeconds,
    })
  }

  const startBlock = (year: number, from: number, to: number, label: string) => {
    const list = (byYear.get(year) || []).filter((q) => q.qno >= from && q.qno <= to)
    void startSession({
      mode: 'timed',
      scope: `${year} ${label}`,
      list,
      limitSeconds: estimateSeconds(subject, list.length),
    })
  }

  const startDrill = (list: MgmtQuestion[], scope: string) => {
    void startSession({ mode: 'drill', scope, list, limitSeconds: 0 })
  }

  const startWrong = (ids: number[], scope = '错题重做') => {
    const list = questions.filter((q) => ids.includes(q.id))
    void startSession({ mode: 'wrong', scope, list, limitSeconds: 0 })
  }

  const resumeSession = async (session: MgmtSessionRow) => {
    try {
      const [list, attempts] = await Promise.all([
        fetchSessionQuestions(session.id),
        fetchSessionAttempts(session.id),
      ])
      setView({ kind: 'session', session, questions: list, attempts })
    } catch (err) {
      setMessage(`恢复练习失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const abandonSession = async (session: MgmtSessionRow) => {
    if (!window.confirm('作废后本次作答不计入统计，确定？')) return
    try {
      await abandonMgmtSession(session.id)
      useExamMgmtStore.getState().markDirty()
      await refreshOngoing()
      setMessage('已作废未完成练习')
    } catch (err) {
      setMessage(`作废失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleSubmitted = async () => {
    await refreshOngoing()
    void refreshWrongbook()
    void refreshStats(subject)
    void refreshProgress(subject)
  }

  const openReview = async (session: MgmtSessionRow) => {
    try {
      const [list, attempts] = await Promise.all([
        fetchSessionQuestions(session.id),
        fetchSessionAttempts(session.id),
      ])
      setView({ kind: 'session', session, questions: list, attempts })
    } catch (err) {
      setMessage(`加载复盘失败：${err instanceof Error ? err.message : String(err)}`)
    }
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
    if (!window.confirm('从云盘恢复会覆盖本机刷题记录与错题，确定？')) return
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
      setMessage(`题库已重导：${result.questions} 题`)
    } catch (err) {
      setMessage(`题库重导失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setCloudBusy(false)
    }
  }

  if (!loaded || loading) {
    return <div className="exam-reading-page"><p className="placeholder-text">加载管综题库…</p></div>
  }

  if (view.kind === 'session') {
    return (
      <MgmtSession
        session={view.session}
        questions={view.questions}
        initialAttempts={view.attempts}
        onExit={() => {
          setView({ kind: 'list' })
          void refreshOngoing()
        }}
        onSubmitted={() => { void handleSubmitted() }}
        onRedoWrong={(ids) => {
          setView({ kind: 'list' })
          setTab('wrong')
          // 先刷新未完成会话，否则刚交卷的会话仍会被 ensureNoOngoing 拦住
          void refreshOngoing().then(() => startWrong(ids))
        }}
      />
    )
  }

  const correctRate = stats ? (statsMode === 'first' ? stats.firstAccuracy : stats.allAccuracy) : 0
  const totalQuestions = questions.length
  const doneQuestions = questions.filter((q) => attemptedSet.has(q.id)).length

  return (
    <div className="exam-reading-page mgmt-page">
      <header className="exam-reading-header">
        <div>
          <h2><Layers size={18} /> 199 管综 · {rule.label}</h2>
          <p className="exam-reading-sub">
            题库 {totalQuestions} 题 · 全卷 {rule.questions} 题 / {rule.minutes} 分钟 · {rule.pointsPerQuestion} 分/题
            {daysLeft !== null && daysLeft >= 0 && <> · 距考试 {daysLeft} 天</>}
            {' '}· 建议 {slot.start} 开练
          </p>
        </div>
        <div className="exam-reading-head-ops">
          <span className={`reading-slot-chip${inSlot ? ' active' : ''}`}>
            <Clock size={13} /> 考场时段 {MGMT_RULES.paperStart}–{MGMT_RULES.paperEnd}
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
        <OverviewStat label="题库进度" value={`${doneQuestions}/${totalQuestions}`} icon={<CheckCircle2 size={13} />} />
        <OverviewStat label="待复习错题" value={String(wrongNew.length)} icon={<Flame size={13} />} />
      </div>

      <div className="exam-vocab-tabs">
        {([
          { id: 'today', label: '今日计划' },
          { id: 'bank', label: '题库' },
          { id: 'wrong', label: '错题本' },
          { id: 'stats', label: '统计' },
        ] as { id: Tab; label: string }[]).map((t) => (
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
            <b>整套限时</b>
            <div className="reading-choice">
              {subject === 'math' ? (
                <>
                  <button className={profile.mathSeconds === 2700 ? 'active' : ''} onClick={() => void saveProfile({ mathSeconds: 2700 })}>45 min</button>
                  <button className={profile.mathSeconds === 3600 ? 'active' : ''} onClick={() => void saveProfile({ mathSeconds: 3600 })}>60 min</button>
                </>
              ) : (
                <>
                  <button className={profile.logicSeconds === 3000 ? 'active' : ''} onClick={() => void saveProfile({ logicSeconds: 3000 })}>50 min</button>
                  <button className={profile.logicSeconds === 3300 ? 'active' : ''} onClick={() => void saveProfile({ logicSeconds: 3300 })}>55 min</button>
                </>
              )}
            </div>
          </div>
          <div className="reading-settings-row">
            <b>单题均时</b>
            <span>{Math.floor(perQuestionSeconds(subject) / 60)} 分 {perQuestionSeconds(subject) % 60} 秒（{rule.minutes} 分钟 ÷ {rule.questions} 题推算）</span>
          </div>
          <div className="reading-settings-row">
            <b>非考场时段提示</b>
            <label className="reading-check">
              <input
                type="checkbox"
                checked={profile.slotHint}
                onChange={(e) => void saveProfile({ slotHint: e.target.checked })}
              />
              开始限时 / 整套时提示建议 {slot.start} 开练
            </label>
          </div>
          <div className="reading-settings-row">
            <b>题库</b>
            <span>版本 v{profile.bankVersion} · {totalQuestions} 题 · 已做 {doneQuestions} 题</span>
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

            {daysLeft !== null && daysLeft >= 0 && nextSet && (
              <section className="reading-plan-card">
                <div className="reading-plan-head">
                  <div>
                    <span className="reading-plan-phase">{PHASE_LABEL[phase]}</span>
                    <h3>
                      {phase === 'final'
                        ? `${nextSet.year} 年${rule.label} · 整套限时（考前保持手感）`
                        : phase === 'sprint'
                          ? `${nextSet.year} 年${rule.label} · 整套限时`
                          : phase === 'build'
                            ? `${nextSet.year} 年${rule.label} · 分块限时`
                            : `${nextSet.year} 年${rule.label} · 不限时精练`}
                    </h3>
                    <p>
                      {PHASE_HINT[phase]} · {phase === 'base' ? `建议单题 ${perQuestionSeconds(subject)} 秒` : `建议 ${slot.start} 开练`}
                    </p>
                  </div>
                  <div className="reading-plan-dday">
                    <b>D-{daysLeft}</b>
                    <span>{examDate}</span>
                  </div>
                </div>

                <div className="reading-plan-ops">
                  {(() => {
                    const block = blockSpecs(subject)[0]
                    const primaryMode = phase === 'base' ? 'drill' : phase === 'build' ? 'block' : 'set'
                    const ops = [
                      {
                        key: 'drill',
                        label: '不限时精练',
                        run: () => startDrill(nextSet.list, `${nextSet.year} 年${rule.label}精练`),
                      },
                      {
                        key: 'block',
                        label: `${block.label} · 限时 ${fmtMinutes(estimateSeconds(subject, block.to - block.from + 1))}`,
                        run: () => startBlock(nextSet.year, block.from, block.to, block.label),
                      },
                      {
                        key: 'set',
                        label: `整套 · ${fmtMinutes(paperSeconds)}`,
                        run: () => startSet(nextSet.year),
                      },
                    ]
                    // 阶段决定主按钮：基础期求准、强化期练节奏、冲刺期上整卷
                    ops.sort((a, b) => (a.key === primaryMode ? -1 : b.key === primaryMode ? 1 : 0))
                    return ops.map((op) => (
                      <button
                        key={op.key}
                        className={op.key === primaryMode ? 'exam-primary-btn' : 'exam-ghost-btn'}
                        onClick={op.run}
                        disabled={starting}
                      >
                        {op.key === primaryMode && <Play size={14} />} {op.label}
                      </button>
                    ))
                  })()}
                  {wrongNew.length > 0 && (
                    <button className="exam-ghost-btn" onClick={() => startWrong(wrongNew.map((w) => w.questionId))} disabled={starting}>
                      <RotateCw size={13} /> 错题 {wrongNew.length}
                    </button>
                  )}
                </div>

                <div className="mgmt-plan-recap">
                  <span>整套：{nextSet.list.length} 题 / {fmtMinutes(paperSeconds)} / 满分 {fullScoreOf(subject, nextSet.list.length)}</span>
                  <span>当前时段：{inSlot ? '考场时段内，建议按真实顺序作答' : `非考场时段（建议 ${slot.start}–${slot.end}）`}</span>
                  <span>已完成套卷：{completedSetYears.length}/{years.length}</span>
                </div>
              </section>
            )}

            {daysLeft !== null && daysLeft >= 0 && !nextSet && (
              <div className="reading-empty">
                <CheckCircle2 size={28} />
                <b>题库为空</b>
                <p>请运行 npm run build:mgmt 重新生成题库，或在设置里点「重新导入」。</p>
              </div>
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
                    <span>{s.score}/{s.fullScore} 分</span>
                    <span>{s.correctCount}/{s.questionCount} 题</span>
                    {s.overtime && <span className="reading-overtime">超时</span>}
                    <button className="exam-ghost-btn" onClick={() => void openReview(s)}>复盘</button>
                  </div>
                ))}
              </section>
            )}
          </div>
        )}

        {tab === 'bank' && (
          <div className="reading-bank mgmt-bank">
            {years.map((year) => {
              const list = byYear.get(year) || []
              const done = list.filter((q) => attemptedSet.has(q.id)).length
              const isDone = completedSetYears.includes(year)
              const expanded = openYear === year
              return (
                <section className="reading-year" key={year}>
                  <div className="reading-year-head">
                    <div>
                      <b>{year}</b>
                      <span>{rule.label} {list.length} 题</span>
                      <span>{done}/{list.length} 题做过</span>
                      {isDone
                        ? <span className="reading-done-tag">整套已完成</span>
                        : <span className="reading-todo-tag">整套未做</span>}
                    </div>
                    <div className="mgmt-year-ops">
                      <button className="exam-ghost-btn" onClick={() => setOpenYear(expanded ? null : year)}>
                        {expanded ? '收起题号' : '题号'}
                      </button>
                      <button className="exam-primary-btn" onClick={() => startSet(year)} disabled={starting || list.length === 0}>
                        <Play size={13} /> 整套 {fmtMinutes(paperSeconds)}
                      </button>
                    </div>
                  </div>

                  <div className="mgmt-block-row">
                    {blockSpecs(subject).map((b) => {
                      const count = list.filter((q) => q.qno >= b.from && q.qno <= b.to).length
                      return (
                        <button
                          key={b.key}
                          className="mgmt-block-chip"
                          onClick={() => startBlock(year, b.from, b.to, b.label)}
                          disabled={starting || count === 0}
                        >
                          <b>{b.label}</b>
                          <span>{count} 题 · 限时 {fmtMinutes(estimateSeconds(subject, count))}</span>
                        </button>
                      )
                    })}
                  </div>

                  {expanded && (
                    <div className="mgmt-q-grid">
                      {list.map((q) => (
                        <button
                          key={q.id}
                          className={`mgmt-q-cell${attemptedSet.has(q.id) ? ' done' : ''}${wrongbook.some((w) => w.questionId === q.id && w.status === 'new') ? ' wrong' : ''}`}
                          title={`${q.year} 年第 ${q.qno} 题 · ${q.topic}${q.knowledge ? ` · ${q.knowledge}` : ''}`}
                          onClick={() => startDrill([q], `${q.year} 年第 ${q.qno} 题`)}
                          disabled={starting}
                        >
                          {q.qno}
                        </button>
                      ))}
                    </div>
                  )}
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
              {wrongNew.length > 0 && (
                <button className="exam-primary-btn" onClick={() => startWrong(wrongNew.map((w) => w.questionId))} disabled={starting}>
                  <RotateCw size={13} /> 重做待复习 {wrongNew.length} 题
                </button>
              )}
            </div>
            {wrongbook.filter((w) => wrongFilter === 'all' || w.status === wrongFilter).length === 0 && (
              <div className="reading-empty">
                <CheckCircle2 size={28} />
                <b>没有符合条件的错题</b>
                <p>交卷后答错和未答的题会自动进来；同一题连对两次标记为已掌握。</p>
              </div>
            )}
            {wrongbook
              .filter((w) => wrongFilter === 'all' || w.status === wrongFilter)
              .map((w) => (
                <WrongRow
                  key={w.id}
                  item={w}
                  onRedo={() => startWrong([w.questionId], `错题 ${w.year} 年第 ${w.qno} 题`)}
                  onGrasp={async () => {
                    await setMgmtWrongStatus(w.questionId, 'grasped')
                    useExamMgmtStore.getState().markDirty()
                    await refreshWrongbook()
                    void refreshStats(subject)
                  }}
                  onRemove={async () => {
                    if (!window.confirm('从错题本移除？')) return
                    await removeMgmtWrong(w.questionId)
                    useExamMgmtStore.getState().markDirty()
                    await refreshWrongbook()
                    void refreshStats(subject)
                  }}
                  onReason={async (reason) => {
                    await updateMgmtWrongReason(w.questionId, reason, w.note)
                    useExamMgmtStore.getState().markDirty()
                    await refreshWrongbook()
                  }}
                />
              ))}
          </div>
        )}

        {tab === 'stats' && (
          <div className="reading-stats">
            <div className="reading-stats-mode">
              <button className={statsMode === 'first' ? 'active' : ''} onClick={() => setStatsMode('first')}>首刷</button>
              <button className={statsMode === 'all' ? 'active' : ''} onClick={() => setStatsMode('all')}>含重做</button>
              <span>正确率 {pct(correctRate)} · 首刷按每题最早一次作答统计</span>
            </div>

            <div className="reading-stat-cards">
              <StatCard label="正确率" value={pct(correctRate)} />
              <StatCard label="已答题数" value={`${stats?.questionsAnswered ?? 0}/${totalQuestions}`} />
              <StatCard label="平均每题" value={stats?.avgMs ? `${Math.round(stats.avgMs / 1000)}s` : '—'} />
              <StatCard label="限时完成率" value={pct(stats?.timedCompletionRate)} />
              <StatCard label={`套卷平均分`} value={stats?.setAvgScore === null || !stats ? '—' : `${stats.setAvgScore.toFixed(1)}/${rule.fullScore}`} />
              <StatCard label="考场时段练习" value={pct(stats?.slotRatio)} />
              <StatCard label="考场时段正确率" value={pct(stats?.slotAccuracy)} />
              <StatCard label="非考场时段正确率" value={pct(stats?.offSlotAccuracy)} />
            </div>

            <StatBars title="按年份正确率（首刷）" rows={stats?.byYear ?? []} />
            <StatBars
              title="按题型正确率（首刷）"
              rows={(stats?.byQtype ?? []).map((r) => ({ ...r, label: QTYPE_LABEL[r.label] || r.label }))}
            />
            <StatBars title="按考点正确率（首刷）" rows={stats?.byTopic ?? []} />

            <div className="reading-stat-reasons">
              <b>错因分布（待复习）</b>
              {(stats?.wrongByReason ?? []).length === 0 && <span>暂无</span>}
              {(stats?.wrongByReason ?? []).map((r) => (
                <span key={r.reason}>{REASON_LABEL[r.reason] || '未标注'} {r.count}</span>
              ))}
            </div>

            {stats && stats.disputedCount > 0 && (
              <div className="reading-stat-disputed">
                <AlertTriangle size={14} /> 题库含 {stats.disputedCount} 道答案存疑题，两个答案均判对；复盘会显示来源说明。
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
  item: MgmtWrongItem
  onRedo: () => void
  onGrasp: () => void
  onRemove: () => void
  onReason: (reason: string) => void
}) {
  return (
    <div className={`reading-wrong-row${item.status === 'grasped' ? ' grasped' : ''}`}>
      <div className="reading-wrong-main">
        <div className="reading-wrong-head">
          <b>{item.year} 年第 {item.qno} 题</b>
          <span className={`reading-wrong-status ${item.status}`}>{item.status === 'grasped' ? '已掌握' : '待复习'}</span>
          {item.disputed && <span className="reading-disputed-badge">存疑</span>}
          {item.hasFigure && <span className="mgmt-figure-tag">原卷含图</span>}
          <span>错 {item.wrongCount} 次</span>
          <span>你 {item.userAnswer || '未答'} / 对 {item.answer}{item.answerAlt ? ` 或 ${item.answerAlt}` : ''}</span>
          {item.topic && <span>{item.topic}</span>}
        </div>
        <p className="reading-wrong-stem">{item.stem}</p>
        <div className="reading-wrong-ops">
          <label>
            错因
            <select value={item.reason} onChange={(e) => onReason(e.target.value)}>
              <option value="">未标注</option>
              <option value="concept">概念不清</option>
              <option value="calc">计算失误</option>
              <option value="typenew">题型没见过</option>
              <option value="csd">充分性陷阱</option>
              <option value="read">读题偏差</option>
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
          <p>{item.explanation}</p>
        </details>
      )}
    </div>
  )
}
