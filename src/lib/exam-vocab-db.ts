import Database from '@tauri-apps/plugin-sql';
import { errText } from './error-text';

let _db: Database | null = null;

/** 获取背单词模块的数据库实例（与 tasks/exam 共用同一 SQLite 文件，表完全独立） */
export async function getExamVocabDb(): Promise<Database> {
  if (!_db) {
    _db = await Database.load('sqlite:easy-sail-postgrad-exam.db');
  }
  return _db;
}

// ========== 批量写入工具 ==========

/** 每批拼多少行（100 行 × 13 列 ≈ 1300 个绑定变量，远低于 SQLite 变量上限） */
const BATCH_SIZE = 100;

/**
 * 执行写语句，遇到数据库被占用（SQLITE_BUSY，多连接写冲突）时退避重试。
 * 逐条 IPC 写入 thousands 行时容易与通知引擎等其它连接撞写锁。
 */
async function execWithRetry(db: Database, sql: string, values: unknown[], attempts = 4): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await db.execute(sql, values);
      return;
    } catch (err) {
      const msg = errText(err);
      if (attempt >= attempts || !/locked|busy/i.test(msg)) throw err;
      await new Promise((r) => setTimeout(r, 300 * attempt));
    }
  }
}

/**
 * 批量插入：把多行拼成一条多值 INSERT，减少 IPC 往返。
 * 单条语句 1 万次 execute 会让写事务持续数分钟，极易撞上 SQLite 写锁。
 */
async function insertRows(
  db: Database,
  prefix: string,
  columns: number,
  rows: unknown[][],
  batchSize = BATCH_SIZE,
): Promise<void> {
  for (let i = 0; i < rows.length; i += batchSize) {
    const slice = rows.slice(i, i + batchSize);
    const tuples: string[] = [];
    const values: unknown[] = [];
    for (const row of slice) {
      const start = values.length + 1;
      tuples.push(`(${Array.from({ length: columns }, (_, c) => `$${start + c}`).join(',')})`);
      values.push(...row);
    }
    await execWithRetry(db, `${prefix} ${tuples.join(',')}`, values);
  }
}

// ========== 类型 ==========

export interface VocabWord {
  id: number;
  word: string;
  meaning: string;
  unit: string;        // 'U01'..'U26'
  seq: number;
  coreZone: boolean;   // true=核心区(U01-U13)
  archived: boolean;
}

export type CardState = 'new' | 'learning' | 'review' | 'relearning';
export type CardDirection = 'en2zh' | 'zh2en';

export interface VocabCard {
  id: number;
  wordId: number;
  direction: CardDirection;
  state: CardState;
  stepIdx: number;        // learning_steps
  due: string | null;     // ISO
  stability: number;
  difficulty: number;     // ts-fsrs D∈[1,10]，0=未初始化
  reps: number;
  lapses: number;
  lastReviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 队列项：卡片 + 词面信息（JOIN 结果） */
export interface VocabQueueItem extends VocabCard {
  word: string;
  meaning: string;
  unit: string;
  coreZone: boolean;
}

export interface VocabReview {
  id: number;
  cardId: number;
  wordId: number;
  rating: number;         // 1=Again 2=Hard 3=Good 4=Easy
  stateBefore: CardState;
  intervalDays: number;
  durationMs: number;
  reviewedAt: string;
}

export type HardwordStatus = 'new' | 'grasped';

export interface VocabHardWord {
  id: number;
  wordId: number;
  reason: string;
  againStreak: number;
  note: string;
  status: HardwordStatus;
  addedAt: string;
  updatedAt: string;
  word?: string;          // JOIN 带出，供列表展示
  meaning?: string;
  unit?: string;
}

/** AI 助记（记忆法 + 词根/口诀 + 画面联想 + 例句），按 word_id 唯一，AI 生成后持久化 */
export interface VocabMnemonicRecord {
  wordId: number;
  roots: string;
  mnemonic: string;
  /** 记忆法类型：谐音 / 词根 / 拆分 / 画面 / 故事（旧记录为空串） */
  method: string;
  /** 生动画面或小故事（旧记录为空串） */
  scene: string;
  sentence: string;
  sentenceZh: string;
  createdAt: string;
  updatedAt: string;
}

export interface VocabProfile {
  cardDirection: 'en2zh' | 'zh2en' | 'both';
  targetRetention: number;
  maxReviewsPerDay: number;
  phase1Start: string;
  phase1End: string;
  phase1NewPerDay: number;
  phase2Start: string;
  phase2End: string;
  phase2NewPerDay: number;
  phase3Start: string;
  phase3End: string;
  phase3NewPerDay: number;
  lastStudyDate: string | null;
  streak: number;
}

/** 云盘备份/恢复的完整快照（words 词库本体不进快照，可从 TSV 重导） */
export interface ExamVocabCloudSnapshot {
  profile: VocabProfile;
  cards: VocabCard[];
  reviews: VocabReview[];
  hardwords: Omit<VocabHardWord, 'word' | 'meaning' | 'unit'>[];
  /** AI 助记（旧备份无此字段，恢复时容错为 []） */
  mnemonics?: VocabMnemonicRecord[];
  /** 单词闯关成绩（关卡进度由此累计；旧备份无此字段，恢复时容错为 []） */
  gameRuns?: VocabGameRunRow[];
}

/** 单词闯关成绩行（exam_vocab_game_runs 的快照形态） */
export interface VocabGameRunRow {
  id: number;
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
  finishedAt: string;
}

// ========== 行转换（容错） ==========

const STATE_SET = new Set(['new', 'learning', 'review', 'relearning']);
const DIR_SET = new Set(['en2zh', 'zh2en']);

function rowToWord(row: Record<string, unknown>): VocabWord {
  return {
    id: row.id as number,
    word: (row.word as string) || '',
    meaning: (row.meaning as string) || '',
    unit: (row.unit as string) || '',
    seq: (row.seq as number) || 0,
    coreZone: !!((row.core_zone as number) ?? 0),
    archived: !!((row.archived as number) ?? 0),
  };
}

function rowToCard(row: Record<string, unknown>): VocabCard {
  const state = (row.state as string) || 'new';
  const direction = (row.direction as string) || 'en2zh';
  return {
    id: row.id as number,
    wordId: row.word_id as number,
    direction: DIR_SET.has(direction) ? (direction as CardDirection) : 'en2zh',
    state: STATE_SET.has(state) ? (state as CardState) : 'new',
    stepIdx: (row.step_idx as number) ?? 0,
    due: (row.due as string) || null,
    stability: (row.stability as number) ?? 0,
    difficulty: (row.difficulty as number) ?? 0,
    reps: (row.reps as number) ?? 0,
    lapses: (row.lapses as number) ?? 0,
    lastReviewedAt: (row.last_reviewed_at as string) || null,
    createdAt: (row.created_at as string) || '',
    updatedAt: (row.updated_at as string) || '',
  };
}

function rowToQueueItem(row: Record<string, unknown>): VocabQueueItem {
  const card = rowToCard(row);
  return {
    ...card,
    word: (row.word as string) || '',
    meaning: (row.meaning as string) || '',
    unit: (row.unit as string) || '',
    coreZone: !!((row.core_zone as number) ?? 0),
  };
}

function rowToReview(row: Record<string, unknown>): VocabReview {
  const sb = (row.state_before as string) || 'new';
  return {
    id: row.id as number,
    cardId: row.card_id as number,
    wordId: row.word_id as number,
    rating: (row.rating as number) ?? 3,
    stateBefore: STATE_SET.has(sb) ? (sb as CardState) : 'new',
    intervalDays: (row.interval_days as number) ?? 0,
    durationMs: (row.duration_ms as number) ?? 0,
    reviewedAt: (row.reviewed_at as string) || '',
  };
}

function rowToHardword(row: Record<string, unknown>): VocabHardWord {
  const status = (row.status as string) || 'new';
  return {
    id: row.id as number,
    wordId: row.word_id as number,
    reason: (row.reason as string) || '',
    againStreak: (row.again_streak as number) ?? 0,
    note: (row.note as string) || '',
    status: status === 'grasped' ? 'grasped' : 'new',
    addedAt: (row.added_at as string) || '',
    updatedAt: (row.updated_at as string) || '',
    word: (row.word as string) || undefined,
    meaning: (row.meaning as string) || undefined,
    unit: (row.unit as string) || undefined,
  };
}

function rowToMnemonic(row: Record<string, unknown>): VocabMnemonicRecord {
  return {
    wordId: row.word_id as number,
    roots: (row.roots as string) || '',
    mnemonic: (row.mnemonic as string) || '',
    method: (row.method as string) || '',
    scene: (row.scene as string) || '',
    sentence: (row.sentence as string) || '',
    sentenceZh: (row.sentence_zh as string) || '',
    createdAt: (row.created_at as string) || '',
    updatedAt: (row.updated_at as string) || '',
  };
}

function rowToGameRun(row: Record<string, unknown>): VocabGameRunRow {
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

function rowToProfile(row: Record<string, unknown>): VocabProfile {
  const dir = (row.card_direction as string) || 'en2zh';
  return {
    cardDirection: dir === 'zh2en' || dir === 'both' ? dir : 'en2zh',
    targetRetention: (row.target_retention as number) ?? 0.9,
    maxReviewsPerDay: (row.max_reviews_per_day as number) ?? 200,
    phase1Start: (row.phase1_start as string) || '2026-09-06',
    phase1End: (row.phase1_end as string) || '2026-10-26',
    phase1NewPerDay: (row.phase1_new_per_day as number) ?? 50,
    phase2Start: (row.phase2_start as string) || '2026-10-27',
    phase2End: (row.phase2_end as string) || '2026-12-02',
    phase2NewPerDay: (row.phase2_new_per_day as number) ?? 70,
    phase3Start: (row.phase3_start as string) || '2026-12-03',
    phase3End: (row.phase3_end as string) || '2026-12-18',
    phase3NewPerDay: (row.phase3_new_per_day as number) ?? 0,
    lastStudyDate: (row.last_study_date as string) || null,
    streak: (row.streak as number) ?? 0,
  };
}

// ========== Profile ==========

const DEFAULT_PROFILE: VocabProfile = {
  cardDirection: 'en2zh',
  targetRetention: 0.9,
  maxReviewsPerDay: 200,
  phase1Start: '2026-09-06', phase1End: '2026-10-26', phase1NewPerDay: 50,
  phase2Start: '2026-10-27', phase2End: '2026-12-02', phase2NewPerDay: 70,
  phase3Start: '2026-12-03', phase3End: '2026-12-18', phase3NewPerDay: 0,
  lastStudyDate: null,
  streak: 0,
};

export async function fetchVocabProfile(): Promise<VocabProfile> {
  const db = await getExamVocabDb();
  const rows = await db.select<Record<string, unknown>[]>('SELECT * FROM exam_vocab_profile WHERE id = 1');
  if (rows.length === 0) return { ...DEFAULT_PROFILE };
  return rowToProfile(rows[0]);
}

const PROFILE_FIELD_MAP: Record<keyof VocabProfile, string> = {
  cardDirection: 'card_direction',
  targetRetention: 'target_retention',
  maxReviewsPerDay: 'max_reviews_per_day',
  phase1Start: 'phase1_start', phase1End: 'phase1_end', phase1NewPerDay: 'phase1_new_per_day',
  phase2Start: 'phase2_start', phase2End: 'phase2_end', phase2NewPerDay: 'phase2_new_per_day',
  phase3Start: 'phase3_start', phase3End: 'phase3_end', phase3NewPerDay: 'phase3_new_per_day',
  lastStudyDate: 'last_study_date',
  streak: 'streak',
};

export async function updateVocabProfile(updates: Partial<VocabProfile>): Promise<void> {
  const db = await getExamVocabDb();
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  for (const [key, col] of Object.entries(PROFILE_FIELD_MAP)) {
    if (key in updates) {
      sets.push(`${col} = $${idx++}`);
      values.push((updates as Record<string, unknown>)[key] ?? null);
    }
  }
  if (sets.length === 0) return;
  sets.push(`updated_at = $${idx++}`);
  values.push(new Date().toISOString());
  values.push(1);
  await db.execute(`UPDATE exam_vocab_profile SET ${sets.join(', ')} WHERE id = $${idx}`, values);
}

// ========== Words ==========

export async function fetchVocabWordCount(): Promise<number> {
  const db = await getExamVocabDb();
  const rows = await db.select<{ count: number }[]>('SELECT COUNT(*) AS count FROM exam_vocab_words WHERE archived = 0');
  return rows[0]?.count ?? 0;
}

/** 单元号 → 核心区判定（U01-U13=核心） */
export function isCoreUnit(unit: string): boolean {
  const n = parseInt(unit.replace(/^U/i, ''), 10);
  return Number.isFinite(n) && n >= 1 && n <= 13;
}

export interface UnitProgress {
  unit: string;
  total: number;
  mastered: number;   // 已毕业(review)且 due 在未来 = 当下掌握
  coreZone: boolean;
}

export async function fetchUnitProgress(direction: CardDirection): Promise<UnitProgress[]> {
  const db = await getExamVocabDb();
  const rows = await db.select<Record<string, unknown>[]>(`
    SELECT w.unit,
           COUNT(*) AS total,
           SUM(CASE WHEN c.state = 'review' AND c.due > $1 THEN 1 ELSE 0 END) AS mastered,
           MAX(w.core_zone) AS core_zone
    FROM exam_vocab_words w
    LEFT JOIN exam_vocab_cards c ON c.word_id = w.id AND c.direction = $2
    WHERE w.archived = 0
    GROUP BY w.unit
    ORDER BY w.unit ASC
  `, [new Date().toISOString(), direction]);
  return rows.map(r => ({
    unit: (r.unit as string) || '',
    total: (r.total as number) ?? 0,
    mastered: (r.mastered as number) ?? 0,
    coreZone: !!((r.core_zone as number) ?? 0),
  }));
}

/** 指定单元的词（供单元专项刷词/展示） */
export async function fetchVocabWordsByUnit(unit: string): Promise<VocabWord[]> {
  const db = await getExamVocabDb();
  const rows = await db.select<Record<string, unknown>[]>(
    'SELECT * FROM exam_vocab_words WHERE unit = $1 AND archived = 0 ORDER BY seq ASC',
    [unit]
  );
  return rows.map(rowToWord);
}

export interface ImportResult { imported: number; skipped: number; }

/**
 * 从 TSV 文本批量导入词库（首启空库触发）。按 word 唯一键 upsert：
 * 新增词追加默认方向卡（state=new），已存在词保留全部调度状态不动。
 * 整个导入在一个事务内完成。
 */
export async function importVocabWordsFromTsv(tsv: string, defaultDirection: CardDirection = 'en2zh'): Promise<ImportResult> {
  const db = await getExamVocabDb();
  const lines = tsv.split(/\r?\n/);
  const parsed: { word: string; meaning: string; unit: string; seq: number; core: number }[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = line.split('\t');
    if (cols.length < 4) continue;
    const [word, meaning, unit, seqRaw] = cols;
    if (!word || !meaning || !/^U\d{2}$/i.test(unit)) continue;
    const seq = parseInt(seqRaw, 10);
    if (!Number.isFinite(seq)) continue;
    parsed.push({ word: word.trim(), meaning: meaning.trim(), unit: unit.toUpperCase(), seq, core: isCoreUnit(unit) ? 1 : 0 });
  }

  let imported = 0;
  let skipped = 0;
  await db.execute('BEGIN TRANSACTION');
  try {
    for (const p of parsed) {
      const res = await db.execute(
        `INSERT OR IGNORE INTO exam_vocab_words (word, meaning, unit, seq, core_zone) VALUES ($1, $2, $3, $4, $5)`,
        [p.word, p.meaning, p.unit, p.seq, p.core]
      );
      if (res.rowsAffected > 0) {
        imported++;
        const wordId = res.lastInsertId;
        await db.execute(
          `INSERT OR IGNORE INTO exam_vocab_cards (word_id, direction, state, due) VALUES ($1, $2, 'new', NULL)`,
          [wordId, defaultDirection]
        );
      } else {
        skipped++;
      }
    }
    await db.execute('COMMIT');
  } catch (err) {
    await db.execute('ROLLBACK');
    throw err;
  }
  return { imported, skipped };
}

// ========== Cards（队列与调度写回） ==========

const QUEUE_JOIN = `
  FROM exam_vocab_cards c
  JOIN exam_vocab_words w ON w.id = c.word_id
`;

/** 学习中队列：state∈(learning,relearning) 且 step 到期（due ≤ now） */
export async function fetchLearningQueue(nowIso: string): Promise<VocabQueueItem[]> {
  const db = await getExamVocabDb();
  const rows = await db.select<Record<string, unknown>[]>(`
    SELECT c.*, w.word, w.meaning, w.unit, w.core_zone ${QUEUE_JOIN}
    WHERE c.state IN ('learning','relearning') AND c.due IS NOT NULL AND c.due <= $1
    ORDER BY c.due ASC
  `, [nowIso]);
  return rows.map(rowToQueueItem);
}

/** 到期复习队列：state=review 且 due ≤ now，按 due 升序，截断防雪崩；direction 可选，按方向过滤 */
export async function fetchDueReviewQueue(nowIso: string, limit: number, direction?: CardDirection): Promise<VocabQueueItem[]> {
  const db = await getExamVocabDb();
  const rows = direction
    ? await db.select<Record<string, unknown>[]>(`
        SELECT c.*, w.word, w.meaning, w.unit, w.core_zone ${QUEUE_JOIN}
        WHERE c.state = 'review' AND c.due IS NOT NULL AND c.due <= $1 AND c.direction = $2
        ORDER BY c.due ASC
        LIMIT $3
      `, [nowIso, direction, limit])
    : await db.select<Record<string, unknown>[]>(`
        SELECT c.*, w.word, w.meaning, w.unit, w.core_zone ${QUEUE_JOIN}
        WHERE c.state = 'review' AND c.due IS NOT NULL AND c.due <= $1
        ORDER BY c.due ASC
        LIMIT $2
      `, [nowIso, limit]);
  return rows.map(rowToQueueItem);
}

/** 到期复习总数（不含截断），用于超载提示；direction 可选，按方向过滤 */
export async function fetchDueReviewCount(nowIso: string, direction?: CardDirection): Promise<number> {
  const db = await getExamVocabDb();
  const rows = direction
    ? await db.select<{ count: number }[]>(
        `SELECT COUNT(*) AS count FROM exam_vocab_cards WHERE state = 'review' AND due IS NOT NULL AND due <= $1 AND direction = $2`,
        [nowIso, direction]
      )
    : await db.select<{ count: number }[]>(
        `SELECT COUNT(*) AS count FROM exam_vocab_cards WHERE state = 'review' AND due IS NOT NULL AND due <= $1`,
        [nowIso]
      );
  return rows[0]?.count ?? 0;
}

/** 新词队列：state=new，核心区优先，按单元/序号顺序 */
export async function fetchNewQueue(direction: CardDirection, limit: number): Promise<VocabQueueItem[]> {
  const db = await getExamVocabDb();
  const rows = await db.select<Record<string, unknown>[]>(`
    SELECT c.*, w.word, w.meaning, w.unit, w.core_zone ${QUEUE_JOIN}
    WHERE c.state = 'new' AND c.direction = $1 AND w.archived = 0
    ORDER BY w.core_zone DESC, w.unit ASC, w.seq ASC
    LIMIT $2
  `, [direction, limit]);
  return rows.map(rowToQueueItem);
}

/** 单元专项刷：取该单元未掌握词（非 review，或 review 但已到期），按序号顺序，限量防雪崩 */
export async function fetchUnitDrillQueue(unit: string, directions: CardDirection[], limit: number): Promise<VocabQueueItem[]> {
  if (directions.length === 0) return [];
  const db = await getExamVocabDb();
  const dirList = directions.map((_, i) => `$${i + 2}`).join(',');
  // limit 是词数上限；双向时一词出两行（en2zh+zh2en），LIMIT 须 × 方向数才凑够 limit 个词
  const sqlLimit = limit * directions.length;
  const rows = await db.select<Record<string, unknown>[]>(`
    SELECT c.*, w.word, w.meaning, w.unit, w.core_zone ${QUEUE_JOIN}
    WHERE w.unit = $1 AND c.direction IN (${dirList}) AND w.archived = 0
      AND (c.state != 'review' OR c.due IS NULL OR c.due <= $${directions.length + 2})
    ORDER BY w.seq ASC
    LIMIT $${directions.length + 3}
  `, [unit, ...directions, new Date().toISOString(), sqlLimit]);
  return rows.map(rowToQueueItem);
}

export async function fetchVocabCardById(id: number): Promise<VocabCard | null> {
  const db = await getExamVocabDb();
  const rows = await db.select<Record<string, unknown>[]>('SELECT * FROM exam_vocab_cards WHERE id = $1', [id]);
  return rows.length ? rowToCard(rows[0]) : null;
}

/** 评分后整体写回调度状态（ts-fsrs 产出的新 Card 字段） */
export async function upsertVocabCard(card: VocabCard): Promise<void> {
  const db = await getExamVocabDb();
  await db.execute(
    `UPDATE exam_vocab_cards SET
       state = $1, step_idx = $2, due = $3, stability = $4, difficulty = $5,
       reps = $6, lapses = $7, last_reviewed_at = $8, updated_at = $9
     WHERE id = $10`,
    [
      card.state, card.stepIdx, card.due, card.stability, card.difficulty,
      card.reps, card.lapses, card.lastReviewedAt, new Date().toISOString(), card.id,
    ]
  );
}

/**
 * 切换卡片方向后补建缺失的卡。对 archived=0 的词，若该方向无卡则建 new 卡。
 * 一条 INSERT...SELECT 完成，幂等。
 */
export async function ensureCardsForDirection(direction: CardDirection): Promise<number> {
  const db = await getExamVocabDb();
  const res = await db.execute(
    `INSERT OR IGNORE INTO exam_vocab_cards (word_id, direction, state, due)
     SELECT w.id, $1, 'new', NULL
     FROM exam_vocab_words w
     WHERE w.archived = 0
       AND NOT EXISTS (SELECT 1 FROM exam_vocab_cards c WHERE c.word_id = w.id AND c.direction = $1)`,
    [direction]
  );
  return res.rowsAffected;
}

// ========== Reviews（日志） ==========

export async function insertVocabReview(input: {
  cardId: number;
  wordId: number;
  rating: number;
  stateBefore: CardState;
  intervalDays: number;
  durationMs: number;
}): Promise<void> {
  const db = await getExamVocabDb();
  await db.execute(
    `INSERT INTO exam_vocab_reviews (card_id, word_id, rating, state_before, interval_days, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [input.cardId, input.wordId, input.rating, input.stateBefore, input.intervalDays, input.durationMs]
  );
}

/**
 * 提交一次评分：卡片调度写回 + 日志写入。
 *
 * 不用 BEGIN/COMMIT 手动事务：tauri-plugin-sql 底层是连接池，BEGIN 与 COMMIT 落到
 * 池中不同连接时会报 "cannot commit - no transaction is active"（间歇性，取决于取到
 * 哪条连接）。改用两次独立 autocommit 写入，按「日志先、卡片后」排序使部分失败可自愈：
 *   - 日志写失败 → 卡片未动，抛错让调用方停住翻卡，用户重评即从原状态重来（干净）；
 *   - 卡片写失败 → 卡片状态未变（仍为评分前值），仅留一条孤儿日志；重评时从原状态
 *     正确算出下一状态并写回，卡片只前进一次，孤儿日志只让今日统计多算 1 次（可接受）。
 * 卡片 UPDATE 按 id 命中主键、极少失败；日志 INSERT 同理。两次独立 autocomit 各自
 * 独立落地、互不阻塞，不会留下卡在未提交事务里的连接。
 */
export async function commitVocabRate(card: VocabCard, review: {
  cardId: number; wordId: number; rating: number; stateBefore: CardState; intervalDays: number; durationMs: number;
}): Promise<void> {
  await insertVocabReview(review);
  await upsertVocabCard(card);
}

export interface TodayStats {
  newLearned: number;   // 今日新学（state_before='new' 的评分）
  reviewed: number;     // 今日总复习（含新学）
  again: number;        // 今日 Again 次数
  durationMs: number;   // 今日总耗时
}

/**
 * 今日评分统计。
 *
 * 参数是本地日期串（YYYY-MM-DD），不是 ISO 时间戳：reviewed_at 由 SQLite
 * datetime('now') 写成「YYYY-MM-DD HH:MM:SS」(UTC、空格分隔)，与 JS 的
 * 'YYYY-MM-DDTHH:MM:SS.000Z' 做字符串比较会恒不相等（' ' < 'T'），导致统计永远为 0。
 * 故统一用 date() 归一化到日粒度：date($1,'localtime') 把本地日期转成 UTC 日期再比。
 */
export async function fetchTodayStats(todayDate: string): Promise<TodayStats> {
  const db = await getExamVocabDb();
  const rows = await db.select<Record<string, unknown>[]>(`
    SELECT
      COUNT(*) AS reviewed,
      SUM(CASE WHEN state_before = 'new' THEN 1 ELSE 0 END) AS newLearned,
      SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) AS again,
      COALESCE(SUM(duration_ms), 0) AS durationMs
    FROM exam_vocab_reviews
    WHERE date(reviewed_at) = date($1, 'localtime')
  `, [todayDate]);
  const r = rows[0] ?? {};
  return {
    reviewed: (r.reviewed as number) ?? 0,
    newLearned: (r.newLearned as number) ?? 0,
    again: (r.again as number) ?? 0,
    durationMs: (r.durationMs as number) ?? 0,
  };
}

// ========== Hardwords（难词本） ==========

export async function fetchVocabHardwords(status?: HardwordStatus): Promise<VocabHardWord[]> {
  const db = await getExamVocabDb();
  const sql = `SELECT h.*, w.word, w.meaning, w.unit
               FROM exam_vocab_hardwords h
               JOIN exam_vocab_words w ON w.id = h.word_id
               ${status ? 'WHERE h.status = $1' : ''}
               ORDER BY h.added_at DESC`;
  const rows = status
    ? await db.select<Record<string, unknown>[]>(sql, [status])
    : await db.select<Record<string, unknown>[]>(sql);
  return rows.map(rowToHardword);
}

/** 难词专项刷：取 status='new' 的难词对应卡片（按方向过滤），按入库顺序，限量 */
export async function fetchHardwordDrillQueue(directions: CardDirection[], limit: number): Promise<VocabQueueItem[]> {
  if (directions.length === 0) return [];
  const db = await getExamVocabDb();
  const dirList = directions.map((_, i) => `$${i + 1}`).join(',');
  // limit 是词数上限；双向时一词出两行（en2zh+zh2en），LIMIT 须 × 方向数才凑够 limit 个词
  const sqlLimit = limit * directions.length;
  const rows = await db.select<Record<string, unknown>[]>(`
    SELECT c.*, w.word, w.meaning, w.unit, w.core_zone
    FROM exam_vocab_hardwords h
    JOIN exam_vocab_words w ON w.id = h.word_id
    JOIN exam_vocab_cards c ON c.word_id = h.word_id AND c.direction IN (${dirList})
    WHERE h.status = 'new'
    ORDER BY h.added_at DESC
    LIMIT $${directions.length + 1}
  `, [...directions, sqlLimit]);
  return rows.map(rowToQueueItem);
}

/** 连续 Again 自动入库；已存在则累加 again_streak 并重置为 new */
export async function upsertVocabHardword(wordId: number, againStreak: number, reason: string): Promise<void> {
  const db = await getExamVocabDb();
  await db.execute(
    `INSERT INTO exam_vocab_hardwords (word_id, reason, again_streak, status)
     VALUES ($1, $2, $3, 'new')
     ON CONFLICT(word_id) DO UPDATE SET
       again_streak = $3, reason = $2, status = 'new', updated_at = datetime('now')`,
    [wordId, reason, againStreak]
  );
}

export async function setHardwordStatus(wordId: number, status: HardwordStatus): Promise<void> {
  const db = await getExamVocabDb();
  await db.execute(
    `UPDATE exam_vocab_hardwords SET status = $1, updated_at = datetime('now') WHERE word_id = $2`,
    [status, wordId]
  );
}

export async function removeHardword(wordId: number): Promise<void> {
  const db = await getExamVocabDb();
  await db.execute('DELETE FROM exam_vocab_hardwords WHERE word_id = $1', [wordId]);
}

// ========== Mnemonics（AI 助记持久化） ==========

/** 取词已保存的 AI 助记；无则 null */
export async function fetchVocabMnemonic(wordId: number): Promise<VocabMnemonicRecord | null> {
  const db = await getExamVocabDb();
  const rows = await db.select<Record<string, unknown>[]>(
    'SELECT * FROM exam_vocab_mnemonics WHERE word_id = $1',
    [wordId]
  );
  return rows.length ? rowToMnemonic(rows[0]) : null;
}

/** 批量取一组词已保存的 AI 助记（关卡预生成/预加载用，单次查询） */
export async function fetchVocabMnemonics(wordIds: number[]): Promise<VocabMnemonicRecord[]> {
  if (wordIds.length === 0) return [];
  const db = await getExamVocabDb();
  const placeholders = wordIds.map((_, i) => `$${i + 1}`).join(',');
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT * FROM exam_vocab_mnemonics WHERE word_id IN (${placeholders})`,
    wordIds
  );
  return rows.map(rowToMnemonic);
}

/** 保存/覆盖词的 AI 助记（按 word_id 幂等 upsert） */
export async function saveVocabMnemonic(
  wordId: number,
  draft: { roots: string; mnemonic: string; method?: string; scene?: string; sentence: string; sentenceZh: string },
): Promise<void> {
  const db = await getExamVocabDb();
  await db.execute(
    `INSERT INTO exam_vocab_mnemonics (word_id, roots, mnemonic, method, scene, sentence, sentence_zh)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT(word_id) DO UPDATE SET
       roots = $2, mnemonic = $3, method = $4, scene = $5,
       sentence = $6, sentence_zh = $7, updated_at = datetime('now')`,
    [
      wordId, draft.roots, draft.mnemonic, draft.method || '', draft.scene || '',
      draft.sentence, draft.sentenceZh,
    ]
  );
}

// ========== 统计 ==========

export interface OverallStats {
  total: number;
  newCount: number;
  learning: number;
  review: number;
  relearning: number;
  mastered: number;   // review 且 due 在未来
}

export async function fetchOverallStats(direction: CardDirection): Promise<OverallStats> {
  const db = await getExamVocabDb();
  const rows = await db.select<Record<string, unknown>[]>(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN state = 'new' THEN 1 ELSE 0 END) AS newCount,
      SUM(CASE WHEN state = 'learning' THEN 1 ELSE 0 END) AS learning,
      SUM(CASE WHEN state = 'review' THEN 1 ELSE 0 END) AS review,
      SUM(CASE WHEN state = 'relearning' THEN 1 ELSE 0 END) AS relearning,
      SUM(CASE WHEN state = 'review' AND due > $1 THEN 1 ELSE 0 END) AS mastered
    FROM exam_vocab_cards WHERE direction = $2
  `, [new Date().toISOString(), direction]);
  const r = rows[0] ?? {};
  return {
    total: (r.total as number) ?? 0,
    newCount: (r.newCount as number) ?? 0,
    learning: (r.learning as number) ?? 0,
    review: (r.review as number) ?? 0,
    relearning: (r.relearning as number) ?? 0,
    mastered: (r.mastered as number) ?? 0,
  };
}

export interface DailyCount { date: string; count: number; }

/**
 * 每日复习量。参数为本地日期串（YYYY-MM-DD）。
 * 归集日按本地时区取（date(x,'localtime')），与前端按 localDateStr 画的 30 天坐标对齐；
 * 直接 substr(reviewed_at,1,10) 取的是 UTC 日期，凌晨的评分会落到前一天。
 */
export async function fetchReviewCountsByDay(sinceDate: string): Promise<DailyCount[]> {
  const db = await getExamVocabDb();
  const rows = await db.select<{ date: string; count: number }[]>(`
    SELECT date(reviewed_at, 'localtime') AS date, COUNT(*) AS count
    FROM exam_vocab_reviews
    WHERE date(reviewed_at) >= date($1, 'localtime')
    GROUP BY 1 ORDER BY 1 ASC
  `, [sinceDate]);
  return rows;
}

export interface LapseStats { totalLapses: number; totalReviews: number; }

export async function fetchLapseStats(direction: CardDirection): Promise<LapseStats> {
  const db = await getExamVocabDb();
  // reviews 表无 direction 列，须 JOIN cards 取方向；恢复时保留 card.id 保证此 JOIN 不丢行
  const rows = await db.select<{ totalLapses: number; totalReviews: number }[]>(`
    SELECT
      (SELECT COALESCE(SUM(lapses), 0) FROM exam_vocab_cards WHERE direction = $1) AS totalLapses,
      (SELECT COUNT(*) FROM exam_vocab_reviews r
         JOIN exam_vocab_cards c ON c.id = r.card_id
         WHERE c.direction = $1) AS totalReviews
  `, [direction]);
  return rows[0] ?? { totalLapses: 0, totalReviews: 0 };
}

// ========== 云盘备份恢复 ==========

/**
 * 取当前调度数据快照（不含 words 词库本体——可从 TSV 重导，省云体积）。
 */
export async function getExamVocabCloudSnapshot(): Promise<ExamVocabCloudSnapshot> {
  const db = await getExamVocabDb();
  const [profileRows, cardRows, reviewRows, hardRows, mnemonicRows, runRows] = await Promise.all([
    db.select<Record<string, unknown>[]>('SELECT * FROM exam_vocab_profile WHERE id = 1'),
    db.select<Record<string, unknown>[]>('SELECT * FROM exam_vocab_cards'),
    db.select<Record<string, unknown>[]>('SELECT * FROM exam_vocab_reviews'),
    db.select<Record<string, unknown>[]>('SELECT * FROM exam_vocab_hardwords'),
    db.select<Record<string, unknown>[]>('SELECT * FROM exam_vocab_mnemonics'),
    db.select<Record<string, unknown>[]>('SELECT * FROM exam_vocab_game_runs ORDER BY id ASC'),
  ]);
  return {
    profile: profileRows.length ? rowToProfile(profileRows[0]) : { ...DEFAULT_PROFILE },
    cards: cardRows.map(rowToCard),
    reviews: reviewRows.map(rowToReview),
    hardwords: hardRows.map(rowToHardword),
    mnemonics: mnemonicRows.map(rowToMnemonic),
    gameRuns: runRows.map(rowToGameRun),
  };
}

/**
 * 把快照写入数据库（先清空相关表，再批量插入）。
 * 单独抽出以便恢复失败时用旧快照还原。
 */
async function writeExamVocabSnapshot(db: Database, snapshot: ExamVocabCloudSnapshot): Promise<void> {
  await db.execute('DELETE FROM exam_vocab_cards');
  await db.execute('DELETE FROM exam_vocab_reviews');
  await db.execute('DELETE FROM exam_vocab_hardwords');
  await db.execute('DELETE FROM exam_vocab_mnemonics');
  await db.execute('DELETE FROM exam_vocab_game_runs');

  const now = new Date().toISOString();

  // 保留原始 id：reviews.card_id 引用此 id，若让 AUTOINCREMENT 重排则恢复后日志全部变孤儿
  await insertRows(
    db,
    `INSERT INTO exam_vocab_cards (id, word_id, direction, state, step_idx, due, stability, difficulty, reps, lapses, last_reviewed_at, created_at, updated_at) VALUES`,
    13,
    (snapshot.cards ?? []).map((c) => [
      c.id, c.wordId, c.direction, c.state, c.stepIdx, c.due, c.stability, c.difficulty,
      c.reps, c.lapses, c.lastReviewedAt, c.createdAt || now, c.updatedAt || now,
    ]),
  );

  await insertRows(
    db,
    `INSERT INTO exam_vocab_reviews (card_id, word_id, rating, state_before, interval_days, duration_ms, reviewed_at) VALUES`,
    7,
    (snapshot.reviews ?? []).map((r) => [
      r.cardId, r.wordId, r.rating, r.stateBefore, r.intervalDays, r.durationMs, r.reviewedAt,
    ]),
  );

  await insertRows(
    db,
    `INSERT INTO exam_vocab_hardwords (word_id, reason, again_streak, note, status, added_at, updated_at) VALUES`,
    7,
    (snapshot.hardwords ?? []).map((h) => [
      h.wordId, h.reason || '', h.againStreak || 0, h.note || '', h.status, h.addedAt || now, h.updatedAt || now,
    ]),
  );

  await insertRows(
    db,
    `INSERT INTO exam_vocab_mnemonics (word_id, roots, mnemonic, method, scene, sentence, sentence_zh, created_at, updated_at) VALUES`,
    9,
    (snapshot.mnemonics ?? []).map((m) => [
      m.wordId, m.roots || '', m.mnemonic || '', m.method || '', m.scene || '',
      m.sentence || '', m.sentenceZh || '', m.createdAt || now, m.updatedAt || now,
    ]),
  );

  await insertRows(
    db,
    `INSERT INTO exam_vocab_game_runs (id, level, level_size, words_total, correct, answered, accuracy, duration_ms, passed, replay, started_at, finished_at) VALUES`,
    12,
    (snapshot.gameRuns ?? []).map((r) => [
      r.id, r.level, r.levelSize, r.wordsTotal, r.correct, r.answered,
      r.accuracy, r.durationMs, r.passed ? 1 : 0, r.replay ? 1 : 0,
      r.startedAt || now, r.finishedAt || now,
    ]),
  );

  const p = snapshot.profile;
  await execWithRetry(
    db,
    `UPDATE exam_vocab_profile SET
       card_direction = $1, target_retention = $2, max_reviews_per_day = $3,
       phase1_start = $4, phase1_end = $5, phase1_new_per_day = $6,
       phase2_start = $7, phase2_end = $8, phase2_new_per_day = $9,
       phase3_start = $10, phase3_end = $11, phase3_new_per_day = $12,
       last_study_date = $13, streak = $14, updated_at = $15
     WHERE id = 1`,
    [p.cardDirection, p.targetRetention, p.maxReviewsPerDay,
     p.phase1Start, p.phase1End, p.phase1NewPerDay,
     p.phase2Start, p.phase2End, p.phase2NewPerDay,
     p.phase3Start, p.phase3End, p.phase3NewPerDay,
     p.lastStudyDate, p.streak, new Date().toISOString()],
  );
}

/**
 * 用云端快照整体覆盖本地背单词调度数据。
 * cards/reviews/hardwords/mnemonics/game_runs 全量替换，profile 按 id=1 覆盖。
 * words 不动（恢复后由首启检测补建）。
 *
 * 健壮性要点：
 * - 批量插入，避免上万次 IPC 让写事务持续过久而撞上 SQLite 写锁
 * - 开事务失败时降级为非事务覆盖，不中断恢复
 * - 非事务模式下中途失败，用覆盖前的旧快照还原本地数据
 */
export async function replaceExamVocabData(snapshot: ExamVocabCloudSnapshot): Promise<void> {
  const db = await getExamVocabDb();
  // 覆盖前留一份旧快照：非事务模式下中途失败时用它还原，避免本地数据被清空
  const backup = await getExamVocabCloudSnapshot().catch(() => null);

  let inTx = false;
  try {
    await db.execute('BEGIN TRANSACTION');
    inTx = true;
  } catch (err) {
    console.warn('[ExamVocabDB] 开启事务失败，降级为非事务覆盖：', errText(err));
  }

  try {
    await writeExamVocabSnapshot(db, snapshot);
    if (inTx) {
      await db.execute('COMMIT');
      inTx = false;
    }
  } catch (err) {
    if (inTx) {
      try { await db.execute('ROLLBACK'); } catch { /* 回滚失败时保留原始错误 */ }
    } else if (backup) {
      console.warn('[ExamVocabDB] 覆盖中途失败，尝试用旧快照还原本地数据：', errText(err));
      try {
        await writeExamVocabSnapshot(db, backup);
      } catch (restoreErr) {
        console.error('[ExamVocabDB] 还原失败：', errText(restoreErr));
      }
    }
    throw err;
  }
}
