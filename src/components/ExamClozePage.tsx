/**
 * 英语二完形填空刷题页。
 *
 * Tab：题库 / 错题本 / 统计；作答与复盘整页切换（TopBar 已 hideChrome）。
 * 计时与考场时段：完形建议 14:00 开始、10–15 分钟完成；记录 in_exam_slot。
 */
import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, BookOpen, CheckCircle2, Clock, Cloud, FileText, Flame, Play,
  RotateCw, Target, X,
} from 'lucide-react'
import {
  abandonClozeSession,
  createClozeSession,
  fetchClozeSessionAttempts,
  fetchClozeSessionQuestions,
  fetchOngoingClozeSessions,
  isInExamSlot,
  removeClozeWrong,
  setClozeWrongStatus,
  updateClozeWrongReason,
} from '../lib/exam-cloze-db'
import type {
  ClozeAttempt,
  ClozePassageWithQuestions,
  ClozeQuestionWithPassage,
  ClozeSession as ClozeSessionRow,
  ClozeWrongItem,
} from '../lib/exam-cloze-db'
import { useExamClozeStore } from '../stores/exam-cloze-store'
import { localDateStr } from '../lib/utils'
import { ClozeSession } from './ClozeSession'
import { ClozeReview } from './ClozeReview'

type Tab = 'bank' | 'wrong' | 'stats'
type View =
  | { kind: 'list' }
  | { kind: 'session'; session: ClozeSessionRow; questions: ClozeQuestionWithPassage[]; attempts: ClozeAttempt[] }
  | { kind: 'review'; session: ClozeSessionRow; questions: ClozeQuestionWithPassage[]; attempts: ClozeAttempt[] }

const TABS: { id: Tab; label: string }[] = [
  { id: 'bank', label: '题库' },
  { id: 'wrong', label: '错题本' },
  { id: 'stats', label: '统计' },
]

const MODE_LABEL: Record<string, string> = {
  close: '精读',
  timed: '限时',
  wrong: '错题重做',
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

const REASON_LABEL: Record<string, string> = {
  unmarked: '未标注',
  ...Object.fromEntries(REASONS.filter((r) => r.value).map((r) => [r.value, r.label])),
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

function fmtMin(ms: number): string {
  const total = Math.max(0, Math.round(ms / 60000))
  return total < 60 ? `${total}min` : `${Math.floor(total / 60)}h${String(total % 60).padStart(2, '0')}`
}

function fmtLimit(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function fmtDate(value: string): string {
  if (!value) return ''
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return value.slice(5, 16)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function fmtContext(value: string): string {
  return value.replace(/\{\{\d+\}\}/g, '____')
}

export function ExamClozePage() {
  const {
    loaded, loading, lastError, passages, profile, examDate, wrongbook, stats, completedKeys,
    loadFromDb, clearError, refreshWrongbook, refreshStats, refreshProgress, reimportBank,
    backupToCloud, restoreFromCloud,
  } = useExamClozeStore()
  const [tab, setTab] = useState<Tab>('bank')
  const [view, setView] = useState<View>({ kind: 'list' })
  const [resumeSessions, setResumeSessions] = useState<ClozeSessionRow[]>([])
  const [starting, setStarting] = useState(false)
  const [message, setMessage] = useState('')
  const [wrongFilter, setWrongFilter] = useState<'all' | 'new' | 'grasped'>('new')

  useEffect(() => {
    void loadFromDb()
  }, [loadFromDb])

  useEffect(() => {
    if (!loaded) return
    let alive = true
    fetchOngoingClozeSessions()
      .then((sessions) => { if (alive) setResumeSessions(sessions) })
      .catch(() => { /* 未完成会话读取失败不阻塞页面 */ })
    return () => { alive = false }
  }, [loaded])

  const refreshOngoing = async () => {
    try {
      setResumeSessions(await fetchOngoingClozeSessions())
    } catch {
      // 忽略
    }
  }

  const completedSet = useMemo(() => new Set(completedKeys), [completedKeys])
  const wrongNew = wrongbook.filter((w) => w.status === 'new')
  const visibleWrong = wrongbook.filter((w) => wrongFilter === 'all' || w.status === wrongFilter)
  const examDays = examDate ? daysUntil(examDate, localDateStr()) : null

  const ensureNoOngoing = (): boolean => {
    if (resumeSessions.length === 0) return true
    setMessage('有未完成的完形练习，请先继续或作废后再开始新的练习')
    return false
  }

  const startPassage = async (passage: ClozePassageWithQuestions, mode: 'close' | 'timed') => {
    if (!ensureNoOngoing() || starting) return
    if (passage.questions.length !== 20) {
      setMessage('该年题库不完整（应为 20 空），请先重新导入题库')
      return
    }
    setStarting(true)
    setMessage('')
    try {
      const session = await createClozeSession({
        mode,
        scope: passage.key,
        questionIds: passage.questions.map((q) => q.id),
        limitSeconds: mode === 'timed' ? profile.timedSeconds : 0,
        inExamSlot: isInExamSlot(new Date(), profile.examSlotStart, profile.examSlotEnd),
      })
      const [questions, attempts] = await Promise.all([
        fetchClozeSessionQuestions(session.id),
        fetchClozeSessionAttempts(session.id),
      ])
      useExamClozeStore.getState().markDirty()
      setView({ kind: 'session', session, questions, attempts })
      await refreshOngoing()
    } catch (err) {
      setMessage(`开始练习失败：${err instanceof Error ? err.message : String(err)}`)
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
      const session = await createClozeSession({
        mode: 'wrong',
        scope: passageKey,
        questionIds,
        limitSeconds: 0,
        inExamSlot: isInExamSlot(new Date(), profile.examSlotStart, profile.examSlotEnd),
      })
      const [questions, attempts] = await Promise.all([
        fetchClozeSessionQuestions(session.id),
        fetchClozeSessionAttempts(session.id),
      ])
      useExamClozeStore.getState().markDirty()
      setView({ kind: 'session', session, questions, attempts })
      await refreshOngoing()
    } catch (err) {
      setMessage(`开始练习失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setStarting(false)
    }
  }

  const resumeSession = async (session: ClozeSessionRow) => {
    setMessage('')
    try {
      const [questions, attempts] = await Promise.all([
        fetchClozeSessionQuestions(session.id),
        fetchClozeSessionAttempts(session.id),
      ])
      setView({ kind: 'session', session, questions, attempts })
    } catch (err) {
      setMessage(`继续练习失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const abandon = async (session: ClozeSessionRow) => {
    if (!window.confirm('作废这次未完成练习？已作答记录会保留在会话中，但不计入统计。')) return
    try {
      await abandonClozeSession(session.id)
      useExamClozeStore.getState().markDirty()
      await refreshOngoing()
      await refreshStats()
      setMessage('已作废未完成练习')
    } catch (err) {
      setMessage(`作废失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleSubmitted = async (session: ClozeSessionRow) => {
    useExamClozeStore.getState().markDirty()
    try {
      const [questions, attempts] = await Promise.all([
        fetchClozeSessionQuestions(session.id),
        fetchClozeSessionAttempts(session.id),
      ])
      await refreshOngoing()
      setView({ kind: 'review', session, questions, attempts })
      void refreshWrongbook()
      void refreshStats()
      void refreshProgress()
    } catch (err) {
      setMessage(`交卷已写入，但复盘加载失败：${err instanceof Error ? err.message : String(err)}。请到题库页重新打开复盘。`)
      setView({ kind: 'list' })
      await refreshOngoing()
      void refreshStats()
    }
  }

  const openReview = async (session: ClozeSessionRow) => {
    try {
      const [questions, attempts] = await Promise.all([
        fetchClozeSessionQuestions(session.id),
        fetchClozeSessionAttempts(session.id),
      ])
      setView({ kind: 'review', session, questions, attempts })
    } catch (err) {
      setMessage(`打开复盘失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const exitSession = () => {
    setView({ kind: 'list' })
    void refreshOngoing()
    void refreshProgress()
  }

  const handleReimport = async () => {
    if (!window.confirm('重新导入完形题库？已有练习记录会保留，题库文字会按最新版本更新。')) return
    try {
      const result = await reimportBank()
      setMessage(`题库已重导：${result.passages} 篇 / ${result.questions} 空`)
    } catch (err) {
      setMessage(`重导失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleBackup = async () => {
    try {
      const result = await backupToCloud()
      setMessage(`已备份到云盘：${result.path}`)
    } catch (err) {
      setMessage(`备份失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleRestore = async () => {
    if (!window.confirm('从云盘恢复会覆盖本机完形练习记录，确定继续？')) return
    try {
      const result = await restoreFromCloud()
      setMessage(result.message)
    } catch (err) {
      setMessage(`恢复失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const onReason = async (questionId: number, reason: string) => {
    const item = wrongbook.find((w) => w.questionId === questionId)
    await updateClozeWrongReason(questionId, reason, item?.note || '')
    useExamClozeStore.getState().markDirty()
    await refreshWrongbook()
  }

  const onGrasp = async (item: ClozeWrongItem) => {
    await setClozeWrongStatus(item.questionId, item.status === 'new' ? 'grasped' : 'new')
    useExamClozeStore.getState().markDirty()
    await refreshWrongbook()
  }

  const onRemove = async (item: ClozeWrongItem) => {
    if (!window.confirm('从错题本移除这一空？')) return
    await removeClozeWrong(item.questionId)
    useExamClozeStore.getState().markDirty()
    await refreshWrongbook()
  }

  if (view.kind === 'session') {
    return (
      <ClozeSession
        session={view.session}
        questions={view.questions}
        initialAttempts={view.attempts}
        onExit={exitSession}
        onSubmitted={handleSubmitted}
      />
    )
  }

  if (view.kind === 'review') {
    return (
      <ClozeReview
        session={view.session}
        questions={view.questions}
        attempts={view.attempts}
        wrongbook={wrongbook}
        bankByPassage={new Map(passages.map((p) => [p.key, p.questions]))}
        onBack={() => {
          setView({ kind: 'list' })
          void refreshWrongbook()
          void refreshStats()
          void refreshProgress()
        }}
        onRedoWrong={(passageKey, ids) => void startWrong(passageKey, ids)}
      />
    )
  }

  return (
    <div className="exam-reading-page">
      <div className="exam-reading-header">
        <BookOpen size={22} />
        <div>
          <h2>完形填空</h2>
          <p className="exam-reading-sub">英语二 · 20 空 · 10 分 · 建议 10–15 分钟</p>
        </div>
        <div className="exam-reading-head-ops">
          <span className="reading-slot-chip"><Clock size={12} /> 考场时段 {profile.examSlotStart}–{profile.examSlotEnd}</span>
          {examDays !== null && <span className="reading-slot-chip">距考试 {examDays} 天</span>}
          <button className="exam-ghost-btn" onClick={() => void handleReimport()}>
            <RotateCw size={13} /> 重导题库
          </button>
        </div>
      </div>

      {(lastError || message) && (
        <div className="reading-message">
          {lastError ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
          <span>{lastError || message}</span>
          <button className="exam-ghost-btn" onClick={() => { clearError(); setMessage('') }}>
            <X size={13} />
          </button>
        </div>
      )}

      <div className="reading-wrong-filter cloze-tabs">
        {TABS.map((item) => (
          <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
        <span>{loading ? '加载中…' : `${passages.length} 年 · ${passages.reduce((n, p) => n + p.questions.length, 0)} 空`}</span>
      </div>

      {tab === 'bank' && (
        <div className="reading-bank">
          {resumeSessions.length > 0 && (
            <div className="reading-resume">
              <AlertTriangle size={16} />
              <div>
                <b>有 {resumeSessions.length} 次未完成练习</b>
                <div className="reading-resume-row">
                  {resumeSessions[0] && (
                    <>
                      <span>{resumeSessions[0].scope} · {MODE_LABEL[resumeSessions[0].mode] || resumeSessions[0].mode}</span>
                      <button className="exam-primary-btn" onClick={() => void resumeSession(resumeSessions[0])}>
                        <Play size={13} /> 继续
                      </button>
                      <button className="exam-ghost-btn" onClick={() => void abandon(resumeSessions[0])}>作废</button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="reading-stat-cards">
            <div className="reading-stat-card"><span>已练篇目</span><b>{completedKeys.length}/5</b></div>
            <div className="reading-stat-card"><span>总正确率</span><b>{pct(stats?.accuracy)}</b></div>
            <div className="reading-stat-card"><span>未掌握错题</span><b>{wrongNew.length}</b></div>
            <div className="reading-stat-card"><span>练习次数</span><b>{stats?.totalSessions ?? 0}</b></div>
          </div>

          {!loaded && <div className="reading-empty"><b>正在加载完形题库…</b></div>}
          {loaded && passages.length === 0 && (
            <div className="reading-empty">
              <FileText size={24} />
              <b>题库为空</b>
              <p>运行 `npm run build:cloze` 生成题库，或点击右上角「重导题库」。</p>
            </div>
          )}

          {passages.map((passage) => {
            const done = completedSet.has(passage.key)
            const wrongCount = wrongbook.filter((w) => w.passageKey === passage.key && w.status === 'new').length
            return (
              <div className="reading-bank-row cloze-bank-row" key={passage.key}>
                <div className="reading-bank-title">
                  <b>{passage.year}</b>
                  <span>{passage.title}</span>
                </div>
                <div className="reading-bank-meta">
                  <span>20 空</span>
                  <span>{passage.wordCount} 词</span>
                  {wrongCount > 0 && <span className="reading-year-wrong">错题 {wrongCount}</span>}
                  {done && <span className="reading-done-tag">已练</span>}
                </div>
                <div className="reading-bank-ops">
                  <button className="exam-primary-btn" onClick={() => void startPassage(passage, 'timed')} disabled={starting}>
                    <Clock size={13} /> 限时 {fmtLimit(profile.timedSeconds)}
                  </button>
                  <button className="exam-ghost-btn" onClick={() => void startPassage(passage, 'close')} disabled={starting}>
                    精读
                  </button>
                </div>
              </div>
            )
          })}

          {(stats?.recent.length || 0) > 0 && (
            <div className="reading-recent">
              <div className="reading-section-title"><span>最近练习</span></div>
              {stats?.recent.map((session) => (
                <div className="reading-recent-row" key={session.id}>
                  <span className="reading-recent-mode">{MODE_LABEL[session.mode] || session.mode}</span>
                  <span>{fmtDate(session.startedAt)}</span>
                  <span>{session.correctCount}/{session.questionCount} 空</span>
                  <span>{session.score.toFixed(1)} 分</span>
                  {session.overtime && <span className="reading-overtime">超时</span>}
                  <button className="exam-ghost-btn" onClick={() => void openReview(session)}>复盘</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'wrong' && (
        <div className="reading-wrong">
          <div className="reading-wrong-filter">
            {(['new', 'grasped', 'all'] as const).map((value) => (
              <button key={value} className={wrongFilter === value ? 'active' : ''} onClick={() => setWrongFilter(value)}>
                {value === 'new' ? '未掌握' : value === 'grasped' ? '已掌握' : '全部'}
              </button>
            ))}
            <span>共 {wrongbook.length} 空</span>
          </div>
          {visibleWrong.length === 0 && (
            <div className="reading-empty">
              <CheckCircle2 size={24} />
              <b>没有记录</b>
              <p>做完完形后，答错/未答的空会自动进入错题本。</p>
            </div>
          )}
          {visibleWrong.map((item) => (
            <div className={`reading-wrong-row${item.status === 'grasped' ? ' grasped' : ''}`} key={item.id}>
              <div className="reading-wrong-head">
                <b>{item.year} 第 {item.seq} 空</b>
                <span>答案 {item.answer} · {item.answerWord}</span>
                <span className={`reading-wrong-status ${item.status}`}>{item.status === 'new' ? '未掌握' : '已掌握'}</span>
                <span>错 {item.wrongCount} 次</span>
              </div>
              <div className="reading-wrong-stem">{fmtContext(item.context)}</div>
              <div className="reading-wrong-ops">
                <label>
                  错因
                  <select value={item.reason || ''} onChange={(e) => void onReason(item.questionId, e.target.value)}>
                    {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </label>
                <button className="exam-primary-btn" onClick={() => void startWrong(item.passageKey, [item.questionId])}>
                  <Play size={13} /> 重做
                </button>
                <button className="exam-ghost-btn" onClick={() => void onGrasp(item)}>
                  {item.status === 'new' ? '标记已掌握' : '移回未掌握'}
                </button>
                <button className="exam-ghost-btn" onClick={() => void onRemove(item)}>
                  <X size={13} /> 移除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'stats' && (
        <div className="reading-stats">
          <div className="reading-stat-cards">
            <div className="reading-stat-card"><span>练习次数</span><b>{stats?.totalSessions ?? 0}</b></div>
            <div className="reading-stat-card"><span>总正确率</span><b>{pct(stats?.accuracy)}</b></div>
            <div className="reading-stat-card"><span>平均用时</span><b>{fmtMin(stats?.avgMs ?? 0)}</b></div>
            <div className="reading-stat-card"><span>今日正确率</span><b>{pct(stats?.todayAccuracy)}</b></div>
          </div>

          <div className="reading-stat-bars">
            <b>按年份</b>
            {(stats?.byYear.length || 0) === 0 && <span className="reading-stat-empty">暂无数据</span>}
            {stats?.byYear.map((row) => (
              <div className="reading-stat-bar-row" key={row.label}>
                <span className="reading-stat-bar-label">{row.label} 年</span>
                <div className="reading-stat-bar"><i style={{ width: `${Math.round(row.accuracy * 100)}%` }} /></div>
                <span className="reading-stat-bar-value">{Math.round(row.accuracy * 100)}% <small>{row.correct}/{row.total}</small></span>
              </div>
            ))}
          </div>

          <div className="reading-stat-bars">
            <b>考场时段</b>
            <div className="reading-stat-reasons">
              <span>时段内练习占比 <b>{pct(stats?.slotRatio)}</b></span>
              <span>时段内正确率 <b>{pct(stats?.slotAccuracy)}</b></span>
              <span>时段外正确率 <b>{pct(stats?.offSlotAccuracy)}</b></span>
              <span>限时完成率 <b>{pct(stats?.timedCompletionRate)}</b></span>
            </div>
            {(stats?.wrongByReason.length || 0) > 0 && (
              <div className="reading-stat-reasons">
                {stats?.wrongByReason.map((row) => (
                  <span key={row.reason}>{REASON_LABEL[row.reason] || row.reason} <b>{row.count}</b></span>
                ))}
              </div>
            )}
          </div>

          <div className="reading-recent">
            <div className="reading-section-title"><span>最近练习</span></div>
            {(stats?.recent.length || 0) === 0 && <div className="reading-stat-empty">暂无数据</div>}
            {stats?.recent.map((session) => (
              <div className="reading-recent-row" key={session.id}>
                <span className="reading-recent-mode">{MODE_LABEL[session.mode] || session.mode}</span>
                <span>{fmtDate(session.startedAt)}</span>
                <span>{session.correctCount}/{session.questionCount} 空</span>
                <span>{session.score.toFixed(1)} 分</span>
                <button className="exam-ghost-btn" onClick={() => void openReview(session)}>复盘</button>
              </div>
            ))}
          </div>

          <div className="reading-stat-bars">
            <b>数据</b>
            <div className="reading-stat-reasons">
              <span>已练篇目 <b>{stats?.practicedPassages ?? 0}/5</b></span>
              <span>总题数 <b>{stats?.totalQuestions ?? 0}</b></span>
              <span>今日练习 <b>{stats?.todaySessions ?? 0}</b> 次</span>
              <span>今日用时 <b>{fmtMin(stats?.todayMs ?? 0)}</b></span>
            </div>
          </div>

          <div className="reading-stat-bars">
            <b><Cloud size={13} /> 云同步</b>
            <div className="reading-stat-reasons">
              <button className="exam-ghost-btn" onClick={() => void handleBackup()}>备份到云盘</button>
              <button className="exam-ghost-btn" onClick={() => void handleRestore()}>从云盘恢复</button>
              <span>自动同步会随「设置 → 云同步」一起执行。</span>
            </div>
          </div>
        </div>
      )}

      {starting && <div className="reading-message"><Flame size={14} /> 正在准备练习…</div>}
      {tab === 'bank' && (
        <div className="reading-session-tip">
          <Target size={12} /> 完形在考场中位于 Section I，建议 14:00 开始、10–15 分钟完成；错题连续答对 2 次会自动转为「已掌握」。
        </div>
      )}
    </div>
  )
}
