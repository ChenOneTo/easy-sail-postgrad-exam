/**
 * 单词闯关数据访问层。
 *
 * 与「背单词」共用 exam_vocab_words / cards / reviews 三张表，只新增成绩表
 * exam_vocab_game_runs（migration 15）。关卡不另存快照：已通过关卡的词数累计
 * 即学习推进量，取下一关时按该偏移从词库顺序切块，因此改「每关词数」不会回退进度。
 */
import { getExamVocabDb } from './exam-vocab-db';
import type { VocabQueueItem } from './exam-vocab-db';

/** 闯关固定的取卡方向：词卡正面是英文，测验为英译中 */
export const GAME_DIRECTION = 'en2zh';

export interface GameRun {
  id: number;
  level: number;
  levelSize: number;
  wordsTotal: number;
  correct: number;
  answered: number;
  accuracy: number;
  durationMs: number;
  passed: boolean;
  /** 重闯已通关卡：成绩照常记录，但不计入关卡进度 */
  replay: boolean;
  startedAt: string;
  finishedAt: string;
}

export interface GameProgress {
  /** 已通过关卡的词数累计，同时是下一关在词库中的偏移 */
  passedWords: number;
  /** 已通过关卡数（去重前按关卡号统计，重闯不会重复计数） */
  passedLevels: number;
  totalRuns: number;
  avgAccuracy: number;
  todayPassed: number;
  todayMinutes: number;
  /** 累计学习时长（分钟，含背单词与闯关的全部复习记录） */
  totalMinutes: number;
}

export interface WordStatusCounts {
  new: number;
  seen: number;
  familiar: number;
  mastered: number;
}

export interface DailyMinutes {
  date: string;
  minutes: number;
}

function rowToRun(row: Record<string, unknown>): GameRun {
  return {
    id: (row.id as number) ?? 0,
    level: (row.level as number) ?? 1,
    levelSize: (row.level_size as number) ?? 20,
    wordsTotal: (row.words_total as number) ?? 0,
    correct: (row.correct as number) ?? 0,
    answered: (row.answered as number) ?? 0,
    accuracy: (row.accuracy as number) ?? 0,
    durationMs: (row.duration_ms as number) ?? 0,
    passed: !!((row.passed as number) ?? 0),
    replay: !!((row.replay as number) ?? 0),
    startedAt: (row.started_at as string) || '',
    finishedAt: (row.finished_at as string) || '',
  };
}

function rowToQueueItem(row: Record<string, unknown>): VocabQueueItem {
  const state = (row.state as string) || 'new';
  return {
    id: row.id as number,
    wordId: row.word_id as number,
    direction: GAME_DIRECTION,
    state: state === 'learning' || state === 'review' || state === 'relearning' ? state : 'new',
    stepIdx: (row.step_idx as number) ?? 0,
    due: (row.due as string) || null,
    stability: (row.stability as number) ?? 0,
    difficulty: (row.difficulty as number) ?? 0,
    reps: (row.reps as number) ?? 0,
    lapses: (row.lapses as number) ?? 0,
    lastReviewedAt: (row.last_reviewed_at as string) || null,
    createdAt: (row.created_at as string) || '',
    updatedAt: (row.updated_at as string) || '',
    word: (row.word as string) || '',
    meaning: (row.meaning as string) || '',
    unit: (row.unit as string) || '',
    coreZone: !!((row.core_zone as number) ?? 0),
  };
}

/** 词库顺序：核心区优先，再按单元/序号。关卡偏移与词书阅读顺序一致 */
const WORD_ORDER = 'ORDER BY w.core_zone DESC, w.unit ASC, w.seq ASC';

/** 取某关的词（含 en2zh 卡的调度状态） */
export async function fetchLevelWords(offset: number, limit: number): Promise<VocabQueueItem[]> {
  const db = await getExamVocabDb();
  const rows = await db.select<Record<string, unknown>[]>(`
    SELECT c.*, w.word, w.meaning, w.unit, w.core_zone
    FROM exam_vocab_words w
    JOIN exam_vocab_cards c ON c.word_id = w.id AND c.direction = $1
    WHERE w.archived = 0
    ${WORD_ORDER}
    LIMIT $2 OFFSET $3
  `, [GAME_DIRECTION, limit, offset]);
  return rows.map(rowToQueueItem);
}

/** 全局搜索词条（单词本用），按词库顺序取前 limit 条 */
export async function searchGameWords(keyword: string, limit = 100): Promise<VocabQueueItem[]> {
  const db = await getExamVocabDb();
  const like = `%${keyword.trim()}%`;
  const rows = await db.select<Record<string, unknown>[]>(`
    SELECT c.*, w.word, w.meaning, w.unit, w.core_zone
    FROM exam_vocab_words w
    JOIN exam_vocab_cards c ON c.word_id = w.id AND c.direction = $1
    WHERE w.archived = 0 AND (w.word LIKE $2 OR w.meaning LIKE $2)
    ${WORD_ORDER}
    LIMIT $3
  `, [GAME_DIRECTION, like, limit]);
  return rows.map(rowToQueueItem);
}

export async function fetchGameProgress(): Promise<GameProgress> {
  const db = await getExamVocabDb();
  // 所有进度口径都排除重闯记录（replay = 1），否则重刷已通关卡会重复累加进度
  const rows = await db.select<Record<string, unknown>[]>(`
    SELECT
      (SELECT COALESCE(SUM(words_total), 0) FROM exam_vocab_game_runs WHERE passed = 1 AND replay = 0) AS passedWords,
      (SELECT COUNT(DISTINCT level) FROM exam_vocab_game_runs WHERE passed = 1 AND replay = 0) AS passedLevels,
      (SELECT COUNT(*) FROM exam_vocab_game_runs WHERE replay = 0) AS totalRuns,
      (SELECT COALESCE(AVG(accuracy), 0) FROM exam_vocab_game_runs WHERE replay = 0) AS avgAccuracy,
      (SELECT COUNT(*) FROM exam_vocab_game_runs
        WHERE passed = 1 AND replay = 0 AND date(finished_at, 'localtime') = date('now', 'localtime')) AS todayPassed,
      (SELECT COALESCE(SUM(duration_ms), 0) FROM exam_vocab_reviews
        WHERE date(reviewed_at, 'localtime') = date('now', 'localtime')) AS todayMs,
      (SELECT COALESCE(SUM(duration_ms), 0) FROM exam_vocab_reviews) AS totalMs
  `);
  const r = rows[0] ?? {};
  return {
    passedWords: (r.passedWords as number) ?? 0,
    passedLevels: (r.passedLevels as number) ?? 0,
    totalRuns: (r.totalRuns as number) ?? 0,
    avgAccuracy: (r.avgAccuracy as number) ?? 0,
    todayPassed: (r.todayPassed as number) ?? 0,
    todayMinutes: Math.round(((r.todayMs as number) ?? 0) / 60000),
    totalMinutes: Math.round(((r.totalMs as number) ?? 0) / 60000),
  };
}

/**
 * 掌握分布。
 * 卡片状态只有 4 档（new/learning/review/relearning），这里按复习次数再细分，
 * 让「见过 / 熟悉 / 掌握」与设计稿的四档口径一致：
 * 新学 = 未学；见过 = 学习中或只复习过 1 次；熟悉 = 复习过 2 次；掌握 = 3 次以上。
 */
export async function fetchWordStatusCounts(): Promise<WordStatusCounts> {
  const db = await getExamVocabDb();
  const rows = await db.select<Record<string, unknown>[]>(`
    SELECT
      SUM(CASE WHEN c.state = 'new' THEN 1 ELSE 0 END) AS newCount,
      SUM(CASE WHEN c.state IN ('learning','relearning') OR (c.state = 'review' AND c.reps <= 1) THEN 1 ELSE 0 END) AS seenCount,
      SUM(CASE WHEN c.state = 'review' AND c.reps = 2 THEN 1 ELSE 0 END) AS familiarCount,
      SUM(CASE WHEN c.state = 'review' AND c.reps >= 3 THEN 1 ELSE 0 END) AS masteredCount
    FROM exam_vocab_cards c
    JOIN exam_vocab_words w ON w.id = c.word_id
    WHERE c.direction = $1 AND w.archived = 0
  `, [GAME_DIRECTION]);
  const r = rows[0] ?? {};
  return {
    new: (r.newCount as number) ?? 0,
    seen: (r.seenCount as number) ?? 0,
    familiar: (r.familiarCount as number) ?? 0,
    mastered: (r.masteredCount as number) ?? 0,
  };
}

/** 最近 7 天每日学习分钟数（含今天；无记录的日子由调用方补 0） */
export async function fetchWeeklyMinutes(): Promise<DailyMinutes[]> {
  const db = await getExamVocabDb();
  const rows = await db.select<Record<string, unknown>[]>(`
    SELECT date(reviewed_at, 'localtime') AS day, COALESCE(SUM(duration_ms), 0) AS ms
    FROM exam_vocab_reviews
    WHERE date(reviewed_at, 'localtime') >= date('now', 'localtime', '-6 days')
    GROUP BY day
    ORDER BY day ASC
  `);
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set((row.day as string) || '', Math.round(((row.ms as number) ?? 0) / 60000));
  }
  // 用本地日期逐日回填，避免 SQLite/JS 时区差异导致的空列
  const out: DailyMinutes[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push({ date: key, minutes: map.get(key) ?? 0 });
  }
  return out;
}

export async function fetchRecentRuns(limit = 5): Promise<GameRun[]> {
  const db = await getExamVocabDb();
  const rows = await db.select<Record<string, unknown>[]>(
    'SELECT * FROM exam_vocab_game_runs ORDER BY finished_at DESC, id DESC LIMIT $1',
    [limit]
  );
  return rows.map(rowToRun);
}

export async function insertGameRun(input: {
  level: number;
  levelSize: number;
  wordsTotal: number;
  correct: number;
  answered: number;
  accuracy: number;
  durationMs: number;
  passed: boolean;
  replay: boolean;
  startedAt: string;
}): Promise<void> {
  const db = await getExamVocabDb();
  await db.execute(
    `INSERT INTO exam_vocab_game_runs
       (level, level_size, words_total, correct, answered, accuracy, duration_ms, passed, replay, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      input.level, input.levelSize, input.wordsTotal, input.correct, input.answered,
      input.accuracy, input.durationMs, input.passed ? 1 : 0, input.replay ? 1 : 0, input.startedAt,
    ]
  );
}
