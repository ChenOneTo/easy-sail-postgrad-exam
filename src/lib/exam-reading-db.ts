/**
 * 英语二阅读刷题数据层。
 *
 * 与 tasks / exam / exam_vocab 共用同一个 SQLite 文件，表以 exam_reading_ 前缀隔离。
 * 题库本体从 src/assets/exam-reading/reading-bank.json 首启导入；用户数据单独存表。
 */
import Database from '@tauri-apps/plugin-sql'
import rawBank from '../assets/exam-reading/reading-bank.json?raw'
import { errText } from './error-text'

let _db: Database | null = null

export async function getExamReadingDb(): Promise<Database> {
  if (!_db) _db = await Database.load('sqlite:easy-sail-postgrad-exam.db')
  return _db
}

// ========== 规则常量 ==========

export const READING_RULES = {
  passagesPerSet: 4,
  questionsPerPassage: 5,
  pointsPerQuestion: 2,
  totalPoints: 40,
  examSlotStart: '14:00',
  examSlotEnd: '17:00',
  readingBlockStart: '14:15',
  perPassageMinutes: 18,
  sprintMinutes: 15,
  setMinutes: 70,
} as const

// ========== 类型 ==========

export type ReadingMode = 'close' | 'timed' | 'set' | 'wrong'
export type ReadingQType = 'detail' | 'infer' | 'main' | 'vocab' | 'attitude' | 'example' | 'other'
export type ReadingStatus = 'ongoing' | 'submitted' | 'abandoned'
export type ReadingWrongStatus = 'new' | 'grasped'

export interface ReadingPassage {
  id: number
  key: string
  year: number
  textNo: number
  title: string
  topic: string
  difficulty: number
  wordCount: number
  paragraphs: string[]
  translation: string[]
  sourceRef: string
  archived: boolean
}

export interface ReadingQuestion {
  id: number
  key: string
  passageId: number
  seq: number
  stem: string
  options: string[]
  answer: string
  answerAlt: string
  disputed: boolean
  qtype: ReadingQType
  locatePara: number
  locateHint: string
  explanation: string
  distractors: string
  answerNote: string
  sourceRef: string
  difficulty: number
  archived: boolean
}

export interface ReadingPassageWithQuestions extends ReadingPassage {
  questions: ReadingQuestion[]
}

export interface ReadingQuestionWithPassage extends ReadingQuestion {
  passageKey: string
  year: number
  textNo: number
  passageTitle: string
  paragraphs: string[]
}

export interface ReadingSession {
  id: string
  mode: ReadingMode
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
  status: ReadingStatus
}

export interface ReadingAttempt {
  id: number
  sessionId: string
  questionId: number
  userAnswer: string
  isCorrect: boolean
  durationMs: number
  flagged: boolean
  answeredAt: string
}

export interface ReadingWrongItem {
  id: number
  questionId: number
  questionKey: string
  wrongCount: number
  lastWrongAnswer: string
  reason: string
  note: string
  status: ReadingWrongStatus
  correctStreak: number
  lastReviewedAt: string | null
  addedAt: string
  updatedAt: string
  year: number
  textNo: number
  passageKey: string
  passageTitle: string
  stem: string
  answer: string
  answerAlt: string
  disputed: boolean
  qtype: ReadingQType
  locateHint: string
  explanation: string
  distractors: string
  answerNote: string
}

export interface ReadingProfile {
  closeSeconds: number
  timedSeconds: number
  setSeconds: number
  examSlotStart: string
  examSlotEnd: string
  slotHint: boolean
  mockYears: number[]
  bankVersion: number
}

export interface ReadingBankSnapshot {
  profile: ReadingProfile
  sessions: ReadingSession[]
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
    status: ReadingWrongStatus
    correctStreak: number
    lastReviewedAt: string | null
    addedAt: string
    updatedAt: string
  }[]
}

export interface ReadingStatBucket {
  label: string
  total: number
  correct: number
  accuracy: number
}

export interface ReadingStats {
  passagesPracticed: number
  questionsAnswered: number
  todayMs: number
  todayAccuracy: number | null
  todaySessions: number
  firstAccuracy: number
  allAccuracy: number
  avgMs: number
  timedCompletionRate: number
  setAvgScore: number | null
  slotRatio: number
  slotAccuracy: number | null
  offSlotAccuracy: number | null
  byYear: ReadingStatBucket[]
  byType: ReadingStatBucket[]
  wrongByReason: { reason: string; count: number }[]
  recent: ReadingSession[]
  disputedCount: number
  totalSessions: number
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

function rowToPassage(row: Record<string, unknown>): ReadingPassage {
  return {
    id: row.id as number,
    key: (row.passage_key as string) || '',
    year: (row.year as number) ?? 0,
    textNo: (row.text_no as number) ?? 0,
    title: (row.title as string) || '',
    topic: (row.topic as string) || '',
    difficulty: (row.difficulty as number) ?? 2,
    wordCount: (row.word_count as number) ?? 0,
    paragraphs: parseJsonArray(row.content),
    translation: parseJsonArray(row.translation),
    sourceRef: (row.source_ref as string) || '',
    archived: bool(row.archived),
  }
}

function rowToQuestion(row: Record<string, unknown>): ReadingQuestion {
  const qtype = (row.qtype as string) || 'detail'
  return {
    id: row.id as number,
    key: (row.question_key as string) || '',
    passageId: (row.passage_id as number) ?? 0,
    seq: (row.seq as number) ?? 0,
    stem: (row.stem as string) || '',
    options: parseJsonArray(row.options),
    answer: (row.answer as string) || 'A',
    answerAlt: (row.answer_alt as string) || '',
    disputed: bool(row.disputed),
    qtype: qtype as ReadingQType,
    locatePara: (row.locate_para as number) ?? 0,
    locateHint: (row.locate_hint as string) || '',
    explanation: (row.explanation as string) || '',
    distractors: (row.distractors as string) || '',
    answerNote: (row.answer_note as string) || '',
    sourceRef: (row.source_ref as string) || '',
    difficulty: (row.difficulty as number) ?? 2,
    archived: bool(row.archived),
  }
}

function rowToSession(row: Record<string, unknown>): ReadingSession {
  const mode = (row.mode as string) || 'close'
  const status = (row.status as string) || 'ongoing'
  return {
    id: (row.id as string) || '',
    mode: (['close', 'timed', 'set', 'wrong'].includes(mode) ? mode : 'close') as ReadingMode,
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
    status: (['ongoing', 'submitted', 'abandoned'].includes(status) ? status : 'ongoing') as ReadingStatus,
  }
}

function rowToAttempt(row: Record<string, unknown>): ReadingAttempt {
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

function rowToProfile(row: Record<string, unknown>): ReadingProfile {
  return {
    closeSeconds: (row.close_seconds as number) ?? 0,
    timedSeconds: (row.timed_seconds as number) ?? 1080,
    setSeconds: (row.set_seconds as number) ?? 4200,
    examSlotStart: (row.exam_slot_start as string) || '14:00',
    examSlotEnd: (row.exam_slot_end as string) || '17:00',
    slotHint: bool(row.slot_hint ?? 1),
    mockYears: (() => {
      try {
        const parsed: unknown = JSON.parse((row.mock_years as string) || '[]')
        return Array.isArray(parsed) ? parsed.map((x) => Number(x)).filter((n) => Number.isFinite(n)) : []
      } catch {
        return []
      }
    })(),
    bankVersion: (row.bank_version as number) ?? 0,
  }
}

// ========== 工具 ==========

async function execWithRetry(db: Database, sql: string, values: unknown[], attempts = 4): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await db.execute(sql, values)
      return
    } catch (err) {
      const msg = errText(err)
      if (attempt >= attempts || !/locked|busy/i.test(msg)) throw err
      await new Promise((r) => setTimeout(r, 250 * attempt))
    }
  }
}

function makeSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `reading-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function isInExamSlot(date: Date, start: string, end: string): boolean {
  const toMinutes = (value: string): number => {
    const [h, m] = value.split(':').map((x) => Number(x))
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
  }
  const now = date.getHours() * 60 + date.getMinutes()
  return now >= toMinutes(start) && now < toMinutes(end)
}

// ========== Profile ==========

const DEFAULT_PROFILE: ReadingProfile = {
  closeSeconds: 0,
  timedSeconds: 1080,
  setSeconds: 4200,
  examSlotStart: '14:00',
  examSlotEnd: '17:00',
  slotHint: true,
  mockYears: [],
  bankVersion: 0,
}

export async function fetchReadingProfile(): Promise<ReadingProfile> {
  const db = await getExamReadingDb()
  const rows = await db.select<Record<string, unknown>[]>('SELECT * FROM exam_reading_profile WHERE id = 1')
  return rows.length ? rowToProfile(rows[0]) : { ...DEFAULT_PROFILE }
}

const PROFILE_FIELD_MAP: Record<keyof ReadingProfile, string> = {
  closeSeconds: 'close_seconds',
  timedSeconds: 'timed_seconds',
  setSeconds: 'set_seconds',
  examSlotStart: 'exam_slot_start',
  examSlotEnd: 'exam_slot_end',
  slotHint: 'slot_hint',
  mockYears: 'mock_years',
  bankVersion: 'bank_version',
}

export async function updateReadingProfile(updates: Partial<ReadingProfile>): Promise<void> {
  const db = await getExamReadingDb()
  const sets: string[] = []
  const values: unknown[] = []
  let idx = 1
  for (const [key, col] of Object.entries(PROFILE_FIELD_MAP)) {
    if (!(key in updates)) continue
    sets.push(`${col} = $${idx++}`)
    const value = (updates as Record<string, unknown>)[key]
    values.push(
      typeof value === 'boolean'
        ? (value ? 1 : 0)
        : Array.isArray(value)
          ? JSON.stringify(value)
          : value,
    )
  }
  if (sets.length === 0) return
  sets.push(`updated_at = $${idx++}`)
  values.push(new Date().toISOString())
  values.push(1)
  await db.execute(`UPDATE exam_reading_profile SET ${sets.join(', ')} WHERE id = $${idx}`, values)
}

// ========== 题库导入 ==========

interface BankQuestionJson {
  key: string
  seq: number
  stem: string
  options: string[]
  answer: string
  answerAlt?: string
  disputed?: boolean
  qtype?: string
  locatePara?: number
  locateHint?: string
  explanation?: string
  distractors?: string
  answerNote?: string
  sourceRef?: string
  difficulty?: number
}

interface BankPassageJson {
  key: string
  year: number
  textNo: number
  title?: string
  topic?: string
  difficulty?: number
  wordCount?: number
  paragraphs: string[]
  translation?: string[]
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
  if (!parsed || typeof parsed !== 'object') throw new Error('题库 JSON 格式异常')
  _bankCache = parsed as BankJson
  return _bankCache
}

export async function fetchReadingPassageCount(): Promise<number> {
  const db = await getExamReadingDb()
  const rows = await db.select<{ count: number }[]>(
    'SELECT COUNT(*) AS count FROM exam_reading_passages WHERE archived = 0',
  )
  return rows[0]?.count ?? 0
}

export async function importReadingBank(force = false): Promise<{ imported: boolean; passages: number; questions: number }> {
  const db = await getExamReadingDb()
  const bank = readBankJson()
  const profile = await fetchReadingProfile()
  const count = await fetchReadingPassageCount()
  if (!force && count > 0 && profile.bankVersion >= bank.version) {
    return { imported: false, passages: count, questions: 0 }
  }
  if (!bank.passages?.length) {
    return { imported: false, passages: 0, questions: 0 }
  }

  for (const p of bank.passages) {
    await execWithRetry(
      db,
      `INSERT INTO exam_reading_passages
         (passage_key, year, text_no, title, topic, difficulty, word_count, content, translation, source_ref, archived)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0)
       ON CONFLICT(passage_key) DO UPDATE SET
         year = excluded.year, text_no = excluded.text_no, title = excluded.title,
         topic = excluded.topic, difficulty = excluded.difficulty, word_count = excluded.word_count,
         content = excluded.content, translation = excluded.translation,
         source_ref = excluded.source_ref, updated_at = datetime('now')`,
      [
        p.key, p.year, p.textNo, p.title || '', p.topic || '', p.difficulty ?? 2,
        p.wordCount ?? 0, JSON.stringify(p.paragraphs || []),
        JSON.stringify(p.translation || []), p.sourceRef || '',
      ],
    )
  }

  const rows = await db.select<Record<string, unknown>[]>('SELECT id, passage_key FROM exam_reading_passages')
  const idByKey = new Map<string, number>()
  for (const row of rows) idByKey.set((row.passage_key as string) || '', (row.id as number) ?? 0)

  let questionCount = 0
  for (const p of bank.passages) {
    const passageId = idByKey.get(p.key)
    if (!passageId) continue
    for (const q of p.questions || []) {
      await execWithRetry(
        db,
        `INSERT INTO exam_reading_questions
           (question_key, passage_id, seq, stem, options, answer, answer_alt, disputed, qtype,
            locate_para, locate_hint, explanation, distractors, answer_note, source_ref, difficulty, archived)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,0)
         ON CONFLICT(question_key) DO UPDATE SET
           passage_id = excluded.passage_id, seq = excluded.seq, stem = excluded.stem,
           options = excluded.options, answer = excluded.answer, answer_alt = excluded.answer_alt,
           disputed = excluded.disputed, qtype = excluded.qtype, locate_para = excluded.locate_para,
           locate_hint = excluded.locate_hint, explanation = excluded.explanation,
           distractors = excluded.distractors, answer_note = excluded.answer_note,
           source_ref = excluded.source_ref, difficulty = excluded.difficulty`,
        [
          q.key, passageId, q.seq, q.stem, JSON.stringify(q.options || []), q.answer,
          q.answerAlt || '', q.disputed ? 1 : 0, q.qtype || 'detail', q.locatePara ?? 0,
          q.locateHint || '', q.explanation || '', q.distractors || '', q.answerNote || '',
          q.sourceRef || '', q.difficulty ?? 2,
        ],
      )
      questionCount++
    }
  }

  await updateReadingProfile({ bankVersion: bank.version })
  return { imported: true, passages: bank.passages.length, questions: questionCount }
}

export async function fetchReadingBank(): Promise<ReadingPassageWithQuestions[]> {
  const db = await getExamReadingDb()
  const [passageRows, questionRows] = await Promise.all([
    db.select<Record<string, unknown>[]>(
      'SELECT * FROM exam_reading_passages WHERE archived = 0 ORDER BY year ASC, text_no ASC',
    ),
    db.select<Record<string, unknown>[]>(
      'SELECT * FROM exam_reading_questions WHERE archived = 0 ORDER BY passage_id ASC, seq ASC',
    ),
  ])
  const byId = new Map<number, ReadingPassageWithQuestions>()
  const result = passageRows.map((row) => {
    const passage: ReadingPassageWithQuestions = { ...rowToPassage(row), questions: [] }
    byId.set(passage.id, passage)
    return passage
  })
  for (const row of questionRows) {
    const question = rowToQuestion(row)
    byId.get(question.passageId)?.questions.push(question)
  }
  return result
}

export async function fetchQuestionsByIds(ids: number[]): Promise<ReadingQuestionWithPassage[]> {
  if (ids.length === 0) return []
  const db = await getExamReadingDb()
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(',')
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT q.*, p.passage_key, p.year, p.text_no, p.title AS passage_title, p.content AS passage_content
     FROM exam_reading_questions q
     JOIN exam_reading_passages p ON p.id = q.passage_id
     WHERE q.id IN (${placeholders})`,
    ids,
  )
  const order = new Map(ids.map((id, index) => [id, index]))
  return rows
    .map((row) => ({
      ...rowToQuestion(row),
      passageKey: (row.passage_key as string) || '',
      year: (row.year as number) ?? 0,
      textNo: (row.text_no as number) ?? 0,
      passageTitle: (row.passage_title as string) || '',
      paragraphs: parseJsonArray(row.passage_content),
    }))
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
}

// ========== 会话 ==========

export async function createReadingSession(input: {
  mode: ReadingMode
  scope: string
  questionIds: number[]
  limitSeconds: number
  inExamSlot: boolean
}): Promise<ReadingSession> {
  const db = await getExamReadingDb()
  const id = makeSessionId()
  const startedAt = new Date().toISOString()
  const deadlineAt = input.limitSeconds > 0
    ? new Date(Date.now() + input.limitSeconds * 1000).toISOString()
    : null
  await execWithRetry(
    db,
    `INSERT INTO exam_reading_sessions
       (id, mode, scope, limit_seconds, started_at, deadline_at, question_count, in_exam_slot, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ongoing')`,
    [id, input.mode, input.scope, input.limitSeconds, startedAt, deadlineAt, input.questionIds.length, input.inExamSlot ? 1 : 0],
  )
  for (let i = 0; i < input.questionIds.length; i++) {
    await execWithRetry(
      db,
      'INSERT OR IGNORE INTO exam_reading_session_questions (session_id, question_id, sort_order) VALUES ($1,$2,$3)',
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

export async function fetchReadingSession(id: string): Promise<ReadingSession | null> {
  const db = await getExamReadingDb()
  const rows = await db.select<Record<string, unknown>[]>('SELECT * FROM exam_reading_sessions WHERE id = $1', [id])
  return rows.length ? rowToSession(rows[0]) : null
}

export async function fetchOngoingReadingSessions(): Promise<ReadingSession[]> {
  const db = await getExamReadingDb()
  const rows = await db.select<Record<string, unknown>[]>(
    "SELECT * FROM exam_reading_sessions WHERE status = 'ongoing' ORDER BY started_at DESC",
  )
  return rows.map(rowToSession)
}

export async function fetchSessionQuestions(sessionId: string): Promise<ReadingQuestionWithPassage[]> {
  const db = await getExamReadingDb()
  const rows = await db.select<{ question_id: number }[]>(
    'SELECT question_id FROM exam_reading_session_questions WHERE session_id = $1 ORDER BY sort_order ASC',
    [sessionId],
  )
  return fetchQuestionsByIds(rows.map((r) => r.question_id))
}

export async function upsertReadingAttempt(input: {
  sessionId: string
  questionId: number
  userAnswer: string
  isCorrect: boolean
  durationMs: number
  flagged: boolean
}): Promise<void> {
  const db = await getExamReadingDb()
  await execWithRetry(
    db,
    `INSERT INTO exam_reading_attempts
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

export async function fetchSessionAttempts(sessionId: string): Promise<ReadingAttempt[]> {
  const db = await getExamReadingDb()
  const rows = await db.select<Record<string, unknown>[]>(
    'SELECT * FROM exam_reading_attempts WHERE session_id = $1',
    [sessionId],
  )
  return rows.map(rowToAttempt)
}

export async function submitReadingSession(sessionId: string, auto = false): Promise<ReadingSession | null> {
  const db = await getExamReadingDb()
  const session = await fetchReadingSession(sessionId)
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
  // 限时会话按上限截断，避免应用关闭一夜后把“平均用时”统计拉爆
  const elapsedMs = session.limitSeconds > 0
    ? Math.min(rawElapsed, session.limitSeconds * 1000)
    : rawElapsed
  const score = correct.length * READING_RULES.pointsPerQuestion

  await db.execute(
    `UPDATE exam_reading_sessions SET
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
        `INSERT INTO exam_reading_wrongbook
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
        `UPDATE exam_reading_wrongbook SET
           correct_streak = correct_streak + 1,
           status = CASE WHEN correct_streak + 1 >= 2 THEN 'grasped' ELSE status END,
           last_reviewed_at = datetime('now'), updated_at = datetime('now')
         WHERE question_id = $1`,
        [question.id],
      )
    }
  }

  return fetchReadingSession(sessionId)
}

export async function abandonReadingSession(sessionId: string): Promise<void> {
  const db = await getExamReadingDb()
  await db.execute(
    "UPDATE exam_reading_sessions SET status = 'abandoned', submitted_at = $1 WHERE id = $2 AND status = 'ongoing'",
    [new Date().toISOString(), sessionId],
  )
}

/** 已交卷会话覆盖过的篇目（用于今日计划/题库状态） */
export async function fetchCompletedPassageKeys(): Promise<string[]> {
  const db = await getExamReadingDb()
  const rows = await db.select<{ passage_key: string }[]>(`
    SELECT DISTINCT p.passage_key
    FROM exam_reading_session_questions sq
    JOIN exam_reading_sessions s ON s.id = sq.session_id AND s.status = 'submitted'
    JOIN exam_reading_questions q ON q.id = sq.question_id
    JOIN exam_reading_passages p ON p.id = q.passage_id
  `)
  return rows.map((r) => r.passage_key).filter(Boolean)
}

/** 已交卷套卷年份 */
export async function fetchCompletedSetYears(): Promise<number[]> {
  const db = await getExamReadingDb()
  const rows = await db.select<{ scope: string }[]>(
    "SELECT DISTINCT scope FROM exam_reading_sessions WHERE status = 'submitted' AND mode = 'set'",
  )
  return rows.map((r) => Number(r.scope)).filter((n) => Number.isFinite(n))
}

export async function fetchSubmittedReadingSessions(limit = 30): Promise<ReadingSession[]> {
  const db = await getExamReadingDb()
  const rows = await db.select<Record<string, unknown>[]>(
    "SELECT * FROM exam_reading_sessions WHERE status = 'submitted' ORDER BY started_at DESC LIMIT $1",
    [limit],
  )
  return rows.map(rowToSession)
}

// ========== 错题本 ==========

export async function fetchReadingWrongbook(): Promise<ReadingWrongItem[]> {
  const db = await getExamReadingDb()
  const rows = await db.select<Record<string, unknown>[]>(`
    SELECT w.*, q.question_key, q.stem, q.answer, q.answer_alt, q.disputed, q.qtype,
           q.locate_hint, q.explanation, q.distractors, q.answer_note,
           p.year, p.text_no, p.passage_key, p.title AS passage_title
    FROM exam_reading_wrongbook w
    JOIN exam_reading_questions q ON q.id = w.question_id
    JOIN exam_reading_passages p ON p.id = q.passage_id
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
      status: status as ReadingWrongStatus,
      correctStreak: (row.correct_streak as number) ?? 0,
      lastReviewedAt: (row.last_reviewed_at as string) || null,
      addedAt: (row.added_at as string) || '',
      updatedAt: (row.updated_at as string) || '',
      year: (row.year as number) ?? 0,
      textNo: (row.text_no as number) ?? 0,
      passageKey: (row.passage_key as string) || '',
      passageTitle: (row.passage_title as string) || '',
      stem: (row.stem as string) || '',
      answer: (row.answer as string) || '',
      answerAlt: (row.answer_alt as string) || '',
      disputed: bool(row.disputed),
      qtype: ((row.qtype as string) || 'detail') as ReadingQType,
      locateHint: (row.locate_hint as string) || '',
      explanation: (row.explanation as string) || '',
      distractors: (row.distractors as string) || '',
      answerNote: (row.answer_note as string) || '',
    }
  })
}

export async function updateReadingWrongReason(questionId: number, reason: string, note: string): Promise<void> {
  const db = await getExamReadingDb()
  await db.execute(
    "UPDATE exam_reading_wrongbook SET reason = $1, note = $2, updated_at = datetime('now') WHERE question_id = $3",
    [reason, note, questionId],
  )
}

export async function setReadingWrongStatus(questionId: number, status: ReadingWrongStatus): Promise<void> {
  const db = await getExamReadingDb()
  await db.execute(
    "UPDATE exam_reading_wrongbook SET status = $1, updated_at = datetime('now') WHERE question_id = $2",
    [status, questionId],
  )
}

export async function removeReadingWrong(questionId: number): Promise<void> {
  const db = await getExamReadingDb()
  await db.execute('DELETE FROM exam_reading_wrongbook WHERE question_id = $1', [questionId])
}

// ========== 统计 ==========

interface AttemptStatRow {
  question_id: number
  user_answer: string
  is_correct: number
  duration_ms: number
  answered_at: string
  started_at: string
  qtype: string
  year: number
  in_exam_slot: number
  disputed: number
}

export async function fetchReadingStats(): Promise<ReadingStats> {
  const db = await getExamReadingDb()
  const [sessions, attemptRows, passageRows, wrongRows, questionCountRows] = await Promise.all([
    db.select<Record<string, unknown>[]>(
      "SELECT * FROM exam_reading_sessions WHERE status = 'submitted' ORDER BY started_at DESC",
    ),
    db.select<AttemptStatRow[]>(`
      SELECT a.question_id, a.user_answer, a.is_correct, a.duration_ms, a.answered_at,
             s.started_at, q.qtype, q.disputed, p.year, s.in_exam_slot
      FROM exam_reading_attempts a
      JOIN exam_reading_sessions s ON s.id = a.session_id AND s.status = 'submitted'
      JOIN exam_reading_questions q ON q.id = a.question_id AND q.archived = 0
      JOIN exam_reading_passages p ON p.id = q.passage_id
      ORDER BY a.answered_at ASC, a.id ASC
    `),
    db.select<{ count: number }[]>(`
      SELECT COUNT(DISTINCT q.passage_id) AS count
      FROM exam_reading_session_questions sq
      JOIN exam_reading_sessions s ON s.id = sq.session_id AND s.status = 'submitted'
      JOIN exam_reading_questions q ON q.id = sq.question_id
    `),
    db.select<{ reason: string; count: number }[]>(
      "SELECT reason, COUNT(*) AS count FROM exam_reading_wrongbook GROUP BY reason",
    ),
    db.select<{ count: number }[]>(
      'SELECT COUNT(*) AS count FROM exam_reading_questions WHERE disputed = 1 AND archived = 0',
    ),
  ])

  const firstByQuestion = new Map<number, AttemptStatRow>()
  for (const row of attemptRows) {
    if (!firstByQuestion.has(row.question_id)) firstByQuestion.set(row.question_id, row)
  }
  const first = [...firstByQuestion.values()]
  const answeredFirst = first.filter((r) => (r.user_answer || '') !== '')
  const correctFirst = answeredFirst.filter((r) => !!r.is_correct)
  const answeredAll = attemptRows.filter((r) => (r.user_answer || '') !== '')
  const correctAll = answeredAll.filter((r) => !!r.is_correct)

  const bucket = (rows: AttemptStatRow[], key: (r: AttemptStatRow) => string): ReadingStatBucket[] => {
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

  const timedSessions = sessions.map(rowToSession).filter((s) => s.mode === 'timed' || s.mode === 'set')
  const setSessions = sessions.map(rowToSession).filter((s) => s.mode === 'set')
  const allSessions = sessions.map(rowToSession)
  const slotRows = answeredFirst.filter((r) => r.in_exam_slot)
  const offSlotRows = answeredFirst.filter((r) => !r.in_exam_slot)
  const accuracyOf = (rows: AttemptStatRow[]): number | null => {
    const answered = rows.filter((r) => r.user_answer)
    return answered.length ? answered.filter((r) => r.is_correct).length / answered.length : null
  }

  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const isToday = (value: string): boolean => {
    if (!value) return false
    const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return false
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === todayKey
  }
  const todaySessions = allSessions.filter((s) => isToday(s.startedAt))
  const todayRows = attemptRows.filter((r) => isToday(r.started_at))

  return {
    passagesPracticed: passageRows[0]?.count ?? 0,
    questionsAnswered: answeredFirst.length,
    todayMs: todaySessions.reduce((sum, s) => sum + s.elapsedMs, 0),
    todayAccuracy: accuracyOf(todayRows),
    todaySessions: todaySessions.length,
    firstAccuracy: answeredFirst.length ? correctFirst.length / answeredFirst.length : 0,
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
    slotRatio: allSessions.length ? allSessions.filter((s) => s.inExamSlot).length / allSessions.length : 0,
    slotAccuracy: accuracyOf(slotRows),
    offSlotAccuracy: accuracyOf(offSlotRows),
    byYear: bucket(answeredFirst, (r) => String(r.year)),
    byType: bucket(answeredFirst, (r) => r.qtype),
    wrongByReason: wrongRows.map((r) => ({ reason: r.reason || 'unmarked', count: r.count })),
    recent: allSessions.slice(0, 10),
    disputedCount: questionCountRows[0]?.count ?? 0,
    totalSessions: allSessions.length,
  }
}

// ========== 云快照 ==========

export async function getExamReadingCloudSnapshot(): Promise<ReadingBankSnapshot> {
  const db = await getExamReadingDb()
  const [profile, sessionRows, sqRows, attemptRows, wrongRows] = await Promise.all([
    fetchReadingProfile(),
    db.select<Record<string, unknown>[]>('SELECT * FROM exam_reading_sessions ORDER BY started_at ASC'),
    db.select<Record<string, unknown>[]>(`
      SELECT sq.session_id, sq.sort_order, q.question_key
      FROM exam_reading_session_questions sq
      JOIN exam_reading_questions q ON q.id = sq.question_id
    `),
    db.select<Record<string, unknown>[]>(`
      SELECT a.session_id, a.user_answer, a.is_correct, a.duration_ms, a.flagged, a.answered_at, q.question_key
      FROM exam_reading_attempts a
      JOIN exam_reading_questions q ON q.id = a.question_id
    `),
    db.select<Record<string, unknown>[]>(`
      SELECT w.*, q.question_key
      FROM exam_reading_wrongbook w
      JOIN exam_reading_questions q ON q.id = w.question_id
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
      status: ((row.status as string) === 'grasped' ? 'grasped' : 'new') as ReadingWrongStatus,
      correctStreak: (row.correct_streak as number) ?? 0,
      lastReviewedAt: (row.last_reviewed_at as string) || null,
      addedAt: (row.added_at as string) || '',
      updatedAt: (row.updated_at as string) || '',
    })),
  }
}

export async function replaceExamReadingData(snapshot: ReadingBankSnapshot): Promise<{ skipped: number }> {
  const db = await getExamReadingDb()
  if ((await fetchReadingPassageCount()) === 0) await importReadingBank(true)

  const rows = await db.select<Record<string, unknown>[]>('SELECT id, question_key FROM exam_reading_questions')
  const idByKey = new Map<string, number>()
  for (const row of rows) idByKey.set((row.question_key as string) || '', (row.id as number) ?? 0)

  await db.execute('DELETE FROM exam_reading_attempts')
  await db.execute('DELETE FROM exam_reading_session_questions')
  await db.execute('DELETE FROM exam_reading_sessions')
  await db.execute('DELETE FROM exam_reading_wrongbook')

  let skipped = 0
  for (const s of snapshot.sessions || []) {
    await execWithRetry(
      db,
      `INSERT INTO exam_reading_sessions
         (id, mode, scope, limit_seconds, started_at, deadline_at, submitted_at, elapsed_ms,
          question_count, answered_count, correct_count, score, overtime, in_exam_slot, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        s.id, s.mode, s.scope, s.limitSeconds, s.startedAt, s.deadlineAt, s.submittedAt,
        s.elapsedMs, s.questionCount, s.answeredCount, s.correctCount, s.score,
        s.overtime ? 1 : 0, s.inExamSlot ? 1 : 0, s.status,
      ],
    )
  }
  for (const item of snapshot.sessionQuestions || []) {
    const id = idByKey.get(item.questionKey)
    if (!id) { skipped++; continue }
    await execWithRetry(
      db,
      'INSERT OR IGNORE INTO exam_reading_session_questions (session_id, question_id, sort_order) VALUES ($1,$2,$3)',
      [item.sessionId, id, item.sortOrder],
    )
  }
  for (const item of snapshot.attempts || []) {
    const id = idByKey.get(item.questionKey)
    if (!id) { skipped++; continue }
    await execWithRetry(
      db,
      `INSERT INTO exam_reading_attempts
         (session_id, question_id, user_answer, is_correct, duration_ms, flagged, answered_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [item.sessionId, id, item.userAnswer, item.isCorrect ? 1 : 0, item.durationMs, item.flagged ? 1 : 0, item.answeredAt],
    )
  }
  for (const item of snapshot.wrongbook || []) {
    const id = idByKey.get(item.questionKey)
    if (!id) { skipped++; continue }
    await execWithRetry(
      db,
      `INSERT INTO exam_reading_wrongbook
         (question_id, wrong_count, last_wrong_answer, reason, note, status, correct_streak, last_reviewed_at, added_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        id, item.wrongCount, item.lastWrongAnswer, item.reason, item.note, item.status,
        item.correctStreak, item.lastReviewedAt, item.addedAt || new Date().toISOString(),
        item.updatedAt || new Date().toISOString(),
      ],
    )
  }

  const p = snapshot.profile
  await updateReadingProfile(p)
  return { skipped }
}
