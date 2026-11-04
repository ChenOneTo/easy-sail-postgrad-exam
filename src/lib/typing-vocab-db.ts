/**
 * 「打字背单词」数据访问层（独立模块）。
 *
 * 表全部以 `typing_vocab_` 前缀独立存在（migration 6），与背单词模块的
 * `exam_vocab_*` 零共享：不复用它的词表、卡片、复习日志与设置。
 *
 * 写入约定（与全项目一致）：**不使用 BEGIN/COMMIT**。tauri-plugin-sql 底层是
 * 连接池，事务可能落不到同一连接；批量写入统一走 `insertRows` 多值 INSERT。
 */
import Database from '@tauri-apps/plugin-sql';
import { execWithRetry, insertRows } from './sql-util';

let _db: Database | null = null;

/** 打字背单词的数据库实例（与其它模块共用同一个 SQLite 文件，表独立） */
export async function getTypingVocabDb(): Promise<Database> {
  if (!_db) {
    _db = await Database.load('sqlite:easy-sail-postgrad-exam.db');
  }
  return _db;
}

// ========== 类型 ==========

/** 四种练习模式：跟打 / 听写 / 自测 / 默写 */
export type TypingMode = 'follow' | 'dictation' | 'selftest' | 'recall';
/** 智能模式（按记忆曲线出题）/ 自由模式（按词库顺序） */
export type TypingPlan = 'smart' | 'free';
export type TypingAccent = 'us' | 'uk';
/** 单次作答结果：一次全对 / 有错但最终正确 / 放弃或未通过 */
export type TypingOutcome = 'perfect' | 'correct' | 'wrong';

export interface TypingBook {
  id: number;
  key: string;
  name: string;
  description: string;
  builtin: boolean;
  wordCount: number;
}

export interface TypingWord {
  id: number;
  bookId: number;
  word: string;
  meaning: string;
  phoneticUk: string;
  phoneticUs: string;
  exampleEn: string;
  exampleZh: string;
  unit: string;
  seq: number;
}

/** 出题队列条目：单词信息 + 当前记忆状态 */
export interface TypingQueueItem extends TypingWord {
  isNew: boolean;
  stage: number;
  dueAt: string | null;
  mastered: boolean;
  favorited: boolean;
  correctCount: number;
  wrongCount: number;
  perfectCount: number;
}

export interface TypingProgress {
  wordId: number;
  stage: number;
  dueAt: string | null;
  mastered: boolean;
  favorited: boolean;
  correctCount: number;
  wrongCount: number;
  perfectCount: number;
  lastResult: string;
  lastMode: string;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
}

export interface TypingProfile {
  activeBookId: number;
  mode: TypingMode;
  plan: TypingPlan;
  dailyNew: number;
  dailyReview: number;
  sessionSize: number;
  accent: TypingAccent;
  ttsOn: boolean;
  ttsRate: number;
  soundOn: boolean;
  soundVolume: number;
  autoNext: boolean;
  showPhonetic: boolean;
  showMeaning: boolean;
  ignoreCase: boolean;
}

/** 新词种子（内置词库与用户导入共用） */
export interface TypingWordSeed {
  word: string;
  meaning: string;
  unit: string;
  seq: number;
  uk: string;
  us: string;
  en: string;
  zh: string;
}

export interface TypingSessionInput {
  bookId: number;
  mode: TypingMode;
  plan: TypingPlan;
  total: number;
  correct: number;
  wrong: number;
  newCount: number;
  reviewCount: number;
  keystrokes: number;
  correctKeystrokes: number;
  durationMs: number;
  wpm: number;
  accuracy: number;
  startedAt: string;
  finishedAt: string;
}

export interface TypingSession extends TypingSessionInput {
  id: number;
}

export interface TypingOverview {
  totalWords: number;
  newWords: number;
  learningWords: number;
  masteredWords: number;
  favoriteWords: number;
  wrongWords: number;
  todaySessions: number;
  todayNew: number;
  todayReviewed: number;
  todayCorrect: number;
  todayTotal: number;
  todayDurationMs: number;
  todayWpm: number;
  todayAccuracy: number;
  totalSessions: number;
  totalDurationMs: number;
  avgAccuracy: number;
  avgWpm: number;
}

export interface TypingDailyPoint {
  day: string;
  sessions: number;
  words: number;
  durationMs: number;
  accuracy: number;
  wpm: number;
}

export interface TypingModeStat {
  mode: TypingMode;
  sessions: number;
  words: number;
  accuracy: number;
  wpm: number;
}

export interface TypingUnitStat {
  unit: string;
  total: number;
  mastered: number;
  wrong: number;
}

// ========== 行转换 ==========

const MODE_SET = new Set<TypingMode>(['follow', 'dictation', 'selftest', 'recall']);
const PLAN_SET = new Set<TypingPlan>(['smart', 'free']);

export function normalizeMode(value: unknown): TypingMode {
  return MODE_SET.has(value as TypingMode) ? (value as TypingMode) : 'follow';
}

function normalizePlan(value: unknown): TypingPlan {
  return PLAN_SET.has(value as TypingPlan) ? (value as TypingPlan) : 'smart';
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function rowToWord(row: Record<string, unknown>): TypingWord {
  return {
    id: num(row.id),
    bookId: num(row.book_id),
    word: str(row.word),
    meaning: str(row.meaning),
    phoneticUk: str(row.phonetic_uk),
    phoneticUs: str(row.phonetic_us),
    exampleEn: str(row.example_en),
    exampleZh: str(row.example_zh),
    unit: str(row.unit),
    seq: num(row.seq),
  };
}

function rowToQueueItem(row: Record<string, unknown>): TypingQueueItem {
  return {
    ...rowToWord(row),
    isNew: num(row.is_new) === 1,
    stage: num(row.p_stage),
    dueAt: row.p_due_at ? str(row.p_due_at) : null,
    mastered: num(row.p_mastered) === 1,
    favorited: num(row.p_favorited) === 1,
    correctCount: num(row.p_correct),
    wrongCount: num(row.p_wrong),
    perfectCount: num(row.p_perfect),
  };
}

function rowToProfile(row: Record<string, unknown>): TypingProfile {
  return {
    activeBookId: num(row.active_book_id),
    mode: normalizeMode(row.mode),
    plan: normalizePlan(row.plan),
    dailyNew: row.daily_new === undefined ? 20 : num(row.daily_new),
    dailyReview: row.daily_review === undefined ? 60 : num(row.daily_review),
    sessionSize: num(row.session_size) || 20,
    accent: row.accent === 'uk' ? 'uk' : 'us',
    ttsOn: num(row.tts_on) !== 0,
    ttsRate: num(row.tts_rate) || 0.9,
    soundOn: num(row.sound_on) !== 0,
    soundVolume: row.sound_volume === undefined ? 0.5 : Math.min(1, Math.max(0, num(row.sound_volume))),
    autoNext: num(row.auto_next) !== 0,
    showPhonetic: num(row.show_phonetic) !== 0,
    showMeaning: num(row.show_meaning) !== 0,
    ignoreCase: num(row.ignore_case) !== 0,
  };
}

function rowToSession(row: Record<string, unknown>): TypingSession {
  return {
    id: num(row.id),
    bookId: num(row.book_id),
    mode: normalizeMode(row.mode),
    plan: normalizePlan(row.plan),
    total: num(row.total),
    correct: num(row.correct),
    wrong: num(row.wrong),
    newCount: num(row.new_count),
    reviewCount: num(row.review_count),
    keystrokes: num(row.keystrokes),
    correctKeystrokes: num(row.correct_keystrokes),
    durationMs: num(row.duration_ms),
    wpm: num(row.wpm),
    accuracy: num(row.accuracy),
    startedAt: str(row.started_at),
    finishedAt: str(row.finished_at),
  };
}

// ========== 词库 ==========

export async function fetchTypingBooks(): Promise<TypingBook[]> {
  const db = await getTypingVocabDb();
  const rows = await db.select<Record<string, unknown>[]>(`
    SELECT b.*,
           (SELECT COUNT(*) FROM typing_vocab_words w WHERE w.book_id = b.id) AS word_count
    FROM typing_vocab_books b
    ORDER BY b.builtin DESC, b.id ASC
  `);
  return rows.map((row) => ({
    id: num(row.id),
    key: str(row.book_key),
    name: str(row.name),
    description: str(row.description),
    builtin: num(row.builtin) === 1,
    wordCount: num(row.word_count),
  }));
}

export interface TypingImportResult {
  bookId: number;
  imported: number;
  skipped: number;
}

/**
 * 导入一个词库。同名词库键已存在时不重复导入，直接返回现有 id。
 * 单词按 (book_id, word) 唯一，已存在的词保留原记忆状态。
 */
export async function importTypingBook(
  meta: { key: string; name: string; description: string; builtin: boolean },
  seeds: TypingWordSeed[],
): Promise<TypingImportResult> {
  const db = await getTypingVocabDb();
  const existing = await db.select<{ id: number }[]>(
    'SELECT id FROM typing_vocab_books WHERE book_key = $1',
    [meta.key],
  );
  if (existing.length > 0) {
    return { bookId: existing[0].id, imported: 0, skipped: seeds.length };
  }

  const inserted = await db.execute(
    'INSERT INTO typing_vocab_books (book_key, name, description, builtin) VALUES ($1, $2, $3, $4)',
    [meta.key, meta.name, meta.description, meta.builtin ? 1 : 0],
  );
  const bookId = Number(inserted.lastInsertId);
  if (!Number.isFinite(bookId) || bookId <= 0) {
    throw new Error('词库创建失败：未取得 book id');
  }

  const rows = seeds
    .filter((s) => s.word.trim() && s.meaning.trim())
    .map((s) => [
      bookId,
      s.word.trim(),
      s.meaning.trim(),
      s.uk,
      s.us,
      s.en,
      s.zh,
      s.unit,
      s.seq,
    ]);

  await insertRows(
    db,
    `INSERT OR IGNORE INTO typing_vocab_words
       (book_id, word, meaning, phonetic_uk, phonetic_us, example_en, example_zh, unit, seq)
     VALUES`,
    9,
    rows,
    100,
  );

  const countRows = await db.select<{ count: number }[]>(
    'SELECT COUNT(*) AS count FROM typing_vocab_words WHERE book_id = $1',
    [bookId],
  );
  const imported = num(countRows[0]?.count);
  return { bookId, imported, skipped: Math.max(0, rows.length - imported) };
}

export async function deleteTypingBook(bookId: number): Promise<void> {
  const db = await getTypingVocabDb();
  await execWithRetry(
    db,
    `DELETE FROM typing_vocab_progress
     WHERE word_id IN (SELECT id FROM typing_vocab_words WHERE book_id = $1)`,
    [bookId],
  );
  await execWithRetry(db, 'DELETE FROM typing_vocab_words WHERE book_id = $1', [bookId]);
  await execWithRetry(db, 'DELETE FROM typing_vocab_sessions WHERE book_id = $1', [bookId]);
  await execWithRetry(db, 'DELETE FROM typing_vocab_books WHERE id = $1', [bookId]);
}

// ========== 设置 ==========

const PROFILE_FIELD_MAP: Record<keyof TypingProfile, string> = {
  activeBookId: 'active_book_id',
  mode: 'mode',
  plan: 'plan',
  dailyNew: 'daily_new',
  dailyReview: 'daily_review',
  sessionSize: 'session_size',
  accent: 'accent',
  ttsOn: 'tts_on',
  ttsRate: 'tts_rate',
  soundOn: 'sound_on',
  soundVolume: 'sound_volume',
  autoNext: 'auto_next',
  showPhonetic: 'show_phonetic',
  showMeaning: 'show_meaning',
  ignoreCase: 'ignore_case',
};

const DEFAULT_PROFILE: TypingProfile = {
  activeBookId: 0,
  mode: 'follow',
  plan: 'smart',
  dailyNew: 20,
  dailyReview: 60,
  sessionSize: 20,
  accent: 'us',
  ttsOn: true,
  ttsRate: 0.9,
  soundOn: true,
  soundVolume: 0.5,
  autoNext: true,
  showPhonetic: true,
  showMeaning: true,
  ignoreCase: true,
};

export async function fetchTypingProfile(): Promise<TypingProfile> {
  const db = await getTypingVocabDb();
  const rows = await db.select<Record<string, unknown>[]>('SELECT * FROM typing_vocab_profile WHERE id = 1');
  if (rows.length === 0) return { ...DEFAULT_PROFILE };
  return rowToProfile(rows[0]);
}

export async function updateTypingProfile(updates: Partial<TypingProfile>): Promise<void> {
  const db = await getTypingVocabDb();
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  for (const [key, col] of Object.entries(PROFILE_FIELD_MAP)) {
    if (!(key in updates)) continue;
    const value = (updates as Record<string, unknown>)[key];
    sets.push(`${col} = $${idx++}`);
    values.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
  }
  if (sets.length === 0) return;
  sets.push(`updated_at = $${idx++}`);
  values.push(new Date().toISOString());
  values.push(1);
  await db.execute(`UPDATE typing_vocab_profile SET ${sets.join(', ')} WHERE id = $${idx}`, values);
}

// ========== 队列 ==========

const QUEUE_SELECT = `
  SELECT w.*,
         p.stage         AS p_stage,
         p.due_at        AS p_due_at,
         p.mastered      AS p_mastered,
         p.favorited     AS p_favorited,
         p.correct_count AS p_correct,
         p.wrong_count   AS p_wrong,
         p.perfect_count AS p_perfect,
         CASE WHEN p.id IS NULL OR p.last_seen_at IS NULL THEN 1 ELSE 0 END AS is_new
  FROM typing_vocab_words w
  LEFT JOIN typing_vocab_progress p ON p.word_id = w.id
`;

export interface TypingQueueOptions {
  nowIso: string;
  /** 本次会话最多出多少词 */
  limit: number;
  /** 智能模式：最多抽多少新词 / 多少复习词 */
  newLimit: number;
  reviewLimit: number;
}

/**
 * 智能模式：到期复习词在前、新词在后（复习优先保住记忆，再学新词）。
 * 自由模式：按单元与序号顺序取未掌握的词，不限到期时间。
 */
export async function buildTypingQueue(
  bookId: number,
  plan: TypingPlan,
  opts: TypingQueueOptions,
): Promise<TypingQueueItem[]> {
  const db = await getTypingVocabDb();
  if (plan === 'free') {
    const rows = await db.select<Record<string, unknown>[]>(
      `${QUEUE_SELECT}
       WHERE w.book_id = $1 AND (p.id IS NULL OR p.mastered = 0)
       ORDER BY w.unit ASC, w.seq ASC
       LIMIT $2`,
      [bookId, Math.max(1, opts.limit)],
    );
    return rows.map(rowToQueueItem);
  }

  const reviewRows = await db.select<Record<string, unknown>[]>(
    `${QUEUE_SELECT}
     WHERE w.book_id = $1 AND p.id IS NOT NULL AND p.mastered = 0
       AND p.due_at IS NOT NULL AND p.due_at <= $2
     ORDER BY p.due_at ASC
     LIMIT $3`,
    [bookId, opts.nowIso, Math.max(0, opts.reviewLimit)],
  );
  const remaining = Math.max(0, opts.limit - reviewRows.length);
  const newRows = remaining > 0
    ? await db.select<Record<string, unknown>[]>(
      // last_seen_at IS NULL 覆盖「只收藏/只标记过、还没真正练过」的词
      `${QUEUE_SELECT}
       WHERE w.book_id = $1 AND (p.id IS NULL OR (p.last_seen_at IS NULL AND p.mastered = 0))
       ORDER BY w.unit ASC, w.seq ASC
       LIMIT $2`,
      [bookId, Math.min(remaining, Math.max(0, opts.newLimit))],
    )
    : [];

  return [...reviewRows, ...newRows].map(rowToQueueItem);
}

/** 专项队列：错词 / 收藏 / 单元（all=false 时只要未掌握） */
export type TypingDrillKind = 'wrong' | 'favorite' | 'unit';

export async function buildTypingDrillQueue(
  bookId: number,
  kind: TypingDrillKind,
  limit: number,
  unit?: string,
): Promise<TypingQueueItem[]> {
  const db = await getTypingVocabDb();
  if (kind === 'wrong') {
    const rows = await db.select<Record<string, unknown>[]>(
      `${QUEUE_SELECT}
       WHERE w.book_id = $1 AND p.wrong_count > 0 AND p.mastered = 0
       ORDER BY p.wrong_count DESC, p.last_seen_at DESC
       LIMIT $2`,
      [bookId, Math.max(1, limit)],
    );
    return rows.map(rowToQueueItem);
  }
  if (kind === 'favorite') {
    const rows = await db.select<Record<string, unknown>[]>(
      `${QUEUE_SELECT}
       WHERE w.book_id = $1 AND p.favorited = 1
       ORDER BY p.last_seen_at DESC
       LIMIT $2`,
      [bookId, Math.max(1, limit)],
    );
    return rows.map(rowToQueueItem);
  }
  const rows = await db.select<Record<string, unknown>[]>(
    `${QUEUE_SELECT}
     WHERE w.book_id = $1 AND w.unit = $2 AND (p.id IS NULL OR p.mastered = 0)
     ORDER BY w.seq ASC
     LIMIT $3`,
    [bookId, unit ?? '', Math.max(1, limit)],
  );
  return rows.map(rowToQueueItem);
}

// ========== 进度 ==========

export async function fetchTypingProgress(wordId: number): Promise<TypingProgress | null> {
  const db = await getTypingVocabDb();
  const rows = await db.select<Record<string, unknown>[]>(
    'SELECT * FROM typing_vocab_progress WHERE word_id = $1',
    [wordId],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    wordId: num(row.word_id),
    stage: num(row.stage),
    dueAt: row.due_at ? str(row.due_at) : null,
    mastered: num(row.mastered) === 1,
    favorited: num(row.favorited) === 1,
    correctCount: num(row.correct_count),
    wrongCount: num(row.wrong_count),
    perfectCount: num(row.perfect_count),
    lastResult: str(row.last_result),
    lastMode: str(row.last_mode),
    firstSeenAt: row.first_seen_at ? str(row.first_seen_at) : null,
    lastSeenAt: row.last_seen_at ? str(row.last_seen_at) : null,
  };
}

export async function upsertTypingProgress(p: TypingProgress): Promise<void> {
  const db = await getTypingVocabDb();
  const nowIso = new Date().toISOString();
  await execWithRetry(
    db,
    `INSERT INTO typing_vocab_progress
       (word_id, stage, due_at, mastered, favorited, correct_count, wrong_count,
        perfect_count, last_result, last_mode, first_seen_at, last_seen_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT(word_id) DO UPDATE SET
       stage = excluded.stage,
       due_at = excluded.due_at,
       mastered = excluded.mastered,
       correct_count = excluded.correct_count,
       wrong_count = excluded.wrong_count,
       perfect_count = excluded.perfect_count,
       last_result = excluded.last_result,
       last_mode = excluded.last_mode,
       first_seen_at = COALESCE(typing_vocab_progress.first_seen_at, excluded.first_seen_at),
       last_seen_at = excluded.last_seen_at,
       updated_at = excluded.updated_at`,
    [
      p.wordId,
      p.stage,
      p.dueAt,
      p.mastered ? 1 : 0,
      p.favorited ? 1 : 0,
      p.correctCount,
      p.wrongCount,
      p.perfectCount,
      p.lastResult,
      p.lastMode,
      p.firstSeenAt ?? nowIso,
      p.lastSeenAt ?? nowIso,
      nowIso,
    ],
  );
}

/** 确保进度行存在（收藏/标记掌握前调用） */
async function ensureTypingProgressRow(wordId: number): Promise<void> {
  const db = await getTypingVocabDb();
  await execWithRetry(
    db,
    'INSERT OR IGNORE INTO typing_vocab_progress (word_id, first_seen_at) VALUES ($1, $2)',
    [wordId, new Date().toISOString()],
  );
}

export async function setTypingWordFavorited(wordId: number, favorited: boolean): Promise<void> {
  await ensureTypingProgressRow(wordId);
  const db = await getTypingVocabDb();
  await execWithRetry(
    db,
    'UPDATE typing_vocab_progress SET favorited = $1, updated_at = $2 WHERE word_id = $3',
    [favorited ? 1 : 0, new Date().toISOString(), wordId],
  );
}

export async function setTypingWordMastered(wordId: number, mastered: boolean): Promise<void> {
  await ensureTypingProgressRow(wordId);
  const db = await getTypingVocabDb();
  await execWithRetry(
    db,
    `UPDATE typing_vocab_progress
     SET mastered = $1, due_at = $2, updated_at = $3
     WHERE word_id = $4`,
    [
      mastered ? 1 : 0,
      mastered ? null : new Date().toISOString(),
      new Date().toISOString(),
      wordId,
    ],
  );
}

/** 重置单词记忆状态（回到新词，保留收藏） */
export async function resetTypingWord(wordId: number): Promise<void> {
  const db = await getTypingVocabDb();
  await execWithRetry(
    db,
    `UPDATE typing_vocab_progress
     SET stage = 0, due_at = NULL, mastered = 0, correct_count = 0, wrong_count = 0,
         perfect_count = 0, last_result = '', last_mode = '', last_seen_at = NULL,
         updated_at = $1
     WHERE word_id = $2`,
    [new Date().toISOString(), wordId],
  );
}

// ========== 列表 ==========

export async function fetchTypingWrongWords(bookId: number, limit = 200): Promise<TypingQueueItem[]> {
  const db = await getTypingVocabDb();
  const rows = await db.select<Record<string, unknown>[]>(
    `${QUEUE_SELECT}
     WHERE w.book_id = $1 AND p.wrong_count > 0 AND p.mastered = 0
     ORDER BY p.wrong_count DESC, p.last_seen_at DESC
     LIMIT $2`,
    [bookId, limit],
  );
  return rows.map(rowToQueueItem);
}

export async function fetchTypingFavoriteWords(bookId: number, limit = 200): Promise<TypingQueueItem[]> {
  const db = await getTypingVocabDb();
  const rows = await db.select<Record<string, unknown>[]>(
    `${QUEUE_SELECT}
     WHERE w.book_id = $1 AND p.favorited = 1
     ORDER BY p.last_seen_at DESC
     LIMIT $2`,
    [bookId, limit],
  );
  return rows.map(rowToQueueItem);
}

export async function fetchTypingMasteredWords(bookId: number, limit = 200): Promise<TypingQueueItem[]> {
  const db = await getTypingVocabDb();
  const rows = await db.select<Record<string, unknown>[]>(
    `${QUEUE_SELECT}
     WHERE w.book_id = $1 AND p.mastered = 1
     ORDER BY p.last_seen_at DESC
     LIMIT $2`,
    [bookId, limit],
  );
  return rows.map(rowToQueueItem);
}

export async function fetchTypingUnits(bookId: number): Promise<TypingUnitStat[]> {
  const db = await getTypingVocabDb();
  const rows = await db.select<Record<string, unknown>[]>(`
    SELECT w.unit AS unit,
           COUNT(*) AS total,
           SUM(CASE WHEN p.mastered = 1 THEN 1 ELSE 0 END) AS mastered,
           SUM(CASE WHEN p.wrong_count > 0 AND p.mastered = 0 THEN 1 ELSE 0 END) AS wrong
    FROM typing_vocab_words w
    LEFT JOIN typing_vocab_progress p ON p.word_id = w.id
    WHERE w.book_id = $1
    GROUP BY w.unit
    ORDER BY w.unit ASC
  `, [bookId]);
  return rows.map((row) => ({
    unit: str(row.unit),
    total: num(row.total),
    mastered: num(row.mastered),
    wrong: num(row.wrong),
  }));
}

/** 搜索词库（单词/释义模糊匹配） */
export async function searchTypingWords(bookId: number, keyword: string, limit = 40): Promise<TypingWord[]> {
  const db = await getTypingVocabDb();
  const like = `%${keyword.trim()}%`;
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT * FROM typing_vocab_words
     WHERE book_id = $1 AND (word LIKE $2 OR meaning LIKE $2)
     ORDER BY unit ASC, seq ASC
     LIMIT $3`,
    [bookId, like, limit],
  );
  return rows.map(rowToWord);
}

// ========== 会话与统计 ==========

export async function insertTypingSession(s: TypingSessionInput): Promise<number> {
  const db = await getTypingVocabDb();
  const result = await db.execute(
    `INSERT INTO typing_vocab_sessions
       (book_id, mode, plan, total, correct, wrong, new_count, review_count,
        keystrokes, correct_keystrokes, duration_ms, wpm, accuracy, started_at, finished_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      s.bookId, s.mode, s.plan, s.total, s.correct, s.wrong, s.newCount, s.reviewCount,
      s.keystrokes, s.correctKeystrokes, s.durationMs, s.wpm, s.accuracy,
      s.startedAt, s.finishedAt,
    ],
  );
  return Number(result.lastInsertId) || 0;
}

export async function fetchTypingRecentSessions(bookId: number, limit = 20): Promise<TypingSession[]> {
  const db = await getTypingVocabDb();
  const rows = await db.select<Record<string, unknown>[]>(
    'SELECT * FROM typing_vocab_sessions WHERE book_id = $1 ORDER BY started_at DESC LIMIT $2',
    [bookId, limit],
  );
  return rows.map(rowToSession);
}

/** 概览：todayStart/tomorrowStart 为本地零点对应的 ISO 时间，避免依赖 SQLite 的时区解析 */
export async function fetchTypingOverview(
  bookId: number,
  todayStartIso: string,
  tomorrowStartIso: string,
): Promise<TypingOverview> {
  const db = await getTypingVocabDb();
  const rows = await db.select<Record<string, unknown>[]>(`
    SELECT
      (SELECT COUNT(*) FROM typing_vocab_words WHERE book_id = $1) AS total_words,
      (SELECT COUNT(*) FROM typing_vocab_words w
         LEFT JOIN typing_vocab_progress p ON p.word_id = w.id
        WHERE w.book_id = $1 AND p.id IS NULL) AS new_words,
      (SELECT COUNT(*) FROM typing_vocab_words w
         JOIN typing_vocab_progress p ON p.word_id = w.id
        WHERE w.book_id = $1 AND p.mastered = 0) AS learning_words,
      (SELECT COUNT(*) FROM typing_vocab_words w
         JOIN typing_vocab_progress p ON p.word_id = w.id
        WHERE w.book_id = $1 AND p.mastered = 1) AS mastered_words,
      (SELECT COUNT(*) FROM typing_vocab_words w
         JOIN typing_vocab_progress p ON p.word_id = w.id
        WHERE w.book_id = $1 AND p.favorited = 1) AS favorite_words,
      (SELECT COUNT(*) FROM typing_vocab_words w
         JOIN typing_vocab_progress p ON p.word_id = w.id
        WHERE w.book_id = $1 AND p.wrong_count > 0 AND p.mastered = 0) AS wrong_words,
      (SELECT COUNT(*) FROM typing_vocab_sessions
        WHERE book_id = $1 AND started_at >= $2 AND started_at < $3) AS today_sessions,
      (SELECT COALESCE(SUM(new_count), 0) FROM typing_vocab_sessions
        WHERE book_id = $1 AND started_at >= $2 AND started_at < $3) AS today_new,
      (SELECT COALESCE(SUM(review_count), 0) FROM typing_vocab_sessions
        WHERE book_id = $1 AND started_at >= $2 AND started_at < $3) AS today_reviewed,
      (SELECT COALESCE(SUM(correct), 0) FROM typing_vocab_sessions
        WHERE book_id = $1 AND started_at >= $2 AND started_at < $3) AS today_correct,
      (SELECT COALESCE(SUM(total), 0) FROM typing_vocab_sessions
        WHERE book_id = $1 AND started_at >= $2 AND started_at < $3) AS today_total,
      (SELECT COALESCE(SUM(duration_ms), 0) FROM typing_vocab_sessions
        WHERE book_id = $1 AND started_at >= $2 AND started_at < $3) AS today_duration,
      (SELECT COALESCE(AVG(wpm), 0) FROM typing_vocab_sessions
        WHERE book_id = $1 AND started_at >= $2 AND started_at < $3) AS today_wpm,
      (SELECT COUNT(*) FROM typing_vocab_sessions WHERE book_id = $1) AS total_sessions,
      (SELECT COALESCE(SUM(duration_ms), 0) FROM typing_vocab_sessions WHERE book_id = $1) AS total_duration,
      (SELECT COALESCE(AVG(accuracy), 0) FROM typing_vocab_sessions WHERE book_id = $1) AS avg_accuracy,
      (SELECT COALESCE(AVG(wpm), 0) FROM typing_vocab_sessions WHERE book_id = $1) AS avg_wpm
  `, [bookId, todayStartIso, tomorrowStartIso]);
  const row = rows[0] ?? {};
  const todayTotal = num(row.today_total);
  const todayCorrect = num(row.today_correct);
  return {
    totalWords: num(row.total_words),
    newWords: num(row.new_words),
    learningWords: num(row.learning_words),
    masteredWords: num(row.mastered_words),
    favoriteWords: num(row.favorite_words),
    wrongWords: num(row.wrong_words),
    todaySessions: num(row.today_sessions),
    todayNew: num(row.today_new),
    todayReviewed: num(row.today_reviewed),
    todayCorrect,
    todayTotal,
    todayDurationMs: num(row.today_duration),
    todayWpm: num(row.today_wpm),
    todayAccuracy: todayTotal > 0 ? todayCorrect / todayTotal : 0,
    totalSessions: num(row.total_sessions),
    totalDurationMs: num(row.total_duration),
    avgAccuracy: num(row.avg_accuracy),
    avgWpm: num(row.avg_wpm),
  };
}

/** 到期复习数量（智能模式今日待办） */
export async function fetchTypingDueCount(bookId: number, nowIso: string): Promise<number> {
  const db = await getTypingVocabDb();
  const rows = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) AS count
     FROM typing_vocab_progress p
     JOIN typing_vocab_words w ON w.id = p.word_id
     WHERE w.book_id = $1 AND p.mastered = 0
       AND p.due_at IS NOT NULL AND p.due_at <= $2`,
    [bookId, nowIso],
  );
  return num(rows[0]?.count);
}

export async function fetchTypingDailyStats(bookId: number, days = 7): Promise<TypingDailyPoint[]> {
  const db = await getTypingVocabDb();
  // 本地零点：按「本地日期」分组在 TS 里做，避免 SQLite 对 ISO 时区串解析差异
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - (days - 1));

  const rows = await db.select<Record<string, unknown>[]>(`
    SELECT started_at, total, duration_ms, accuracy, wpm
    FROM typing_vocab_sessions
    WHERE book_id = $1 AND started_at >= $2
    ORDER BY started_at ASC
  `, [bookId, since.toISOString()]);

  const buckets = new Map<string, {
    sessions: number;
    words: number;
    durationMs: number;
    accuracySum: number;
    wpmSum: number;
  }>();
  for (const row of rows) {
    const date = new Date(str(row.started_at));
    if (Number.isNaN(date.getTime())) continue;
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const bucket = buckets.get(day) ?? { sessions: 0, words: 0, durationMs: 0, accuracySum: 0, wpmSum: 0 };
    bucket.sessions += 1;
    bucket.words += num(row.total);
    bucket.durationMs += num(row.duration_ms);
    bucket.accuracySum += num(row.accuracy);
    bucket.wpmSum += num(row.wpm);
    buckets.set(day, bucket);
  }

  return Array.from(buckets.entries()).map(([day, bucket]) => ({
    day,
    sessions: bucket.sessions,
    words: bucket.words,
    durationMs: bucket.durationMs,
    accuracy: bucket.sessions > 0 ? bucket.accuracySum / bucket.sessions : 0,
    wpm: bucket.sessions > 0 ? bucket.wpmSum / bucket.sessions : 0,
  }));
}

export async function fetchTypingModeStats(bookId: number): Promise<TypingModeStat[]> {
  const db = await getTypingVocabDb();
  const rows = await db.select<Record<string, unknown>[]>(`
    SELECT mode, COUNT(*) AS sessions, COALESCE(SUM(total), 0) AS words,
           COALESCE(AVG(accuracy), 0) AS accuracy, COALESCE(AVG(wpm), 0) AS wpm
    FROM typing_vocab_sessions
    WHERE book_id = $1
    GROUP BY mode
  `, [bookId]);
  return rows.map((row) => ({
    mode: normalizeMode(row.mode),
    sessions: num(row.sessions),
    words: num(row.words),
    accuracy: num(row.accuracy),
    wpm: num(row.wpm),
  }));
}

/** 单元进度（自由模式按单元挑选时用） */
export async function fetchTypingUnitWords(bookId: number, unit: string): Promise<TypingQueueItem[]> {
  return buildTypingDrillQueue(bookId, 'unit', 500, unit);
}

// ========== 备份 ==========

export interface TypingBackup {
  version: 1;
  exportedAt: string;
  books: {
    key: string;
    name: string;
    description: string;
    builtin: boolean;
    words: (string | number)[][];
  }[];
  progress: (string | number | null)[][];
  sessions: (string | number | null)[][];
  profile: TypingProfile;
}

const BACKUP_WORD_COLUMNS = 8;

/** 全量导出（自备份，不走云同步，保持模块独立） */
export async function exportTypingBackup(): Promise<TypingBackup> {
  const db = await getTypingVocabDb();
  const bookRows = await db.select<Record<string, unknown>[]>(
    'SELECT * FROM typing_vocab_books ORDER BY id ASC',
  );
  const books: TypingBackup['books'] = [];
  for (const book of bookRows) {
    const bookId = num(book.id);
    const wordRows = await db.select<Record<string, unknown>[]>(
      `SELECT word, meaning, unit, seq, phonetic_uk, phonetic_us, example_en, example_zh
       FROM typing_vocab_words WHERE book_id = $1 ORDER BY unit ASC, seq ASC`,
      [bookId],
    );
    books.push({
      key: str(book.book_key),
      name: str(book.name),
      description: str(book.description),
      builtin: num(book.builtin) === 1,
      words: wordRows.map((row) => [
        str(row.word), str(row.meaning), str(row.unit), num(row.seq),
        str(row.phonetic_uk), str(row.phonetic_us), str(row.example_en), str(row.example_zh),
      ]),
    });
  }

  const progressRows = await db.select<Record<string, unknown>[]>(`
    SELECT b.book_key AS book_key, w.word AS word,
           p.stage, p.due_at, p.mastered, p.favorited, p.correct_count, p.wrong_count,
           p.perfect_count, p.last_result, p.last_mode, p.first_seen_at, p.last_seen_at
    FROM typing_vocab_progress p
    JOIN typing_vocab_words w ON w.id = p.word_id
    JOIN typing_vocab_books b ON b.id = w.book_id
  `);

  const sessionRows = await db.select<Record<string, unknown>[]>(`
    SELECT b.book_key AS book_key, s.mode, s.plan, s.total, s.correct, s.wrong,
           s.new_count, s.review_count, s.keystrokes, s.correct_keystrokes,
           s.duration_ms, s.wpm, s.accuracy, s.started_at, s.finished_at
    FROM typing_vocab_sessions s
    JOIN typing_vocab_books b ON b.id = s.book_id
    ORDER BY s.id ASC
  `);

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    books,
    progress: progressRows.map((row) => [
      str(row.book_key), str(row.word),
      num(row.stage), str(row.due_at) || null, num(row.mastered), num(row.favorited),
      num(row.correct_count), num(row.wrong_count), num(row.perfect_count),
      str(row.last_result), str(row.last_mode),
      str(row.first_seen_at) || null, str(row.last_seen_at) || null,
    ]),
    sessions: sessionRows.map((row) => [
      str(row.book_key), str(row.mode), str(row.plan),
      num(row.total), num(row.correct), num(row.wrong),
      num(row.new_count), num(row.review_count),
      num(row.keystrokes), num(row.correct_keystrokes),
      num(row.duration_ms), num(row.wpm), num(row.accuracy),
      str(row.started_at), str(row.finished_at) || null,
    ]),
    profile: await fetchTypingProfile(),
  };
}

/** 用备份覆盖本模块全部数据（不动其它模块的表） */
export async function replaceTypingBackup(data: TypingBackup): Promise<void> {
  if (!data || data.version !== 1 || !Array.isArray(data.books)) {
    throw new Error('备份文件格式不正确（缺少 version 1 或 books）');
  }
  const db = await getTypingVocabDb();
  await execWithRetry(db, 'DELETE FROM typing_vocab_progress', []);
  await execWithRetry(db, 'DELETE FROM typing_vocab_words', []);
  await execWithRetry(db, 'DELETE FROM typing_vocab_sessions', []);
  await execWithRetry(db, 'DELETE FROM typing_vocab_books', []);

  const bookIdByKey = new Map<string, number>();
  for (const book of data.books) {
    const result = await db.execute(
      'INSERT INTO typing_vocab_books (book_key, name, description, builtin) VALUES ($1, $2, $3, $4)',
      [book.key, book.name, book.description || '', book.builtin ? 1 : 0],
    );
    const bookId = Number(result.lastInsertId);
    bookIdByKey.set(book.key, bookId);
    const rows = book.words
      .filter((row) => Array.isArray(row) && row.length >= 2 && String(row[0]).trim())
      .map((row) => {
        const padded = row.slice(0, BACKUP_WORD_COLUMNS);
        while (padded.length < BACKUP_WORD_COLUMNS) padded.push('');
        return [bookId, ...padded];
      });
    await insertRows(
      db,
      `INSERT OR IGNORE INTO typing_vocab_words
         (book_id, word, meaning, unit, seq, phonetic_uk, phonetic_us, example_en, example_zh)
       VALUES`,
      9,
      rows,
      100,
    );
  }

  // 一次查出全部 word→id，避免逐词 select（5000+ 词会非常慢）
  const wordIdCache = new Map<string, number>();
  for (const [bookKey, bookId] of bookIdByKey) {
    const wordRows = await db.select<{ id: number; word: string }[]>(
      'SELECT id, word FROM typing_vocab_words WHERE book_id = $1',
      [bookId],
    );
    for (const row of wordRows) wordIdCache.set(`${bookKey}\u0000${row.word}`, row.id);
  }

  const progressRows: unknown[][] = [];
  for (const row of data.progress) {
    const [bookKey, word, stage, dueAt, mastered, favorited, correct, wrong, perfect, lastResult, lastMode, firstSeen, lastSeen] = row;
    if (!bookIdByKey.has(String(bookKey))) continue;
    const wordId = wordIdCache.get(`${String(bookKey)}\u0000${String(word)}`);
    if (!wordId) continue;
    progressRows.push([
      wordId, Number(stage) || 0, dueAt ?? null, Number(mastered) ? 1 : 0, Number(favorited) ? 1 : 0,
      Number(correct) || 0, Number(wrong) || 0, Number(perfect) || 0,
      String(lastResult ?? ''), String(lastMode ?? ''), firstSeen ?? null, lastSeen ?? null,
      new Date().toISOString(),
    ]);
  }
  await insertRows(
    db,
    `INSERT OR REPLACE INTO typing_vocab_progress
       (word_id, stage, due_at, mastered, favorited, correct_count, wrong_count,
        perfect_count, last_result, last_mode, first_seen_at, last_seen_at, updated_at)
     VALUES`,
    13,
    progressRows,
    100,
  );

  const sessionRows: unknown[][] = [];
  for (const row of data.sessions) {
    const [bookKey, mode, plan, total, correct, wrong, newCount, reviewCount,
      keystrokes, correctKeystrokes, durationMs, wpm, accuracy, startedAt, finishedAt] = row;
    const bookId = bookIdByKey.get(String(bookKey));
    if (!bookId) continue;
    sessionRows.push([
      bookId, String(mode), String(plan), Number(total) || 0, Number(correct) || 0,
      Number(wrong) || 0, Number(newCount) || 0, Number(reviewCount) || 0,
      Number(keystrokes) || 0, Number(correctKeystrokes) || 0,
      Number(durationMs) || 0, Number(wpm) || 0, Number(accuracy) || 0,
      String(startedAt), finishedAt ? String(finishedAt) : null,
    ]);
  }
  await insertRows(
    db,
    `INSERT INTO typing_vocab_sessions
       (book_id, mode, plan, total, correct, wrong, new_count, review_count,
        keystrokes, correct_keystrokes, duration_ms, wpm, accuracy, started_at, finished_at)
     VALUES`,
    15,
    sessionRows,
    100,
  );

  if (data.profile) {
    const restoredIds = new Set(bookIdByKey.values());
    const fallbackId = bookIdByKey.values().next().value ?? 0;
    await updateTypingProfile({
      ...data.profile,
      activeBookId: restoredIds.has(data.profile.activeBookId)
        ? data.profile.activeBookId
        : fallbackId,
    });
  }
}
