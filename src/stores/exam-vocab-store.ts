import { create } from 'zustand';
import { fsrs, generatorParameters, Rating, State } from 'ts-fsrs';
import type { Card, FSRS, Grade } from 'ts-fsrs';
import tsvUrl from '../assets/exam-vocab/main-wordlist.tsv?url';
import type {
  VocabProfile, VocabCard, VocabQueueItem, VocabHardWord, CardDirection, CardState,
  TodayStats, OverallStats, UnitProgress, LapseStats, DailyCount, ImportResult,
  ExamVocabCloudSnapshot,
} from '../lib/exam-vocab-db';
import {
  fetchVocabProfile, updateVocabProfile as dbUpdateProfile,
  fetchVocabWordCount, importVocabWordsFromTsv, ensureCardsForDirection,
  fetchLearningQueue, fetchDueReviewQueue, fetchDueReviewCount, fetchNewQueue, fetchUnitDrillQueue,
  commitVocabRate,
  fetchVocabHardwords, upsertVocabHardword, fetchHardwordDrillQueue,
  setHardwordStatus as dbSetHardwordStatus, removeHardword as dbRemoveHardword,
  fetchTodayStats, fetchOverallStats, fetchUnitProgress, fetchReviewCountsByDay,
  fetchLapseStats, getExamVocabCloudSnapshot, replaceExamVocabData,
} from '../lib/exam-vocab-db';
import { saveExamVocabToCloud, loadExamVocabFromCloud } from '../lib/cloud';
import { isTauri } from '../lib/tauri';
import { localDateStr } from '../lib/utils';

// ========== ts-fsrs 实例（按目标保留率重建） ==========

let _fsrs: FSRS | null = null;
let _fsrsRetention = -1;

function getFsrs(profile: VocabProfile): FSRS {
  if (!_fsrs || _fsrsRetention !== profile.targetRetention) {
    _fsrs = fsrs(generatorParameters({
      request_retention: profile.targetRetention,
      maximum_interval: 36500,
    }));
    _fsrsRetention = profile.targetRetention;
  }
  return _fsrs;
}

/** 失效缓存的 FSRS 实例（保留率改后重建） */
function invalidateFsrs() {
  _fsrs = null;
  _fsrsRetention = -1;
}

// ========== CardState ↔ ts-fsrs State ==========

function stateToFsrs(s: CardState): State {
  switch (s) {
    case 'learning': return State.Learning;
    case 'review': return State.Review;
    case 'relearning': return State.Relearning;
    default: return State.New;
  }
}

function fsrsStateToCard(s: State): CardState {
  switch (s) {
    case State.Learning: return 'learning';
    case State.Review: return 'review';
    case State.Relearning: return 'relearning';
    default: return 'new';
  }
}

/** 从 DB 行重建 ts-fsrs Card（scheduled_days/elapsed_days 不持久化，传 0 由算法重算） */
function toFsrsCard(card: VocabCard, now: Date): Card {
  return {
    due: card.due ? new Date(card.due) : new Date(now),
    stability: card.stability || 0,
    difficulty: card.difficulty || 0,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: card.stepIdx,
    reps: card.reps,
    lapses: card.lapses,
    state: stateToFsrs(card.state),
    last_review: card.lastReviewedAt ? new Date(card.lastReviewedAt) : undefined,
  };
}

const PREVIEW_GRADES: Grade[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];

/** 由 profile.cardDirection 派生活跃方向集合 */
function activeDirectionsFor(profile: VocabProfile): CardDirection[] {
  if (profile.cardDirection === 'zh2en') return ['zh2en'];
  if (profile.cardDirection === 'both') return ['en2zh', 'zh2en'];
  return ['en2zh'];
}

// ========== Store 类型 ==========

export interface VocabRateResult {
  card: VocabCard;
  intervalDays: number;
  nextDue: string;
}

export interface ExamVocabStore {
  loaded: boolean;
  loading: boolean;
  lastError: string;
  profile: VocabProfile;
  hardwords: VocabHardWord[];
  /** 词库已导入词数（导入前页面只读空态） */
  wordCount: number;
  /** 评分日志写入次数（今日统计是日志的派生视图，写成功后自增让页面实时刷新数字） */
  studyTick: number;
  /** 调度数据自上次云盘备份后是否变更：自动同步据此跳过空转的全量序列化（reviews 可达数万行） */
  vocabDirty: boolean;

  /** 惰性加载：进入背单词页时调用；首启空库自动从 TSV 导入词表 */
  loadFromDb: (force?: boolean) => Promise<void>;
  clearError: () => void;
  /** 重导词表（设置弹窗触发；按 word upsert，已存在词保留调度） */
  reimportWords: () => Promise<ImportResult>;
  /** 当前激活的卡片方向集合（en2zh / zh2en / both） */
  activeDirections: () => CardDirection[];
  /** 切换方向后补建缺失卡片 */
  switchDirection: (dir: VocabProfile['cardDirection']) => Promise<void>;

  /** 自动同步用：仅在数据已加载且词库非空时返回快照，否则 null（跳过该文件） */
  getCloudSnapshot: () => Promise<ExamVocabCloudSnapshot | null>;
  backupToCloud: () => Promise<{ path: string; count: number }>;
  /** 返回面向用户的消息：成功/无数据；真正的 IO 或格式错误才抛出 */
  restoreFromCloud: () => Promise<string>;
  saveProfile: (updates: Partial<VocabProfile>) => Promise<void>;

  /** 今日队列（学习中 > 到期复习 > 新词），按优先级拼装并按激活方向过滤 */
  buildTodayQueue: (nowIso: string, newLimit: number) => Promise<VocabQueueItem[]>;
  /** 单元专项刷：取该单元未掌握词，按激活方向 */
  buildUnitDrillQueue: (unit: string) => Promise<VocabQueueItem[]>;
  /** 难词专项刷：取 status='new' 的难词卡片，按激活方向 */
  buildHardwordDrillQueue: () => Promise<VocabQueueItem[]>;
  /** 到期复习总数（不含截断，按激活方向求和），用于超载提示 */
  dueReviewCount: (nowIso: string) => Promise<number>;

  /** 评分：调用 ts-fsrs.next 写回调度 + 日志 + 难词本 + streak */
  rateCard: (card: VocabQueueItem, rating: Grade, durationMs: number) => Promise<VocabRateResult>;
  /** 预览四按钮产出间隔（天，可为小数如 1m≈0.0007），卡片背面展示 */
  previewIntervals: (card: VocabQueueItem, nowIso: string) => Record<Grade, number>;

  loadHardwords: () => Promise<void>;
  addHardword: (wordId: number, reason: string) => Promise<void>;
  markHardwordGrasped: (wordId: number) => Promise<void>;
  removeHardword: (wordId: number) => Promise<void>;

  fetchStats: (direction: CardDirection) => Promise<OverallStats>;
  fetchUnitProgress: (direction: CardDirection) => Promise<UnitProgress[]>;
  fetchTodayStats: (todayDate: string) => Promise<TodayStats>;
  fetchReviewBars: (sinceDate: string) => Promise<DailyCount[]>;
  fetchLapseStats: (direction: CardDirection) => Promise<LapseStats>;
}

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

export const useExamVocabStore = create<ExamVocabStore>()((set, get) => ({
  loaded: false,
  loading: false,
  lastError: '',
  profile: { ...DEFAULT_PROFILE },
  hardwords: [],
  wordCount: 0,
  studyTick: 0,
  vocabDirty: true,

  loadFromDb: async (force?: boolean) => {
    if (get().loading) return;
    if (!force && get().loaded) return;
    if (!isTauri()) {
      set({ loaded: true });
      return;
    }
    set({ loading: true });
    try {
      // 1. 首启空库：从静态 TSV 资源导入词表
      let count = await fetchVocabWordCount();
      if (count === 0) {
        try {
          const tsv = await (await fetch(tsvUrl)).text();
          await importVocabWordsFromTsv(tsv, 'en2zh');
          count = await fetchVocabWordCount();
        } catch (err) {
          console.error('[ExamVocabStore] 词表导入失败:', err);
          set({ lastError: `词表未加载：${err instanceof Error ? err.message : String(err)}` });
        }
      }
      // 2. 按当前方向补建缺失卡片（用户曾切到 zh2en/both 时）
      const profile = await fetchVocabProfile();
      for (const d of activeDirectionsFor(profile)) {
        if (d !== 'en2zh') await ensureCardsForDirection(d);
      }
      // 3. 加载难词本
      const hardwords = await fetchVocabHardwords();
      set({ profile, hardwords, wordCount: count, loaded: true, lastError: '', vocabDirty: true });
    } catch (err) {
      console.error('[ExamVocabStore] 数据库不可用:', err);
      set({
        loaded: true,
        lastError: `背单词数据库加载失败：${err instanceof Error ? err.message : String(err)}（可能需要重启应用完成数据迁移）`,
      });
    } finally {
      set({ loading: false });
    }
  },

  clearError: () => set({ lastError: '' }),

  reimportWords: async () => {
    const tsv = await (await fetch(tsvUrl)).text();
    const res = await importVocabWordsFromTsv(tsv, 'en2zh');
    const count = await fetchVocabWordCount();
    set({ wordCount: count });
    return res;
  },

  activeDirections: () => activeDirectionsFor(get().profile),

  switchDirection: async (dir) => {
    const prev = get().profile.cardDirection;
    if (prev === dir) return;
    // 乐观更新
    set({ profile: { ...get().profile, cardDirection: dir } });
    if (!isTauri()) return;
    try {
      await dbUpdateProfile({ cardDirection: dir });
      for (const d of activeDirectionsFor({ ...get().profile, cardDirection: dir })) {
        await ensureCardsForDirection(d);
      }
      set({ vocabDirty: true });
    } catch (err) {
      // 回滚乐观更新：DB 失败时 UI 不应停留在新方向（否则队列会按未持久化的方向取卡）
      set({ profile: { ...get().profile, cardDirection: prev }, lastError: `切换方向失败：${err instanceof Error ? err.message : String(err)}` });
    }
  },

  getCloudSnapshot: async () => {
    // 用户从未进过背单词页（未加载）或词库为空时不参与自动同步，避免覆盖云端有效数据
    if (!isTauri() || !get().loaded || get().wordCount === 0) return null;
    // 无写入则跳过：reviews 全量序列化成本高，空转同步每 60s 跑一次纯属浪费
    if (!get().vocabDirty) return null;
    try {
      const snap = await getExamVocabCloudSnapshot();
      set({ vocabDirty: false });
      return snap;
    } catch {
      return null;
    }
  },

  backupToCloud: async () => {
    const snapshot = await getExamVocabCloudSnapshot();
    return saveExamVocabToCloud(snapshot);
  },

  restoreFromCloud: async () => {
    const snapshot = await loadExamVocabFromCloud();
    if (!snapshot) return '云盘暂无背单词数据，请先点击「备份到云盘」上传';
    if (!isTauri()) {
      set({ profile: snapshot.profile, hardwords: [], loaded: true, lastError: '' });
      return '已从云盘恢复';
    }
    // 恢复后若本地词库为空，先重导词表再覆盖调度
    if ((await fetchVocabWordCount()) === 0) {
      try {
        const tsv = await (await fetch(tsvUrl)).text();
        await importVocabWordsFromTsv(tsv, 'en2zh');
      } catch { /* 词表缺失由 loadFromDb 兜底 */ }
    }
    await replaceExamVocabData(snapshot);
    await get().loadFromDb(true);
    // 刚从云盘恢复，云盘已是最新，无需立即回写
    set({ vocabDirty: false });
    return `已从云盘恢复（${snapshot.cards.length} 张卡片、${snapshot.hardwords.length} 条难词）`;
  },

  saveProfile: async (updates) => {
    const prev = get().profile;
    set({ profile: { ...prev, ...updates }, lastError: '', vocabDirty: true });
    if (updates.targetRetention !== undefined) invalidateFsrs();
    if (!isTauri()) return;
    try {
      await dbUpdateProfile(updates);
    } catch (err) {
      set({ lastError: `保存设置失败：${err instanceof Error ? err.message : String(err)}` });
    }
  },

  buildTodayQueue: async (nowIso, newLimit) => {
    const dirs = activeDirectionsFor(get().profile);
    const dirSet = new Set(dirs);
    const maxR = get().profile.maxReviewsPerDay;
    // 复习按方向分别取 maxR：双向时每方向各覆盖前 maxR 张到期卡，避免单方向截断漏掉另一方向
    const [learningAll, ...dueByDir] = await Promise.all([
      fetchLearningQueue(nowIso),
      ...dirs.map(d => fetchDueReviewQueue(nowIso, maxR, d)),
    ]);
    const learning = learningAll.filter(c => dirSet.has(c.direction));
    const dueReview = dueByDir.flat();
    let newCards: VocabQueueItem[] = [];
    if (newLimit > 0) {
      const fetched = await Promise.all(dirs.map(d => fetchNewQueue(d, newLimit)));
      newCards = fetched.flat();
    }
    // 优先级：学习中 > 到期复习 > 新词（复习优先于新词，欠债不过夜）
    return [...learning, ...dueReview, ...newCards];
  },

  dueReviewCount: async (nowIso) => {
    const dirs = activeDirectionsFor(get().profile);
    const counts = await Promise.all(dirs.map(d => fetchDueReviewCount(nowIso, d)));
    return counts.reduce((a, b) => a + b, 0);
  },

  buildUnitDrillQueue: async (unit) => {
    const dirs = activeDirectionsFor(get().profile);
    return fetchUnitDrillQueue(unit, dirs, 60);
  },

  buildHardwordDrillQueue: async () => {
    const dirs = activeDirectionsFor(get().profile);
    return fetchHardwordDrillQueue(dirs, 60);
  },

  rateCard: async (card, rating, durationMs) => {
    const now = new Date();
    let profile = get().profile;
    const f = getFsrs(profile);
    const fsrsCard = toFsrsCard(card, now);
    const { card: next } = f.next(fsrsCard, now, rating);
    // 本次评分产出的新间隔（天，学习步可为小数）。注意不能用 log.scheduled_days：
    // 那是评分「之前」的旧间隔，而我们重建 Card 时 scheduled_days 恒为 0。
    const intervalDays = (next.due.getTime() - now.getTime()) / 86400000;

    const updated: VocabCard = {
      id: card.id,
      wordId: card.wordId,
      direction: card.direction,
      state: fsrsStateToCard(next.state),
      stepIdx: next.learning_steps,
      due: next.due.toISOString(),
      stability: next.stability,
      difficulty: next.difficulty,
      reps: next.reps,
      lapses: next.lapses,
      lastReviewedAt: now.toISOString(),
      createdAt: card.createdAt,
      updatedAt: now.toISOString(),
    };

    // streak：每日首次评分即记学习日；与昨天相邻则 +1，否则重置为 1
    const today = localDateStr();
    if (profile.lastStudyDate !== today) {
      const y = new Date(); y.setDate(y.getDate() - 1);
      const yStr = localDateStr(y);
      const newStreak = profile.lastStudyDate === yStr ? profile.streak + 1 : 1;
      profile = { ...profile, lastStudyDate: today, streak: newStreak };
      set({ profile });
      if (isTauri()) {
        try { await dbUpdateProfile({ lastStudyDate: today, streak: newStreak }); } catch { /* ignore */ }
      }
    }

    if (isTauri()) {
      try {
        // 卡片写回 + 日志原子提交：任一失败回滚并抛出，调用方据此停住翻卡
        await commitVocabRate(updated, {
          cardId: card.id, wordId: card.wordId, rating, stateBefore: card.state,
          intervalDays, durationMs,
        });
        // 今日统计/复习曲线是评分日志的派生视图，写成功后自增让页面实时刷新
        set({ studyTick: get().studyTick + 1, vocabDirty: true });
        // 难词本：Again 累计入册，status 强制 new（已掌握词答错自动复活）
        if (rating === Rating.Again) {
          try {
            const prev = get().hardwords.find(h => h.wordId === card.wordId);
            const streak = (prev?.againStreak ?? 0) + 1;
            await upsertVocabHardword(card.wordId, streak, 'again-streak');
            await get().loadHardwords();
          } catch { /* 难词本失败不影响评分主流程 */ }
        }
      } catch (err) {
        set({ lastError: `评分写入失败：${err instanceof Error ? err.message : String(err)}` });
        // 写库失败：抛错让卡片流不前进，用户可重评该卡（而非静默丢失评分）
        throw err;
      }
    }

    return {
      card: updated,
      intervalDays,
      nextDue: next.due.toISOString(),
    };
  },

  previewIntervals: (card, nowIso) => {
    const now = new Date(nowIso);
    const preview = getFsrs(get().profile).repeat(toFsrsCard(card, now), now);
    const out = {} as Record<Grade, number>;
    for (const g of PREVIEW_GRADES) {
      out[g] = (preview[g].card.due.getTime() - now.getTime()) / 86400000;
    }
    return out;
  },

  loadHardwords: async () => {
    if (!isTauri()) return;
    try {
      const hardwords = await fetchVocabHardwords();
      set({ hardwords });
    } catch { /* ignore */ }
  },

  addHardword: async (wordId, reason) => {
    const cur = get().hardwords;
    const existing = cur.find(h => h.wordId === wordId);
    if (existing) {
      set({ hardwords: cur.map(h => h.wordId === wordId ? { ...h, status: 'new' as const, reason } : h), vocabDirty: true });
    } else {
      const now = new Date().toISOString();
      set({ hardwords: [{ id: Date.now(), wordId, reason, againStreak: 0, note: '', status: 'new' as const, addedAt: now, updatedAt: now }, ...cur], vocabDirty: true });
    }
    if (!isTauri()) return;
    try { await upsertVocabHardword(wordId, 0, reason); } catch { /* ignore */ }
  },

  markHardwordGrasped: async (wordId) => {
    set({ hardwords: get().hardwords.map(h => h.wordId === wordId ? { ...h, status: 'grasped' as const } : h), vocabDirty: true });
    if (!isTauri()) return;
    try { await dbSetHardwordStatus(wordId, 'grasped'); } catch { /* ignore */ }
  },

  removeHardword: async (wordId) => {
    set({ hardwords: get().hardwords.filter(h => h.wordId !== wordId), vocabDirty: true });
    if (!isTauri()) return;
    try { await dbRemoveHardword(wordId); } catch { /* ignore */ }
  },

  fetchStats: async (direction) => fetchOverallStats(direction),
  fetchUnitProgress: async (direction) => fetchUnitProgress(direction),
  fetchTodayStats: async (sinceIso) => fetchTodayStats(sinceIso),
  fetchReviewBars: async (sinceIso) => fetchReviewCountsByDay(sinceIso),
  fetchLapseStats: async (direction) => fetchLapseStats(direction),
}));
