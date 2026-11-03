/**
 * 英语二完形填空数据层。
 *
 * 与 tasks / exam / exam_vocab / exam_reading 共用同一个 SQLite 文件，
 * 表以 exam_cloze_ 前缀隔离。题库从 src/assets/exam-cloze/cloze-bank.json 首启导入；
 * 用户数据（会话/作答/错题/配置）单独存表。
 */
import Database from '@tauri-apps/plugin-sql'
import rawBank from '../assets/exam-cloze/cloze-bank.json?raw'
import { execWithRetry, insertRows } from './sql-util'

let _db: Database | null = null

export async function getExamClozeDb(): Promise<Database> {
  if (!_db) _db = await Database.load('sqlite:easy-sail-postgrad-exam.db')
  return _db
}

export const CLOZE_RULES = {
  questionsPerPassage: 20,
  pointsPerQuestion: 0.5,
  totalPoints: 10,
  timedSeconds: 900,
  examSlotStart: '14:00',
  examSlotEnd: '17:00',
  suggestedStart: '14:00',
} as const

export type ClozeMode = 'close' | 'timed' | 'wrong'
export type ClozeStatus = 'ongoing' | 'submitted' | 'abandoned'
export type ClozeWrongStatus = 'new' | 'grasped'

export interface ClozePassage {
  id: number
  key: string
  year: number
  title: string
  topic: string
  difficulty: number
  wordCount: number
  paragraphs: string[]
  sourceRef: string
  archived: boolean
}

export interface ClozeQuestion {
  id: number
  key: string
  passageId: number
  seq: number
  context: string
  options: string[]
  answer: string
  answerWord: string
  qtype: string
  explanation: string
  sourceRef: string
  archived: boolean
}

export interface ClozePassageWithQuestions extends ClozePassage {
  questions: ClozeQuestion[]
}

export interface ClozeQuestionWithPassage extends ClozeQuestion {
  passageKey: string
  year: number
  passageTitle: string
  paragraphs: string[]
}

export interface ClozeSession {
  id: string
  mode: ClozeMode
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
  overtime: boolean
  inExamSlot: boolean
  status: ClozeStatus
}

export interface ClozeAttempt {
  id: number
  sessionId: string
  questionId: number
  userAnswer: string
  isCorrect: boolean
  durationMs: number
  flagged: boolean
  answeredAt: string
}

export interface ClozeWrongItem {
  id: number
  questionId: number
  questionKey: string
  wrongCount: number
  lastWrongAnswer: string
  reason: string
  note: string
  status: ClozeWrongStatus
  correctStreak: number
  lastReviewedAt: string | null
  addedAt: string
  updatedAt: string
  year: number
  passageKey: string
  passageTitle: string
  seq: number
  context: string
  options: string[]
  answer: string
  answerWord: string
  qtype: string
  explanation: string
}

export interface ClozeProfile {
  timedSeconds: number
  examSlotStart: string
  examSlotEnd: string
  slotHint: boolean
  bankVersion: number
}

export interface ClozeStatBucket {
  label: string
  total: number
  correct: number
  accuracy: number
}

export interface ClozeStats {
  practicedPassages: number
  totalQuestions: number
  correctCount: number
  accuracy: number
  todayMs: number
  todaySessions: number
  todayAccuracy: number | null
  avgMs: number
  timedCompletionRate: number
  slotRatio: number
  slotAccuracy: number | null
  offSlotAccuracy: number | null
  byYear: ClozeStatBucket[]
  wrongByReason: { reason: string; count: number }[]
  recent: ClozeSession[]
  totalSessions: number
}

export interface ClozeBankSnapshot {
  profile: ClozeProfile
  sessions: ClozeSession[]
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
    wrongCount: number
    lastWrongAnswer: string
    reason: string
    note: string
    status: ClozeWrongStatus
    correctStreak: number
    lastReviewedAt: string | null
    addedAt: string
    updatedAt: string
  }[]
}

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

function isToday(value: string): boolean {
  if (!value) return false
  const d = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)
  if (Number.isNaN(d.getTime())) return false
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

function rowToPassage(row: Record<string, unknown>): ClozePassage {
  return {
    id: (row.id as number) ?? 0,
    key: (row.passage_key as string) || '',
    year: (row.year as number) ?? 0,
    title: (row.title as string) || '',
    topic: (row.topic as string) || '',
    difficulty: (row.difficulty as number) ?? 2,
    wordCount: (row.word_count as number) ?? 0,
    paragraphs: parseJsonArray(row.content),
    sourceRef: (row.source_ref as string) || '',
    archived: bool(row.archived),
  }
}

function rowToQuestion(row: Record<string, unknown>): ClozeQuestion {
  return {
    id: (row.id as number) ?? 0,
    key: (row.question_key as string) || '',
    passageId: (row.passage_id as number) ?? 0,
    seq: (row.seq as number) ?? 0,
    context: (row.context as string) || '',
    options: parseJsonArray(row.options),
    answer: (row.answer as string) || 'A',
    answerWord: (row.answer_word as string) || '',
    qtype: (row.qtype as string) || '词义辨析',
    explanation: (row.explanation as string) || '',
    sourceRef: (row.source_ref as string) || '',
    archived: bool(row.archived),
  }
}

function rowToSession(row: Record<string, unknown>): ClozeSession {
  const mode = (row.mode as string) || 'close'
  const status = (row.status as string) || 'ongoing'
  return {
    id: (row.id as string) || '',
    mode: (['close', 'timed', 'wrong'].includes(mode) ? mode : 'close') as ClozeMode,
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
    overtime: bool(row.overtime),
    inExamSlot: bool(row.in_exam_slot),
    status: (['ongoing', 'submitted', 'abandoned'].includes(status) ? status : 'ongoing') as ClozeStatus,
  }
}

function rowToAttempt(row: Record<string, unknown>): ClozeAttempt {
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

function rowToProfile(row: Record<string, unknown>): ClozeProfile {
  return {
    timedSeconds: (row.timed_seconds as number) ?? CLOZE_RULES.timedSeconds,
    examSlotStart: (row.exam_slot_start as string) || CLOZE_RULES.examSlotStart,
    examSlotEnd: (row.exam_slot_end as string) || CLOZE_RULES.examSlotEnd,
    slotHint: bool(row.slot_hint ?? 1),
    bankVersion: (row.bank_version as number) ?? 0,
  }
}

function makeSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `cloze-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function isInExamSlot(date: Date, start: string, end: string): boolean {
  const toMinutes = (value: string): number => {
    const [h, m] = value.split(':').map((x) => Number(x))
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
  }
  const now = date.getHours() * 60 + date.getMinutes()
  return now >= toMinutes(start) && now < toMinutes(end)
}

const DEFAULT_PROFILE: ClozeProfile = {
  timedSeconds: CLOZE_RULES.timedSeconds,
  examSlotStart: CLOZE_RULES.examSlotStart,
  examSlotEnd: CLOZE_RULES.examSlotEnd,
  slotHint: true,
  bankVersion: 0,
}

export async function fetchClozeProfile(): Promise<ClozeProfile> {
  const db = await getExamClozeDb()
  const rows = await db.select<Record<string, unknown>[]>('SELECT * FROM exam_cloze_profile WHERE id = 1')
  return rows.length ? rowToProfile(rows[0]) : { ...DEFAULT_PROFILE }
}

const PROFILE_FIELD_MAP: Record<keyof ClozeProfile, string> = {
  timedSeconds: 'timed_seconds',
  examSlotStart: 'exam_slot_start',
  examSlotEnd: 'exam_slot_end',
  slotHint: 'slot_hint',
  bankVersion: 'bank_version',
}

export async function updateClozeProfile(updates: Partial<ClozeProfile>): Promise<void> {
  const db = await getExamClozeDb()
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
  await db.execute(`UPDATE exam_cloze_profile SET ${sets.join(', ')} WHERE id = $${idx}`, values)
}

interface BankQuestionJson {
  key: string
  seq: number
  context: string
  options: string[]
  answer: string
  answerWord?: string
  qtype?: string
  explanation?: string
  sourceRef?: string
}

interface BankPassageJson {
  key: string
  year: number
  title?: string
  topic?: string
  difficulty?: number
  wordCount?: number
  paragraphs: string[]
  sourceRef?: string
  questions: BankQuestionJson[]
}

interface BankJson {
  version: number
  passages: BankPassageJson[]
}

let _bankCache: BankJson | null = null

function readBankJson(): BankJson {
  if (_bankCache) return _bankCache
  const parsed: unknown = JSON.parse(rawBank)
  if (!parsed || typeof parsed !== 'object') throw new Error('完形题库 JSON 格式异常')
  _bankCache = parsed as BankJson
  return _bankCache
}

export async function fetchClozePassageCount(): Promise<number> {
  const db = await getExamClozeDb()
  const rows = await db.select<{ count: number }[]>(
    'SELECT COUNT(*) AS count FROM exam_cloze_passages WHERE archived = 0',
  )
  return rows[0]?.count ?? 0
}

export async function importClozeBank(force = false): Promise<{ imported: boolean; passages: number; questions: number }> {
  const db = await getExamClozeDb()
  const bank = readBankJson()
  const profile = await fetchClozeProfile()
  const count = await fetchClozePassageCount()
  if (!force && count > 0 && profile.bankVersion >= bank.version) {
    return { imported: false, passages: count, questions: 0 }
  }
  if (!bank.passages?.length) return { imported: false, passages: 0, questions: 0 }

  for (const p of bank.passages) {
    await execWithRetry(
      db,
      `INSERT INTO exam_cloze_passages
         (passage_key, year, title, topic, difficulty, word_count, content, source_ref, archived)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0)
       ON CONFLICT(passage_key) DO UPDATE SET
         year = excluded.year, title = excluded.title, topic = excluded.topic,
         difficulty = excluded.difficulty, word_count = excluded.word_count,
         content = excluded.content, source_ref = excluded.source_ref, updated_at = datetime('now')`,
      [p.key, p.year, p.title || '', p.topic || '', p.difficulty ?? 2, p.wordCount ?? 0, JSON.stringify(p.paragraphs || []), p.sourceRef || ''],
    )
  }

  const rows = await db.select<Record<string, unknown>[]>('SELECT id, passage_key FROM exam_cloze_passages')
  const idByKey = new Map<string, number>()
  for (const row of rows) idByKey.set((row.passage_key as string) || '', (row.id as number) ?? 0)

  let questionCount = 0
  for (const p of bank.passages) {
    const passageId = idByKey.get(p.key)
    if (!passageId) continue
    for (const q of p.questions || []) {
      await execWithRetry(
        db,
        `INSERT INTO exam_cloze_questions
           (question_key, passage_id, seq, context, options, answer, answer_word, qtype, explanation, source_ref, archived)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0)
         ON CONFLICT(question_key) DO UPDATE SET
           passage_id = excluded.passage_id, seq = excluded.seq, context = excluded.context,
           options = excluded.options, answer = excluded.answer, answer_word = excluded.answer_word,
           qtype = excluded.qtype, explanation = excluded.explanation, source_ref = excluded.source_ref`,
        [
          q.key, passageId, q.seq, q.context || '', JSON.stringify(q.options || []), q.answer,
          q.answerWord || '', q.qtype || '词义辨析', q.explanation || '', q.sourceRef || '',
        ],
      )
      questionCount++
    }
  }

  await updateClozeProfile({ bankVersion: bank.version })
  return { imported: true, passages: bank.passages.length, questions: questionCount }
}

export async function fetchClozeBank(): Promise<ClozePassageWithQuestions[]> {
  const db = await getExamClozeDb()
  const [passageRows, questionRows] = await Promise.all([
    db.select<Record<string, unknown>[]>('SELECT * FROM exam_cloze_passages WHERE archived = 0 ORDER BY year ASC'),
    db.select<Record<string, unknown>[]>('SELECT * FROM exam_cloze_questions WHERE archived = 0 ORDER BY passage_id ASC, seq ASC'),
  ])
  const byId = new Map<number, ClozePassageWithQuestions>()
  const result = passageRows.map((row) => {
    const passage: ClozePassageWithQuestions = { ...rowToPassage(row), questions: [] }
    byId.set(passage.id, passage)
    return passage
  })
  for (const row of questionRows) {
    const question = rowToQuestion(row)
    byId.get(question.passageId)?.questions.push(question)
  }
  return result
}

export async function fetchClozeQuestionsByIds(ids: number[]): Promise<ClozeQuestionWithPassage[]> {
  if (ids.length === 0) return []
  const db = await getExamClozeDb()
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(',')
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT q.*, p.passage_key, p.year, p.title AS passage_title, p.content AS passage_content
     FROM exam_cloze_questions q
     JOIN exam_cloze_passages p ON p.id = q.passage_id
     WHERE q.id IN (${placeholders})`,
    ids,
  )
  const order = new Map(ids.map((id, index) => [id, index]))
  return rows
    .map((row) => ({
      ...rowToQuestion(row),
      passageKey: (row.passage_key as string) || '',
      year: (row.year as number) ?? 0,
      passageTitle: (row.passage_title as string) || '',
      paragraphs: parseJsonArray(row.passage_content),
    }))
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
}

export async function createClozeSession(input: {
  mode: ClozeMode
  scope: string
  questionIds: number[]
  limitSeconds: number
  inExamSlot: boolean
}): Promise<ClozeSession> {
  const db = await getExamClozeDb()
  const id = makeSessionId()
  const startedAt = new Date().toISOString()
  const deadlineAt = input.limitSeconds > 0
    ? new Date(Date.now() + input.limitSeconds * 1000).toISOString()
    : null
  await execWithRetry(
    db,
    `INSERT INTO exam_cloze_sessions
       (id, mode, scope, limit_seconds, started_at, deadline_at, question_count, in_exam_slot, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ongoing')`,
    [id, input.mode, input.scope, input.limitSeconds, startedAt, deadlineAt, input.questionIds.length, input.inExamSlot ? 1 : 0],
  )
  for (let i = 0; i < input.questionIds.length; i++) {
    await execWithRetry(
      db,
      'INSERT OR IGNORE INTO exam_cloze_session_questions (session_id, question_id, sort_order) VALUES ($1,$2,$3)',
      [id, input.questionIds[i], i],
    )
  }
  return {
    id,
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
    overtime: false,
    inExamSlot: input.inExamSlot,
    status: 'ongoing',
  }
}

export async function fetchClozeSession(id: string): Promise<ClozeSession | null> {
  const db = await getExamClozeDb()
  const rows = await db.select<Record<string, unknown>[]>('SELECT * FROM exam_cloze_sessions WHERE id = $1', [id])
  return rows.length ? rowToSession(rows[0]) : null
}

export async function fetchOngoingClozeSessions(): Promise<ClozeSession[]> {
  const db = await getExamClozeDb()
  const rows = await db.select<Record<string, unknown>[]>(
    "SELECT * FROM exam_cloze_sessions WHERE status = 'ongoing' ORDER BY started_at DESC",
  )
  return rows.map(rowToSession)
}

export async function fetchClozeSessionQuestions(sessionId: string): Promise<ClozeQuestionWithPassage[]> {
  const db = await getExamClozeDb()
  const rows = await db.select<{ question_id: number }[]>(
    'SELECT question_id FROM exam_cloze_session_questions WHERE session_id = $1 ORDER BY sort_order ASC',
    [sessionId],
  )
  return fetchClozeQuestionsByIds(rows.map((r) => r.question_id))
}

export async function upsertClozeAttempt(input: {
  sessionId: string
  questionId: number
  userAnswer: string
  isCorrect: boolean
  durationMs: number
  flagged: boolean
}): Promise<void> {
  const db = await getExamClozeDb()
  await execWithRetry(
    db,
    `INSERT INTO exam_cloze_attempts
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

export async function fetchClozeSessionAttempts(sessionId: string): Promise<ClozeAttempt[]> {
  const db = await getExamClozeDb()
  const rows = await db.select<Record<string, unknown>[]>(
    'SELECT * FROM exam_cloze_attempts WHERE session_id = $1',
    [sessionId],
  )
  return rows.map(rowToAttempt)
}

export async function submitClozeSession(sessionId: string, auto = false): Promise<ClozeSession | null> {
  const db = await getExamClozeDb()
  const session = await fetchClozeSession(sessionId)
  if (!session || session.status !== 'ongoing') return session
  const [questions, attempts] = await Promise.all([
    fetchClozeSessionQuestions(sessionId),
    fetchClozeSessionAttempts(sessionId),
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
  const score = correct.length * CLOZE_RULES.pointsPerQuestion

  await db.execute(
    `UPDATE exam_cloze_sessions SET
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
        `INSERT INTO exam_cloze_wrongbook
           (question_id, wrong_count, last_wrong_answer, reason, status, correct_streak)
         VALUES ($1, 1, $2, $3, 'new', 0)
         ON CONFLICT(question_id) DO UPDATE SET
           wrong_count = wrong_count + 1, last_wrong_answer = excluded.last_wrong_answer,
           reason = CASE WHEN excluded.reason = '' THEN reason ELSE excluded.reason END,
           status = 'new', correct_streak = 0, updated_at = datetime('now')`,
        [question.id, attempt?.userAnswer || '', reason],
      )
    } else {
      await execWithRetry(
        db,
        `UPDATE exam_cloze_wrongbook SET
           correct_streak = correct_streak + 1,
           status = CASE WHEN correct_streak + 1 >= 2 THEN 'grasped' ELSE status END,
           last_reviewed_at = datetime('now'), updated_at = datetime('now')
         WHERE question_id = $1`,
        [question.id],
      )
    }
  }

  return fetchClozeSession(sessionId)
}

export async function abandonClozeSession(sessionId: string): Promise<void> {
  const db = await getExamClozeDb()
  await db.execute(
    "UPDATE exam_cloze_sessions SET status = 'abandoned', submitted_at = $1 WHERE id = $2 AND status = 'ongoing'",
    [new Date().toISOString(), sessionId],
  )
}

export async function fetchCompletedClozeKeys(): Promise<string[]> {
  const db = await getExamClozeDb()
  const rows = await db.select<{ passage_key: string }[]>(`
    SELECT DISTINCT p.passage_key
    FROM exam_cloze_session_questions sq
    JOIN exam_cloze_sessions s ON s.id = sq.session_id AND s.status = 'submitted'
    JOIN exam_cloze_questions q ON q.id = sq.question_id
    JOIN exam_cloze_passages p ON p.id = q.passage_id
  `)
  return rows.map((r) => r.passage_key).filter(Boolean)
}

export async function fetchSubmittedClozeSessions(limit = 30): Promise<ClozeSession[]> {
  const db = await getExamClozeDb()
  const rows = await db.select<Record<string, unknown>[]>(
    "SELECT * FROM exam_cloze_sessions WHERE status = 'submitted' ORDER BY started_at DESC LIMIT $1",
    [limit],
  )
  return rows.map(rowToSession)
}

export async function fetchClozeWrongbook(): Promise<ClozeWrongItem[]> {
  const db = await getExamClozeDb()
  const rows = await db.select<Record<string, unknown>[]>(`
    SELECT w.*, q.question_key, q.seq, q.context, q.options, q.answer, q.answer_word,
           q.qtype, q.explanation, p.year, p.passage_key, p.title AS passage_title
    FROM exam_cloze_wrongbook w
    JOIN exam_cloze_questions q ON q.id = w.question_id
    JOIN exam_cloze_passages p ON p.id = q.passage_id
    ORDER BY CASE WHEN w.status = 'grasped' THEN 1 ELSE 0 END ASC, w.added_at DESC
  `)
  return rows.map((row) => {
    const status = (row.status as string) === 'grasped' ? 'grasped' : 'new'
    return {
      id: (row.id as number) ?? 0,
      questionId: (row.question_id as number) ?? 0,
      questionKey: (row.question_key as string) || '',
      wrongCount: (row.wrong_count as number) ?? 1,
      lastWrongAnswer: (row.last_wrong_answer as string) || '',
      reason: (row.reason as string) || '',
      note: (row.note as string) || '',
      status: status as ClozeWrongStatus,
      correctStreak: (row.correct_streak as number) ?? 0,
      lastReviewedAt: (row.last_reviewed_at as string) || null,
      addedAt: (row.added_at as string) || '',
      updatedAt: (row.updated_at as string) || '',
      year: (row.year as number) ?? 0,
      passageKey: (row.passage_key as string) || '',
      passageTitle: (row.passage_title as string) || '',
      seq: (row.seq as number) ?? 0,
      context: (row.context as string) || '',
      options: parseJsonArray(row.options),
      answer: (row.answer as string) || '',
      answerWord: (row.answer_word as string) || '',
      qtype: (row.qtype as string) || '',
      explanation: (row.explanation as string) || '',
    }
  })
}

export async function updateClozeWrongReason(questionId: number, reason: string, note: string): Promise<void> {
  const db = await getExamClozeDb()
  await db.execute(
    "UPDATE exam_cloze_wrongbook SET reason = $1, note = $2, updated_at = datetime('now') WHERE question_id = $3",
    [reason, note, questionId],
  )
}

export async function setClozeWrongStatus(questionId: number, status: ClozeWrongStatus): Promise<void> {
  const db = await getExamClozeDb()
  await db.execute(
    "UPDATE exam_cloze_wrongbook SET status = $1, updated_at = datetime('now') WHERE question_id = $2",
    [status, questionId],
  )
}

export async function removeClozeWrong(questionId: number): Promise<void> {
  const db = await getExamClozeDb()
  await db.execute('DELETE FROM exam_cloze_wrongbook WHERE question_id = $1', [questionId])
}

export async function fetchClozeStats(): Promise<ClozeStats> {
  const db = await getExamClozeDb()
  const [sessionRows, attemptRows, wrongRows] = await Promise.all([
    db.select<Record<string, unknown>[]>("SELECT * FROM exam_cloze_sessions WHERE status = 'submitted' ORDER BY started_at DESC"),
    db.select<Record<string, unknown>[]>(`
      SELECT a.*, q.question_key, q.answer, p.year, p.passage_key, s.in_exam_slot
      FROM exam_cloze_attempts a
      JOIN exam_cloze_sessions s ON s.id = a.session_id AND s.status = 'submitted'
      JOIN exam_cloze_questions q ON q.id = a.question_id
      JOIN exam_cloze_passages p ON p.id = q.passage_id
    `),
    db.select<{ reason: string; count: number }[]>(`
      SELECT CASE WHEN reason = '' THEN 'unmarked' ELSE reason END AS reason, COUNT(*) AS count
      FROM exam_cloze_wrongbook GROUP BY reason
    `),
  ])

  const sessions = sessionRows.map(rowToSession)
  const answered = attemptRows.filter((r) => ((r.user_answer as string) || '') !== '')
  const correct = answered.filter((r) => bool(r.is_correct))
  const todaySessions = sessions.filter((s) => isToday(s.startedAt))
  const todayAttempts = answered.filter((r) => isToday((r.answered_at as string) || ''))
  const todayCorrect = todayAttempts.filter((r) => bool(r.is_correct))
  const timedSessions = sessions.filter((s) => s.mode === 'timed')
  const inSlotAttempts = answered.filter((r) => bool(r.in_exam_slot))
  const offSlotAttempts = answered.filter((r) => !bool(r.in_exam_slot))

  const bucket = (rows: Record<string, unknown>[], key: (row: Record<string, unknown>) => string): ClozeStatBucket[] => {
    const map = new Map<string, { total: number; correct: number }>()
    for (const row of rows) {
      const label = key(row)
      const item = map.get(label) || { total: 0, correct: 0 }
      item.total++
      if (bool(row.is_correct)) item.correct++
      map.set(label, item)
    }
    return [...map.entries()]
      .map(([label, item]) => ({ label, total: item.total, correct: item.correct, accuracy: item.total ? item.correct / item.total : 0 }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }

  const ratio = (n: number, d: number): number => (d > 0 ? n / d : 0)
  return {
    practicedPassages: new Set(answered.map((r) => (r.passage_key as string) || '')).size,
    totalQuestions: answered.length,
    correctCount: correct.length,
    accuracy: ratio(correct.length, answered.length),
    todayMs: todaySessions.reduce((sum, s) => sum + s.elapsedMs, 0),
    todaySessions: todaySessions.length,
    todayAccuracy: todayAttempts.length ? ratio(todayCorrect.length, todayAttempts.length) : null,
    avgMs: sessions.length ? Math.round(sessions.reduce((sum, s) => sum + s.elapsedMs, 0) / sessions.length) : 0,
    timedCompletionRate: timedSessions.length
      ? ratio(timedSessions.filter((s) => !s.overtime).length, timedSessions.length)
      : 0,
    slotRatio: ratio(sessions.filter((s) => s.inExamSlot).length, sessions.length),
    slotAccuracy: inSlotAttempts.length ? ratio(inSlotAttempts.filter((r) => bool(r.is_correct)).length, inSlotAttempts.length) : null,
    offSlotAccuracy: offSlotAttempts.length ? ratio(offSlotAttempts.filter((r) => bool(r.is_correct)).length, offSlotAttempts.length) : null,
    byYear: bucket(answered, (r) => String(r.year ?? '')),
    wrongByReason: wrongRows.map((r) => ({ reason: r.reason || 'unmarked', count: r.count })),
    recent: sessions.slice(0, 10),
    totalSessions: sessions.length,
  }
}

export async function getExamClozeCloudSnapshot(): Promise<ClozeBankSnapshot> {
  const db = await getExamClozeDb()
  const [profile, sessionRows, sqRows, attemptRows, wrongRows] = await Promise.all([
    fetchClozeProfile(),
    db.select<Record<string, unknown>[]>('SELECT * FROM exam_cloze_sessions ORDER BY started_at ASC'),
    db.select<Record<string, unknown>[]>(`
      SELECT sq.session_id, sq.sort_order, q.question_key
      FROM exam_cloze_session_questions sq
      JOIN exam_cloze_questions q ON q.id = sq.question_id
    `),
    db.select<Record<string, unknown>[]>(`
      SELECT a.*, q.question_key
      FROM exam_cloze_attempts a
      JOIN exam_cloze_questions q ON q.id = a.question_id
    `),
    db.select<Record<string, unknown>[]>(`
      SELECT w.*, q.question_key
      FROM exam_cloze_wrongbook w
      JOIN exam_cloze_questions q ON q.id = w.question_id
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
      wrongCount: (row.wrong_count as number) ?? 1,
      lastWrongAnswer: (row.last_wrong_answer as string) || '',
      reason: (row.reason as string) || '',
      note: (row.note as string) || '',
      status: ((row.status as string) === 'grasped' ? 'grasped' : 'new') as ClozeWrongStatus,
      correctStreak: (row.correct_streak as number) ?? 0,
      lastReviewedAt: (row.last_reviewed_at as string) || null,
      addedAt: (row.added_at as string) || '',
      updatedAt: (row.updated_at as string) || '',
    })),
  }
}

export async function replaceClozeData(snapshot: ClozeBankSnapshot): Promise<{ skipped: number }> {
  const db = await getExamClozeDb()
  if ((await fetchClozePassageCount()) === 0) await importClozeBank(true)

  const rows = await db.select<Record<string, unknown>[]>('SELECT id, question_key FROM exam_cloze_questions')
  const idByKey = new Map<string, number>()
  for (const row of rows) idByKey.set((row.question_key as string) || '', (row.id as number) ?? 0)

  await db.execute('DELETE FROM exam_cloze_attempts')
  await db.execute('DELETE FROM exam_cloze_session_questions')
  await db.execute('DELETE FROM exam_cloze_sessions')
  await db.execute('DELETE FROM exam_cloze_wrongbook')

  let skipped = 0
  const now = new Date().toISOString()

  await insertRows(
    db,
    `INSERT INTO exam_cloze_sessions
       (id, mode, scope, limit_seconds, started_at, deadline_at, submitted_at, elapsed_ms,
        question_count, answered_count, correct_count, score, overtime, in_exam_slot, status) VALUES`,
    15,
    (snapshot.sessions || []).map((s) => [
      s.id, s.mode, s.scope, s.limitSeconds, s.startedAt, s.deadlineAt, s.submittedAt,
      s.elapsedMs, s.questionCount, s.answeredCount, s.correctCount, s.score,
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
    'INSERT OR IGNORE INTO exam_cloze_session_questions (session_id, question_id, sort_order) VALUES',
    3,
    sessionQuestionRows,
  )

  const attemptRows: unknown[][] = []
  for (const item of snapshot.attempts || []) {
    const id = idByKey.get(item.questionKey)
    if (!id) { skipped++; continue }
    attemptRows.push([
      item.sessionId, id, item.userAnswer, item.isCorrect ? 1 : 0, item.durationMs, item.flagged ? 1 : 0, item.answeredAt,
    ])
  }
  await insertRows(
    db,
    `INSERT INTO exam_cloze_attempts
       (session_id, question_id, user_answer, is_correct, duration_ms, flagged, answered_at) VALUES`,
    7,
    attemptRows,
  )

  const wrongRows: unknown[][] = []
  for (const item of snapshot.wrongbook || []) {
    const id = idByKey.get(item.questionKey)
    if (!id) { skipped++; continue }
    wrongRows.push([
      id, item.wrongCount, item.lastWrongAnswer, item.reason, item.note, item.status,
      item.correctStreak, item.lastReviewedAt, item.addedAt || now, item.updatedAt || now,
    ])
  }
  await insertRows(
    db,
    `INSERT INTO exam_cloze_wrongbook
       (question_id, wrong_count, last_wrong_answer, reason, note, status, correct_streak, last_reviewed_at, added_at, updated_at) VALUES`,
    10,
    wrongRows,
  )

  await updateClozeProfile(snapshot.profile)
  return { skipped }
}
