/**
 * 199 管综（数学 / 逻辑）刷题数据层。
 *
 * 与 tasks / exam / exam_vocab / exam_reading 共用同一个 SQLite 文件，
 * 表以 exam_mgmt_ 前缀隔离。题库本体从 src/assets/exam-mgmt/mgmt-bank.json
 * 首启导入，用户数据（会话 / 作答 / 错题）单独存表。
 */
import Database from '@tauri-apps/plugin-sql'
import rawBank from '../assets/exam-mgmt/mgmt-bank.json?raw'
import { execWithRetry, insertRows } from './sql-util'

let _db: Database | null = null

export async function getExamMgmtDb(): Promise<Database> {
  if (!_db) _db = await Database.load('sqlite:easy-sail-postgrad-exam.db')
  return _db
}

// ========== 规则常量与时间推算 ==========

export type MgmtSubject = 'math' | 'logic'

export const MGMT_RULES = {
  paperStart: '08:30',
  paperEnd: '11:30',
  paperMinutes: 180,
  math: { label: '数学', questions: 25, minutes: 60, pointsPerQuestion: 3, fullScore: 75 },
  logic: { label: '逻辑', questions: 30, minutes: 55, pointsPerQuestion: 2, fullScore: 60 },
  /** 考场内的建议时段：数学先做、逻辑随后，与真实答题顺序一致 */
  slot: {
    math: { start: '08:30', end: '09:30' },
    logic: { start: '09:30', end: '10:25' },
  },
  /** 数学两种题型的分块题号 */
  blocks: [
    { key: 'ps', label: '问题求解', qtype: 'ps' as const, from: 1, to: 15, minutes: 36 },
    { key: 'csd', label: '条件充分性判断', qtype: 'csd' as const, from: 16, to: 25, minutes: 24 },
  ],
} as const

export function subjectRule(subject: MgmtSubject) {
  return MGMT_RULES[subject]
}

/** 单题平均秒数：数学 144s、逻辑 110s（由考场时长 ÷ 题量推算） */
export function perQuestionSeconds(subject: MgmtSubject): number {
  const rule = subjectRule(subject)
  return Math.round((rule.minutes * 60) / rule.questions)
}

/** 按题量推算限时秒数（向上取整到 10 秒，避免出现 8:07 这类怪数字） */
export function estimateSeconds(subject: MgmtSubject, count: number): number {
  if (count <= 0) return 0
  const raw = count * perQuestionSeconds(subject)
  return Math.ceil(raw / 10) * 10
}

/** 整套真卷限时（数学 60 分钟 / 逻辑 55 分钟） */
export function fullPaperSeconds(subject: MgmtSubject): number {
  return subjectRule(subject).minutes * 60
}

/** 一套题满分 */
export function fullScoreOf(subject: MgmtSubject, count: number): number {
  return count * subjectRule(subject).pointsPerQuestion
}

function toMinutes(value: string): number {
  const [h, m] = value.split(':').map((x) => Number(x))
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}

/** 当前是否在管综考场时段（08:30–11:30，上午场） */
export function isInMgmtSlot(date: Date): boolean {
  const now = date.getHours() * 60 + date.getMinutes()
  return now >= toMinutes(MGMT_RULES.paperStart) && now < toMinutes(MGMT_RULES.paperEnd)
}

/** 某科目的建议开考时刻，例如数学 08:30–09:30 */
export function suggestSlot(subject: MgmtSubject): { start: string; end: string } {
  return subject === 'math' ? MGMT_RULES.slot.math : MGMT_RULES.slot.logic
}

export type MgmtPhase = 'base' | 'build' | 'sprint' | 'final' | 'done'

/** 距考试天数 → 备考阶段；阶段决定今日推荐是分块练习还是整套限时 */
export function phaseForDays(daysLeft: number): MgmtPhase {
  if (daysLeft < 0) return 'done'
  if (daysLeft <= 14) return 'final'
  if (daysLeft <= 30) return 'sprint'
  if (daysLeft <= 60) return 'build'
  return 'base'
}

export const PHASE_LABEL: Record<MgmtPhase, string> = {
  base: '基础期',
  build: '强化期',
  sprint: '冲刺期',
  final: '考前两周',
  done: '已考完',
}

export const PHASE_HINT: Record<MgmtPhase, string> = {
  base: '先求准：分块不限时，逐题看解析',
  build: '练节奏：分块限时，数学 36+24 分钟、逻辑 5 题一组',
  sprint: '上强度：整套真卷限时，数学 60 分钟 / 逻辑 55 分钟',
  final: '只复盘：错题重做 + 隔天整套限时保持手感',
  done: '考试已结束，可回看统计与错题',
}

// ========== 类型 ==========

export type MgmtQType = 'ps' | 'csd' | 'logic'
export type MgmtSessionMode = 'drill' | 'timed' | 'set' | 'wrong'
export type MgmtSessionStatus = 'ongoing' | 'submitted' | 'abandoned'
export type MgmtWrongStatus = 'new' | 'grasped'

export interface MgmtQuestion {
  id: number
  key: string
  subject: MgmtSubject
  year: number
  qno: number
  qtype: MgmtQType
  topic: string
  stem: string
  options: string[]
  answer: string
  answerAlt: string
  disputed: boolean
  explanation: string
  knowledge: string
  hasFigure: boolean
  archived: boolean
}

export interface MgmtSession {
  id: string
  subject: MgmtSubject
  mode: MgmtSessionMode
  scope: string
  limitSeconds: number
  startedAt: string
  deadlineAt: string | null
  submittedAt: string | null
  elapsedMs: number
  questionCount: number
  answeredCount: number
  correctCount: number
  score: number
  fullScore: number
  overtime: boolean
  inExamSlot: boolean
  status: MgmtSessionStatus
}

export interface MgmtAttempt {
  id: number
  sessionId: string
  questionId: number
  userAnswer: string
  isCorrect: boolean
  durationMs: number
  flagged: boolean
  answeredAt: string
}

export interface MgmtWrongItem {
  id: number
  questionId: number
  questionKey: string
  subject: MgmtSubject
  year: number
  qno: number
  stem: string
  options: string[]
  answer: string
  answerAlt: string
  disputed: boolean
  qtype: MgmtQType
  topic: string
  knowledge: string
  explanation: string
  hasFigure: boolean
  userAnswer: string
  reason: string
  note: string
  status: MgmtWrongStatus
  wrongCount: number
  correctStreak: number
  lastReviewedAt: string | null
  addedAt: string
  updatedAt: string
}

export interface MgmtProfile {
  mathSeconds: number
  logicSeconds: number
  slotHint: boolean
  bankVersion: number
}

export interface MgmtStatBucket {
  label: string
  total: number
  correct: number
  accuracy: number
}

export interface MgmtStats {
  questionsAnswered: number
  todayAnswered: number
  todayAccuracy: number | null
  todaySessions: number
  todayMs: number
  firstAccuracy: number
  allAccuracy: number
  avgMs: number
  timedCompletionRate: number
  setAvgScore: number | null
  slotRatio: number
  slotAccuracy: number | null
  offSlotAccuracy: number | null
  byYear: MgmtStatBucket[]
  byTopic: MgmtStatBucket[]
  byQtype: MgmtStatBucket[]
  wrongByReason: { reason: string; count: number }[]
  recent: MgmtSession[]
  totalSessions: number
  disputedCount: number
}

export interface MgmtSnapshot {
  profile: MgmtProfile
  sessions: MgmtSession[]
  sessionQuestions: { sessionId: string; questionKey: string; sortOrder: number }[]
  attempts: {
    sessionId: string
    questionKey: string
    userAnswer: string
    isCorrect: boolean
    durationMs: number
    flagged: boolean
    answeredAt: string
  }[]
  wrongbook: {
    questionKey: string
    userAnswer: string
    reason: string
    note: string
    status: MgmtWrongStatus
    wrongCount: number
    correctStreak: number
    lastReviewedAt: string | null
    addedAt: string
    updatedAt: string
  }[]
}

// ========== 行转换 ==========

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map((x) => String(x)) : []
  } catch {
    return []
  }
}

function bool(value: unknown): boolean {
  return !!((value as number) ?? 0)
}

function rowToQuestion(row: Record<string, unknown>): MgmtQuestion {
  const subject = (row.subject as string) === 'logic' ? 'logic' : 'math'
  const qtype = (row.qtype as string) || (subject === 'math' ? 'ps' : 'logic')
  return {
    id: (row.id as number) ?? 0,
    key: (row.question_key as string) || '',
    subject,
    year: (row.year as number) ?? 0,
    qno: (row.qno as number) ?? 0,
    qtype: (['ps', 'csd', 'logic'].includes(qtype) ? qtype : 'ps') as MgmtQType,
    topic: (row.topic as string) || '',
    stem: (row.stem as string) || '',
    options: parseJsonArray(row.options),
    answer: (row.answer as string) || 'A',
    answerAlt: (row.answer_alt as string) || '',
    disputed: bool(row.disputed),
    explanation: (row.explanation as string) || '',
    knowledge: (row.knowledge as string) || '',
    hasFigure: bool(row.has_figure),
    archived: bool(row.archived),
  }
}

function rowToSession(row: Record<string, unknown>): MgmtSession {
  const subject = (row.subject as string) === 'logic' ? 'logic' : 'math'
  const mode = (row.mode as string) || 'drill'
  const status = (row.status as string) || 'ongoing'
  return {
    id: (row.id as string) || '',
    subject,
    mode: (['drill', 'timed', 'set', 'wrong'].includes(mode) ? mode : 'drill') as MgmtSessionMode,
    scope: (row.scope as string) || '',
    limitSeconds: (row.limit_seconds as number) ?? 0,
    startedAt: (row.started_at as string) || '',
    deadlineAt: (row.deadline_at as string) || null,
    submittedAt: (row.submitted_at as string) || null,
    elapsedMs: (row.elapsed_ms as number) ?? 0,
    questionCount: (row.question_count as number) ?? 0,
    answeredCount: (row.answered_count as number) ?? 0,
    correctCount: (row.correct_count as number) ?? 0,
    score: (row.score as number) ?? 0,
    fullScore: (row.full_score as number) ?? 0,
    overtime: bool(row.overtime),
    inExamSlot: bool(row.in_exam_slot),
    status: (['ongoing', 'submitted', 'abandoned'].includes(status) ? status : 'ongoing') as MgmtSessionStatus,
  }
}

function rowToAttempt(row: Record<string, unknown>): MgmtAttempt {
  return {
    id: (row.id as number) ?? 0,
    sessionId: (row.session_id as string) || '',
    questionId: (row.question_id as number) ?? 0,
    userAnswer: (row.user_answer as string) || '',
    isCorrect: bool(row.is_correct),
    durationMs: (row.duration_ms as number) ?? 0,
    flagged: bool(row.flagged),
    answeredAt: (row.answered_at as string) || '',
  }
}

function rowToProfile(row: Record<string, unknown>): MgmtProfile {
  return {
    mathSeconds: (row.math_seconds as number) ?? 3600,
    logicSeconds: (row.logic_seconds as number) ?? 3300,
    slotHint: bool(row.slot_hint ?? 1),
    bankVersion: (row.bank_version as number) ?? 0,
  }
}

// ========== 配置 ==========

const DEFAULT_PROFILE: MgmtProfile = {
  mathSeconds: 3600,
  logicSeconds: 3300,
  slotHint: true,
  bankVersion: 0,
}

export async function fetchMgmtProfile(): Promise<MgmtProfile> {
  const db = await getExamMgmtDb()
  const rows = await db.select<Record<string, unknown>[]>('SELECT * FROM exam_mgmt_profile WHERE id = 1')
  return rows.length ? rowToProfile(rows[0]) : { ...DEFAULT_PROFILE }
}

const PROFILE_FIELD_MAP: Record<keyof MgmtProfile, string> = {
  mathSeconds: 'math_seconds',
  logicSeconds: 'logic_seconds',
  slotHint: 'slot_hint',
  bankVersion: 'bank_version',
}

export async function updateMgmtProfile(updates: Partial<MgmtProfile>): Promise<void> {
  const db = await getExamMgmtDb()
  const sets: string[] = []
  const values: unknown[] = []
  let idx = 1
  for (const [key, col] of Object.entries(PROFILE_FIELD_MAP)) {
    if (!(key in updates)) continue
    sets.push(`${col} = $${idx++}`)
    const value = (updates as Record<string, unknown>)[key]
    values.push(typeof value === 'boolean' ? (value ? 1 : 0) : value)
  }
  if (sets.length === 0) return
  sets.push(`updated_at = $${idx++}`)
  values.push(new Date().toISOString())
  values.push(1)
  await db.execute(`UPDATE exam_mgmt_profile SET ${sets.join(', ')} WHERE id = $${idx}`, values)
}

// ========== 题库导入 ==========

interface BankQuestionJson {
  key: string
  subject: string
  year: number
  qno: number
  qtype: string
  topic?: string
  stem: string
  options: string[]
  answer: string
  answerAlt?: string
  disputed?: boolean
  explanation?: string
  knowledge?: string
  hasFigure?: boolean
}

interface BankJson {
  version: number
  questions: BankQuestionJson[]
}

let _bankCache: BankJson | null = null

function readBankJson(): BankJson {
  if (_bankCache) return _bankCache
  const parsed: unknown = JSON.parse(rawBank)
  if (!parsed || typeof parsed !== 'object') throw new Error('题库 JSON 格式异常')
  _bankCache = parsed as BankJson
  return _bankCache
}

export async function fetchMgmtQuestionCount(): Promise<number> {
  const db = await getExamMgmtDb()
  const rows = await db.select<{ count: number }[]>(
    'SELECT COUNT(*) AS count FROM exam_mgmt_questions WHERE archived = 0',
  )
  return rows[0]?.count ?? 0
}

export async function importMgmtBank(force = false): Promise<{ imported: boolean; questions: number }> {
  const db = await getExamMgmtDb()
  const bank = readBankJson()
  const profile = await fetchMgmtProfile()
  const count = await fetchMgmtQuestionCount()
  if (!force && count > 0 && profile.bankVersion >= bank.version) {
    return { imported: false, questions: count }
  }
  if (!bank.questions?.length) return { imported: false, questions: 0 }

  // 批量多值 INSERT + ON CONFLICT：既减少 IPC 往返，也保留已有题目 id
  //（attempts / wrongbook 用 question_id 关联，不能改成 INSERT OR REPLACE）
  const BATCH = 50
  const COLUMNS = 14
  for (let i = 0; i < bank.questions.length; i += BATCH) {
    const slice = bank.questions.slice(i, i + BATCH)
    const tuples: string[] = []
    const values: unknown[] = []
    for (const q of slice) {
      const s = values.length + 1
      tuples.push(`(${Array.from({ length: COLUMNS }, (_, c) => `$${s + c}`).join(',')},0)`)
      values.push(
        q.key, q.subject, q.year, q.qno, q.qtype, q.topic || '', q.stem,
        JSON.stringify(q.options || []), q.answer, q.answerAlt || '',
        q.disputed ? 1 : 0, q.explanation || '', q.knowledge || '', q.hasFigure ? 1 : 0,
      )
    }
    await execWithRetry(
      db,
      `INSERT INTO exam_mgmt_questions
         (question_key, subject, year, qno, qtype, topic, stem, options, answer, answer_alt,
          disputed, explanation, knowledge, has_figure, archived)
       VALUES ${tuples.join(',')}
       ON CONFLICT(question_key) DO UPDATE SET
         subject = excluded.subject, year = excluded.year, qno = excluded.qno,
         qtype = excluded.qtype, topic = excluded.topic, stem = excluded.stem,
         options = excluded.options, answer = excluded.answer, answer_alt = excluded.answer_alt,
         disputed = excluded.disputed, explanation = excluded.explanation,
         knowledge = excluded.knowledge, has_figure = excluded.has_figure,
         updated_at = datetime('now')`,
      values,
    )
  }

  await updateMgmtProfile({ bankVersion: bank.version })
  return { imported: true, questions: bank.questions.length }
}

export async function fetchMgmtQuestions(subject?: MgmtSubject): Promise<MgmtQuestion[]> {
  const db = await getExamMgmtDb()
  const rows = subject
    ? await db.select<Record<string, unknown>[]>(
        'SELECT * FROM exam_mgmt_questions WHERE archived = 0 AND subject = $1 ORDER BY year ASC, qno ASC',
        [subject],
      )
    : await db.select<Record<string, unknown>[]>(
        'SELECT * FROM exam_mgmt_questions WHERE archived = 0 ORDER BY subject ASC, year ASC, qno ASC',
      )
  return rows.map(rowToQuestion)
}

export async function fetchQuestionsByIds(ids: number[]): Promise<MgmtQuestion[]> {
  if (ids.length === 0) return []
  const db = await getExamMgmtDb()
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(',')
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT * FROM exam_mgmt_questions WHERE id IN (${placeholders})`,
    ids,
  )
  const order = new Map(ids.map((id, index) => [id, index]))
  return rows.map(rowToQuestion).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
}

// ========== 会话 ==========

function makeSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `mgmt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export async function createMgmtSession(input: {
  subject: MgmtSubject
  mode: MgmtSessionMode
  scope: string
  questionIds: number[]
  limitSeconds: number
  inExamSlot: boolean
}): Promise<MgmtSession> {
  const db = await getExamMgmtDb()
  const id = makeSessionId()
  const startedAt = new Date().toISOString()
  const deadlineAt = input.limitSeconds > 0
    ? new Date(Date.now() + input.limitSeconds * 1000).toISOString()
    : null
  const fullScore = fullScoreOf(input.subject, input.questionIds.length)
  await execWithRetry(
    db,
    `INSERT INTO exam_mgmt_sessions
       (id, subject, mode, scope, limit_seconds, started_at, deadline_at,
        question_count, full_score, in_exam_slot, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ongoing')`,
    [
      id, input.subject, input.mode, input.scope, input.limitSeconds, startedAt, deadlineAt,
      input.questionIds.length, fullScore, input.inExamSlot ? 1 : 0,
    ],
  )
  for (let i = 0; i < input.questionIds.length; i++) {
    await execWithRetry(
      db,
      'INSERT OR IGNORE INTO exam_mgmt_session_questions (session_id, question_id, sort_order) VALUES ($1,$2,$3)',
      [id, input.questionIds[i], i],
    )
  }
  return {
    id,
    subject: input.subject,
    mode: input.mode,
    scope: input.scope,
    limitSeconds: input.limitSeconds,
    startedAt,
    deadlineAt,
    submittedAt: null,
    elapsedMs: 0,
    questionCount: input.questionIds.length,
    answeredCount: 0,
    correctCount: 0,
    score: 0,
    fullScore,
    overtime: false,
    inExamSlot: input.inExamSlot,
    status: 'ongoing',
  }
}

export async function fetchMgmtSession(id: string): Promise<MgmtSession | null> {
  const db = await getExamMgmtDb()
  const rows = await db.select<Record<string, unknown>[]>('SELECT * FROM exam_mgmt_sessions WHERE id = $1', [id])
  return rows.length ? rowToSession(rows[0]) : null
}

export async function fetchOngoingMgmtSessions(subject?: MgmtSubject): Promise<MgmtSession[]> {
  const db = await getExamMgmtDb()
  const rows = subject
    ? await db.select<Record<string, unknown>[]>(
        "SELECT * FROM exam_mgmt_sessions WHERE status = 'ongoing' AND subject = $1 ORDER BY started_at DESC",
        [subject],
      )
    : await db.select<Record<string, unknown>[]>(
        "SELECT * FROM exam_mgmt_sessions WHERE status = 'ongoing' ORDER BY started_at DESC",
      )
  return rows.map(rowToSession)
}

export async function fetchSessionQuestions(sessionId: string): Promise<MgmtQuestion[]> {
  const db = await getExamMgmtDb()
  const rows = await db.select<{ question_id: number }[]>(
    'SELECT question_id FROM exam_mgmt_session_questions WHERE session_id = $1 ORDER BY sort_order ASC',
    [sessionId],
  )
  return fetchQuestionsByIds(rows.map((r) => r.question_id))
}

export async function upsertMgmtAttempt(input: {
  sessionId: string
  questionId: number
  userAnswer: string
  isCorrect: boolean
  durationMs: number
  flagged: boolean
}): Promise<void> {
  const db = await getExamMgmtDb()
  await execWithRetry(
    db,
    `INSERT INTO exam_mgmt_attempts
       (session_id, question_id, user_answer, is_correct, duration_ms, flagged, answered_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT(session_id, question_id) DO UPDATE SET
       user_answer = excluded.user_answer, is_correct = excluded.is_correct,
       duration_ms = excluded.duration_ms, flagged = excluded.flagged,
       answered_at = excluded.answered_at`,
    [
      input.sessionId, input.questionId, input.userAnswer, input.isCorrect ? 1 : 0,
      input.durationMs, input.flagged ? 1 : 0, new Date().toISOString(),
    ],
  )
}

export async function fetchSessionAttempts(sessionId: string): Promise<MgmtAttempt[]> {
  const db = await getExamMgmtDb()
  const rows = await db.select<Record<string, unknown>[]>(
    'SELECT * FROM exam_mgmt_attempts WHERE session_id = $1',
    [sessionId],
  )
  return rows.map(rowToAttempt)
}

export async function submitMgmtSession(sessionId: string, auto = false): Promise<MgmtSession | null> {
  const db = await getExamMgmtDb()
  const session = await fetchMgmtSession(sessionId)
  if (!session || session.status !== 'ongoing') return session
  const [questions, attempts] = await Promise.all([
    fetchSessionQuestions(sessionId),
    fetchSessionAttempts(sessionId),
  ])
  const attemptByQuestion = new Map(attempts.map((a) => [a.questionId, a]))
  const answered = attempts.filter((a) => a.userAnswer !== '')
  const correct = attempts.filter((a) => a.isCorrect)
  const now = Date.now()
  const deadlineMs = session.deadlineAt ? new Date(session.deadlineAt).getTime() : 0
  const overtime = auto || (deadlineMs > 0 && now > deadlineMs)
  const rawElapsed = Math.max(0, now - new Date(session.startedAt).getTime())
  const elapsedMs = session.limitSeconds > 0
    ? Math.min(rawElapsed, session.limitSeconds * 1000)
    : rawElapsed
  const score = correct.length * subjectRule(session.subject).pointsPerQuestion

  await db.execute(
    `UPDATE exam_mgmt_sessions SET
       submitted_at = $1, elapsed_ms = $2, answered_count = $3, correct_count = $4,
       score = $5, overtime = $6, status = 'submitted'
     WHERE id = $7`,
    [new Date().toISOString(), elapsedMs, answered.length, correct.length, score, overtime ? 1 : 0, sessionId],
  )

  for (const question of questions) {
    const attempt = attemptByQuestion.get(question.id)
    if (!attempt || !attempt.isCorrect) {
      const reason = attempt?.userAnswer ? '' : 'time'
      await execWithRetry(
        db,
        `INSERT INTO exam_mgmt_wrongbook
           (question_id, user_answer, reason, status, wrong_count, correct_streak)
         VALUES ($1, $2, $3, 'new', 1, 0)
         ON CONFLICT(question_id) DO UPDATE SET
           wrong_count = wrong_count + 1, user_answer = excluded.user_answer,
           reason = CASE WHEN excluded.reason = '' THEN reason ELSE excluded.reason END,
           status = 'new', correct_streak = 0, updated_at = datetime('now')`,
        [question.id, attempt?.userAnswer || '', reason],
      )
    } else {
      await execWithRetry(
        db,
        `UPDATE exam_mgmt_wrongbook SET
           correct_streak = correct_streak + 1,
           status = CASE WHEN correct_streak + 1 >= 2 THEN 'grasped' ELSE status END,
           last_reviewed_at = datetime('now'), updated_at = datetime('now')
         WHERE question_id = $1`,
        [question.id],
      )
    }
  }

  return fetchMgmtSession(sessionId)
}

export async function abandonMgmtSession(sessionId: string): Promise<void> {
  const db = await getExamMgmtDb()
  await db.execute(
    "UPDATE exam_mgmt_sessions SET status = 'abandoned', submitted_at = $1 WHERE id = $2 AND status = 'ongoing'",
    [new Date().toISOString(), sessionId],
  )
}

/** 已交卷套卷的年份（题库页标记「已完成」） */
export async function fetchCompletedSetYears(subject: MgmtSubject): Promise<number[]> {
  const db = await getExamMgmtDb()
  const rows = await db.select<{ scope: string }[]>(
    "SELECT DISTINCT scope FROM exam_mgmt_sessions WHERE status = 'submitted' AND mode = 'set' AND subject = $1",
    [subject],
  )
  return rows.map((r) => Number(r.scope)).filter((n) => Number.isFinite(n))
}

/** 已作答过的题（题库页标记「做过」） */
export async function fetchAttemptedQuestionIds(subject: MgmtSubject): Promise<number[]> {
  const db = await getExamMgmtDb()
  const rows = await db.select<{ question_id: number }[]>(
    `SELECT DISTINCT a.question_id
     FROM exam_mgmt_attempts a
     JOIN exam_mgmt_sessions s ON s.id = a.session_id AND s.status = 'submitted'
     JOIN exam_mgmt_questions q ON q.id = a.question_id
     WHERE q.subject = $1 AND a.user_answer <> ''`,
    [subject],
  )
  return rows.map((r) => r.question_id)
}

// ========== 错题本 ==========

export async function fetchMgmtWrongbook(subject: MgmtSubject): Promise<MgmtWrongItem[]> {
  const db = await getExamMgmtDb()
  const rows = await db.select<Record<string, unknown>[]>(`
    SELECT w.*, q.question_key, q.subject, q.year, q.qno, q.stem, q.options, q.answer,
           q.answer_alt, q.disputed, q.qtype, q.topic, q.knowledge, q.explanation, q.has_figure
    FROM exam_mgmt_wrongbook w
    JOIN exam_mgmt_questions q ON q.id = w.question_id
    WHERE q.subject = $1
    ORDER BY CASE WHEN w.status = 'grasped' THEN 1 ELSE 0 END ASC, w.added_at DESC
  `, [subject])
  return rows.map((row) => {
    const qtype = (row.qtype as string) || 'ps'
    return {
      id: (row.id as number) ?? 0,
      questionId: (row.question_id as number) ?? 0,
      questionKey: (row.question_key as string) || '',
      subject: ((row.subject as string) === 'logic' ? 'logic' : 'math') as MgmtSubject,
      year: (row.year as number) ?? 0,
      qno: (row.qno as number) ?? 0,
      stem: (row.stem as string) || '',
      options: parseJsonArray(row.options),
      answer: (row.answer as string) || '',
      answerAlt: (row.answer_alt as string) || '',
      disputed: bool(row.disputed),
      qtype: (['ps', 'csd', 'logic'].includes(qtype) ? qtype : 'ps') as MgmtQType,
      topic: (row.topic as string) || '',
      knowledge: (row.knowledge as string) || '',
      explanation: (row.explanation as string) || '',
      hasFigure: bool(row.has_figure),
      userAnswer: (row.user_answer as string) || '',
      reason: (row.reason as string) || '',
      note: (row.note as string) || '',
      status: ((row.status as string) === 'grasped' ? 'grasped' : 'new') as MgmtWrongStatus,
      wrongCount: (row.wrong_count as number) ?? 1,
      correctStreak: (row.correct_streak as number) ?? 0,
      lastReviewedAt: (row.last_reviewed_at as string) || null,
      addedAt: (row.added_at as string) || '',
      updatedAt: (row.updated_at as string) || '',
    }
  })
}

export async function updateMgmtWrongReason(questionId: number, reason: string, note: string): Promise<void> {
  const db = await getExamMgmtDb()
  await db.execute(
    "UPDATE exam_mgmt_wrongbook SET reason = $1, note = $2, updated_at = datetime('now') WHERE question_id = $3",
    [reason, note, questionId],
  )
}

export async function setMgmtWrongStatus(questionId: number, status: MgmtWrongStatus): Promise<void> {
  const db = await getExamMgmtDb()
  await db.execute(
    "UPDATE exam_mgmt_wrongbook SET status = $1, updated_at = datetime('now') WHERE question_id = $2",
    [status, questionId],
  )
}

export async function removeMgmtWrong(questionId: number): Promise<void> {
  const db = await getExamMgmtDb()
  await db.execute('DELETE FROM exam_mgmt_wrongbook WHERE question_id = $1', [questionId])
}

// ========== 统计 ==========

interface AttemptStatRow {
  question_id: number
  user_answer: string
  is_correct: number
  duration_ms: number
  started_at: string
  qtype: string
  topic: string
  year: number
  in_exam_slot: number
  subject: string
}

export async function fetchMgmtStats(subject: MgmtSubject): Promise<MgmtStats> {
  const db = await getExamMgmtDb()
  const [sessionRows, attemptRows, wrongRows, disputedRows] = await Promise.all([
    db.select<Record<string, unknown>[]>(
      "SELECT * FROM exam_mgmt_sessions WHERE status = 'submitted' AND subject = $1 ORDER BY started_at DESC",
      [subject],
    ),
    db.select<AttemptStatRow[]>(`
      SELECT a.question_id, a.user_answer, a.is_correct, a.duration_ms, s.started_at,
             q.qtype, q.topic, q.year, s.in_exam_slot, q.subject
      FROM exam_mgmt_attempts a
      JOIN exam_mgmt_sessions s ON s.id = a.session_id AND s.status = 'submitted'
      JOIN exam_mgmt_questions q ON q.id = a.question_id AND q.archived = 0
      WHERE q.subject = $1
      ORDER BY a.answered_at ASC, a.id ASC
    `, [subject]),
    db.select<{ reason: string; count: number }[]>(`
      SELECT w.reason, COUNT(*) AS count
      FROM exam_mgmt_wrongbook w
      JOIN exam_mgmt_questions q ON q.id = w.question_id
      WHERE q.subject = $1 AND w.status = 'new'
      GROUP BY w.reason
    `, [subject]),
    db.select<{ count: number }[]>(
      'SELECT COUNT(*) AS count FROM exam_mgmt_questions WHERE disputed = 1 AND archived = 0 AND subject = $1',
      [subject],
    ),
  ])

  const sessions = sessionRows.map(rowToSession)
  const firstByQuestion = new Map<number, AttemptStatRow>()
  for (const row of attemptRows) {
    if (!firstByQuestion.has(row.question_id)) firstByQuestion.set(row.question_id, row)
  }
  const first = [...firstByQuestion.values()].filter((r) => (r.user_answer || '') !== '')
  const answeredAll = attemptRows.filter((r) => (r.user_answer || '') !== '')
  const correctAll = answeredAll.filter((r) => !!r.is_correct)

  const bucket = (rows: AttemptStatRow[], key: (r: AttemptStatRow) => string): MgmtStatBucket[] => {
    const map = new Map<string, { total: number; correct: number }>()
    for (const row of rows) {
      if (!row.user_answer) continue
      const k = key(row)
      const item = map.get(k) || { total: 0, correct: 0 }
      item.total++
      if (row.is_correct) item.correct++
      map.set(k, item)
    }
    return [...map.entries()]
      .map(([label, v]) => ({ label, total: v.total, correct: v.correct, accuracy: v.total ? v.correct / v.total : 0 }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }

  const accuracyOf = (rows: AttemptStatRow[]): number | null => {
    const answered = rows.filter((r) => r.user_answer)
    return answered.length ? answered.filter((r) => r.is_correct).length / answered.length : null
  }

  const todayKey = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()
  const isToday = (value: string): boolean => {
    if (!value) return false
    const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return false
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === todayKey
  }
  const todaySessions = sessions.filter((s) => isToday(s.startedAt))
  const todayRows = attemptRows.filter((r) => isToday(r.started_at))
  const timedSessions = sessions.filter((s) => s.mode === 'timed' || s.mode === 'set')
  const setSessions = sessions.filter((s) => s.mode === 'set')

  return {
    questionsAnswered: first.length,
    todayAnswered: todayRows.filter((r) => r.user_answer).length,
    todayAccuracy: accuracyOf(todayRows),
    todaySessions: todaySessions.length,
    todayMs: todaySessions.reduce((sum, s) => sum + s.elapsedMs, 0),
    firstAccuracy: first.length ? first.filter((r) => r.is_correct).length / first.length : 0,
    allAccuracy: answeredAll.length ? correctAll.length / answeredAll.length : 0,
    avgMs: answeredAll.length
      ? Math.round(answeredAll.reduce((sum, r) => sum + (r.duration_ms || 0), 0) / answeredAll.length)
      : 0,
    timedCompletionRate: timedSessions.length
      ? timedSessions.filter((s) => !s.overtime).length / timedSessions.length
      : 0,
    setAvgScore: setSessions.length
      ? setSessions.reduce((sum, s) => sum + s.score, 0) / setSessions.length
      : null,
    slotRatio: sessions.length ? sessions.filter((s) => s.inExamSlot).length / sessions.length : 0,
    slotAccuracy: accuracyOf(first.filter((r) => r.in_exam_slot)),
    offSlotAccuracy: accuracyOf(first.filter((r) => !r.in_exam_slot)),
    byYear: bucket(first, (r) => String(r.year)),
    byTopic: bucket(first, (r) => r.topic || '未分类'),
    byQtype: bucket(first, (r) => r.qtype),
    wrongByReason: wrongRows.map((r) => ({ reason: r.reason || 'unmarked', count: r.count })),
    recent: sessions.slice(0, 10),
    totalSessions: sessions.length,
    disputedCount: disputedRows[0]?.count ?? 0,
  }
}

// ========== 云快照 ==========

export async function getExamMgmtCloudSnapshot(): Promise<MgmtSnapshot> {
  const db = await getExamMgmtDb()
  const [profile, sessionRows, sqRows, attemptRows, wrongRows] = await Promise.all([
    fetchMgmtProfile(),
    db.select<Record<string, unknown>[]>('SELECT * FROM exam_mgmt_sessions ORDER BY started_at ASC'),
    db.select<Record<string, unknown>[]>(`
      SELECT sq.session_id, sq.sort_order, q.question_key
      FROM exam_mgmt_session_questions sq
      JOIN exam_mgmt_questions q ON q.id = sq.question_id
    `),
    db.select<Record<string, unknown>[]>(`
      SELECT a.session_id, a.user_answer, a.is_correct, a.duration_ms, a.flagged, a.answered_at, q.question_key
      FROM exam_mgmt_attempts a
      JOIN exam_mgmt_questions q ON q.id = a.question_id
    `),
    db.select<Record<string, unknown>[]>(`
      SELECT w.*, q.question_key
      FROM exam_mgmt_wrongbook w
      JOIN exam_mgmt_questions q ON q.id = w.question_id
    `),
  ])
  return {
    profile,
    sessions: sessionRows.map(rowToSession),
    sessionQuestions: sqRows.map((row) => ({
      sessionId: (row.session_id as string) || '',
      questionKey: (row.question_key as string) || '',
      sortOrder: (row.sort_order as number) ?? 0,
    })),
    attempts: attemptRows.map((row) => ({
      sessionId: (row.session_id as string) || '',
      questionKey: (row.question_key as string) || '',
      userAnswer: (row.user_answer as string) || '',
      isCorrect: bool(row.is_correct),
      durationMs: (row.duration_ms as number) ?? 0,
      flagged: bool(row.flagged),
      answeredAt: (row.answered_at as string) || '',
    })),
    wrongbook: wrongRows.map((row) => ({
      questionKey: (row.question_key as string) || '',
      userAnswer: (row.user_answer as string) || '',
      reason: (row.reason as string) || '',
      note: (row.note as string) || '',
      status: ((row.status as string) === 'grasped' ? 'grasped' : 'new') as MgmtWrongStatus,
      wrongCount: (row.wrong_count as number) ?? 1,
      correctStreak: (row.correct_streak as number) ?? 0,
      lastReviewedAt: (row.last_reviewed_at as string) || null,
      addedAt: (row.added_at as string) || '',
      updatedAt: (row.updated_at as string) || '',
    })),
  }
}

export async function replaceExamMgmtData(snapshot: MgmtSnapshot): Promise<{ skipped: number }> {
  const db = await getExamMgmtDb()
  if ((await fetchMgmtQuestionCount()) === 0) await importMgmtBank(true)

  const rows = await db.select<Record<string, unknown>[]>('SELECT id, question_key FROM exam_mgmt_questions')
  const idByKey = new Map<string, number>()
  for (const row of rows) idByKey.set((row.question_key as string) || '', (row.id as number) ?? 0)

  await db.execute('DELETE FROM exam_mgmt_attempts')
  await db.execute('DELETE FROM exam_mgmt_session_questions')
  await db.execute('DELETE FROM exam_mgmt_sessions')
  await db.execute('DELETE FROM exam_mgmt_wrongbook')

  let skipped = 0
  const now = new Date().toISOString()

  await insertRows(
    db,
    `INSERT INTO exam_mgmt_sessions
       (id, subject, mode, scope, limit_seconds, started_at, deadline_at, submitted_at, elapsed_ms,
        question_count, answered_count, correct_count, score, full_score, overtime, in_exam_slot, status) VALUES`,
    17,
    (snapshot.sessions || []).map((s) => [
      s.id, s.subject, s.mode, s.scope, s.limitSeconds, s.startedAt, s.deadlineAt, s.submittedAt,
      s.elapsedMs, s.questionCount, s.answeredCount, s.correctCount, s.score, s.fullScore,
      s.overtime ? 1 : 0, s.inExamSlot ? 1 : 0, s.status,
    ]),
  )

  const sessionQuestionRows: unknown[][] = []
  for (const item of snapshot.sessionQuestions || []) {
    const id = idByKey.get(item.questionKey)
    if (!id) { skipped++; continue }
    sessionQuestionRows.push([item.sessionId, id, item.sortOrder])
  }
  await insertRows(
    db,
    'INSERT OR IGNORE INTO exam_mgmt_session_questions (session_id, question_id, sort_order) VALUES',
    3,
    sessionQuestionRows,
  )

  const attemptRows: unknown[][] = []
  for (const item of snapshot.attempts || []) {
    const id = idByKey.get(item.questionKey)
    if (!id) { skipped++; continue }
    attemptRows.push([
      item.sessionId, id, item.userAnswer, item.isCorrect ? 1 : 0, item.durationMs,
      item.flagged ? 1 : 0, item.answeredAt,
    ])
  }
  await insertRows(
    db,
    `INSERT INTO exam_mgmt_attempts
       (session_id, question_id, user_answer, is_correct, duration_ms, flagged, answered_at) VALUES`,
    7,
    attemptRows,
  )

  const wrongRows: unknown[][] = []
  for (const item of snapshot.wrongbook || []) {
    const id = idByKey.get(item.questionKey)
    if (!id) { skipped++; continue }
    wrongRows.push([
      id, item.userAnswer, item.reason, item.note, item.status, item.wrongCount,
      item.correctStreak, item.lastReviewedAt, item.addedAt || now, item.updatedAt || now,
    ])
  }
  await insertRows(
    db,
    `INSERT OR IGNORE INTO exam_mgmt_wrongbook
       (question_id, user_answer, reason, note, status, wrong_count, correct_streak,
        last_reviewed_at, added_at, updated_at) VALUES`,
    10,
    wrongRows,
  )

  await updateMgmtProfile(snapshot.profile)
  return { skipped }
}
