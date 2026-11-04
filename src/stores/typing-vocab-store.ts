/**
 * 「打字背单词」状态管理（独立模块）。
 *
 * 数据源只有本模块自己的 `typing_vocab_*` 表；不读写 exam_vocab / task 的状态。
 * 记忆曲线写回走 `typing-vocab-srs.ts`，音效与发音配置在本模块内单独维护。
 */
import { create } from 'zustand';
import builtinUrl from '../assets/typing-vocab/kaoyan.json?url';
import { isTauri } from '../lib/tauri';
import {
  buildTypingDrillQueue,
  buildTypingQueue,
  deleteTypingBook,
  exportTypingBackup,
  fetchTypingBooks,
  fetchTypingDailyStats,
  fetchTypingDueCount,
  fetchTypingFavoriteWords,
  fetchTypingMasteredWords,
  fetchTypingModeStats,
  fetchTypingOverview,
  fetchTypingProfile,
  fetchTypingRecentSessions,
  fetchTypingUnits,
  fetchTypingProgress,
  fetchTypingWrongWords,
  importTypingBook,
  insertTypingSession,
  replaceTypingBackup,
  resetTypingWord,
  setTypingWordFavorited,
  setTypingWordMastered,
  updateTypingProfile,
  upsertTypingProgress,
  type TypingBackup,
  type TypingBook,
  type TypingDailyPoint,
  type TypingDrillKind,
  type TypingMode,
  type TypingModeStat,
  type TypingOutcome,
  type TypingOverview,
  type TypingPlan,
  type TypingProfile,
  type TypingQueueItem,
  type TypingSession,
  type TypingUnitStat,
  type TypingWordSeed,
} from '../lib/typing-vocab-db';
import { scheduleTypingAnswer } from '../lib/typing-vocab-srs';
import { configureTypingSound, playTypingSound } from '../lib/typing-vocab-sound';
import { configureTypingSpeech } from '../lib/typing-vocab-speech';

export type TypingQueueKind = 'today' | TypingDrillKind;

interface BuiltinWordPayload {
  key: string;
  name: string;
  description: string;
  words: (string | number)[][];
}

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

export interface TypingVocabStore {
  loaded: boolean;
  loading: boolean;
  lastError: string;
  books: TypingBook[];
  profile: TypingProfile;
  overview: TypingOverview | null;
  /** 智能模式今日到期复习数 */
  dueCount: number;
  daily: TypingDailyPoint[];
  modeStats: TypingModeStat[];
  units: TypingUnitStat[];
  wrongWords: TypingQueueItem[];
  favoriteWords: TypingQueueItem[];
  masteredWords: TypingQueueItem[];
  recentSessions: TypingSession[];
  /** 任意数据写入后自增，页面据此刷新概览 */
  dataTick: number;

  loadFromDb: (force?: boolean) => Promise<void>;
  clearError: () => void;
  saveProfile: (updates: Partial<TypingProfile>) => Promise<void>;
  setActiveBook: (bookId: number) => Promise<void>;
  refreshLists: () => Promise<void>;
  refreshStats: () => Promise<void>;
  buildSessionQueue: (kind: TypingQueueKind, unit?: string) => Promise<TypingQueueItem[]>;
  rateWord: (wordId: number, outcome: TypingOutcome, mode: TypingMode) => Promise<void>;
  toggleFavorite: (item: TypingQueueItem) => Promise<void>;
  setMastered: (item: TypingQueueItem, mastered: boolean) => Promise<void>;
  resetWord: (item: TypingQueueItem) => Promise<void>;
  saveSession: (input: {
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
  }) => Promise<void>;
  importCustomBook: (name: string, seeds: TypingWordSeed[]) => Promise<{ imported: number; bookId: number }>;
  removeBook: (bookId: number) => Promise<void>;
  exportBackup: () => Promise<TypingBackup>;
  restoreBackup: (data: TypingBackup) => Promise<void>;
}

function applyRuntimeConfig(profile: TypingProfile): void {
  configureTypingSound({ enabled: profile.soundOn, volume: profile.soundVolume });
  configureTypingSpeech({ enabled: profile.ttsOn, accent: profile.accent, rate: profile.ttsRate });
}

function parseBuiltinSeeds(payload: BuiltinWordPayload): TypingWordSeed[] {
  const seeds: TypingWordSeed[] = [];
  for (const row of payload.words) {
    const word = String(row[0] ?? '').trim();
    const meaning = String(row[1] ?? '').trim();
    if (!word || !meaning) continue;
    seeds.push({
      word,
      meaning,
      unit: String(row[2] ?? ''),
      seq: Number(row[3]) || seeds.length + 1,
      uk: String(row[4] ?? ''),
      us: String(row[5] ?? ''),
      en: String(row[6] ?? ''),
      zh: String(row[7] ?? ''),
    });
  }
  return seeds;
}

async function loadBuiltinSeeds(): Promise<{ payload: BuiltinWordPayload; seeds: TypingWordSeed[] }> {
  const response = await fetch(builtinUrl);
  if (!response.ok) throw new Error(`内置词库读取失败（HTTP ${response.status}）`);
  const payload = JSON.parse(await response.text()) as BuiltinWordPayload;
  if (!payload || !Array.isArray(payload.words)) throw new Error('内置词库格式不正确');
  return { payload, seeds: parseBuiltinSeeds(payload) };
}

export const useTypingVocabStore = create<TypingVocabStore>()((set, get) => ({
  loaded: false,
  loading: false,
  lastError: '',
  books: [],
  profile: { ...DEFAULT_PROFILE },
  overview: null,
  dueCount: 0,
  daily: [],
  modeStats: [],
  units: [],
  wrongWords: [],
  favoriteWords: [],
  masteredWords: [],
  recentSessions: [],
  dataTick: 0,

  loadFromDb: async (force?: boolean) => {
    if (get().loading) return;
    if (!force && get().loaded) return;
    if (!isTauri()) {
      set({ loaded: true, lastError: '打字背单词依赖本地 SQLite，请在桌面端使用（npm run tauri dev）' });
      return;
    }
    set({ loading: true, lastError: '' });
    try {
      let books = await fetchTypingBooks();
      if (books.length === 0) {
        const { payload, seeds } = await loadBuiltinSeeds();
        await importTypingBook(
          { key: payload.key, name: payload.name, description: payload.description, builtin: true },
          seeds,
        );
        books = await fetchTypingBooks();
      }

      const profile = await fetchTypingProfile();
      const activeBookId = books.some((b) => b.id === profile.activeBookId)
        ? profile.activeBookId
        : (books[0]?.id ?? 0);
      if (activeBookId !== profile.activeBookId) {
        await updateTypingProfile({ activeBookId });
        profile.activeBookId = activeBookId;
      }

      applyRuntimeConfig(profile);
      set({ books, profile, loaded: true, loading: false });
      await get().refreshLists();
      await get().refreshStats();
    } catch (err) {
      set({
        loading: false,
        loaded: true,
        lastError: `打字背单词加载失败：${err instanceof Error ? err.message : String(err)}（可能需要重启应用完成数据迁移）`,
      });
    }
  },

  clearError: () => set({ lastError: '' }),

  saveProfile: async (updates) => {
    const prevBookId = get().profile.activeBookId;
    const next = { ...get().profile, ...updates };
    set({ profile: next });
    applyRuntimeConfig(next);
    try {
      await updateTypingProfile(updates);
      // 切换词库后，列表与统计都要按新词库重新查询
      if (updates.activeBookId !== undefined && updates.activeBookId !== prevBookId) {
        await get().refreshLists();
        await get().refreshStats();
      }
    } catch (err) {
      set({ lastError: `设置保存失败：${err instanceof Error ? err.message : String(err)}` });
    }
  },

  setActiveBook: async (bookId) => {
    await get().saveProfile({ activeBookId: bookId });
  },

  refreshLists: async () => {
    const bookId = get().profile.activeBookId;
    if (!bookId) {
      set({ wrongWords: [], favoriteWords: [], masteredWords: [], units: [] });
      return;
    }
    try {
      const [wrongWords, favoriteWords, masteredWords, units] = await Promise.all([
        fetchTypingWrongWords(bookId),
        fetchTypingFavoriteWords(bookId),
        fetchTypingMasteredWords(bookId),
        fetchTypingUnits(bookId),
      ]);
      set({ wrongWords, favoriteWords, masteredWords, units });
    } catch (err) {
      set({ lastError: `单词列表加载失败：${err instanceof Error ? err.message : String(err)}` });
    }
  },

  refreshStats: async () => {
    const bookId = get().profile.activeBookId;
    if (!bookId) {
      set({ overview: null, dueCount: 0, daily: [], modeStats: [], recentSessions: [] });
      return;
    }
    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
      const [overview, dueCount, daily, modeStats, recentSessions] = await Promise.all([
        fetchTypingOverview(bookId, todayStart, tomorrowStart),
        fetchTypingDueCount(bookId, new Date().toISOString()),
        fetchTypingDailyStats(bookId, 7),
        fetchTypingModeStats(bookId),
        fetchTypingRecentSessions(bookId, 12),
      ]);
      set({ overview, dueCount, daily, modeStats, recentSessions });
    } catch (err) {
      set({ lastError: `统计加载失败：${err instanceof Error ? err.message : String(err)}` });
    }
  },

  buildSessionQueue: async (kind, unit) => {
    const { profile } = get();
    if (!profile.activeBookId) return [];
    if (kind === 'today') {
      return buildTypingQueue(profile.activeBookId, profile.plan, {
        nowIso: new Date().toISOString(),
        limit: profile.sessionSize,
        newLimit: profile.dailyNew,
        reviewLimit: profile.dailyReview,
      });
    }
    return buildTypingDrillQueue(profile.activeBookId, kind, profile.sessionSize, unit);
  },

  rateWord: async (wordId, outcome, mode) => {
    const prev = await fetchTypingProgress(wordId);
    const state = {
      stage: prev?.stage ?? 0,
      perfectCount: prev?.perfectCount ?? 0,
      mastered: prev?.mastered ?? false,
    };
    const next = scheduleTypingAnswer(state, outcome);
    await upsertTypingProgress({
      wordId,
      stage: next.stage,
      dueAt: next.dueAt,
      mastered: next.mastered,
      favorited: prev?.favorited ?? false,
      correctCount: (prev?.correctCount ?? 0) + (outcome === 'wrong' ? 0 : 1),
      wrongCount: (prev?.wrongCount ?? 0) + (outcome === 'wrong' ? 1 : 0),
      perfectCount: next.perfectCount,
      lastResult: outcome,
      lastMode: mode,
      firstSeenAt: prev?.firstSeenAt ?? null,
      lastSeenAt: new Date().toISOString(),
    });
    if (outcome === 'wrong') playTypingSound('error');
    set((s) => ({ dataTick: s.dataTick + 1 }));
  },

  toggleFavorite: async (item) => {
    const next = !item.favorited;
    await setTypingWordFavorited(item.id, next);
    set((s) => ({
      wrongWords: s.wrongWords.map((w) => (w.id === item.id ? { ...w, favorited: next } : w)),
      favoriteWords: next
        ? [{ ...item, favorited: true }, ...s.favoriteWords]
        : s.favoriteWords.filter((w) => w.id !== item.id),
      dataTick: s.dataTick + 1,
    }));
    await get().refreshStats();
  },

  setMastered: async (item, mastered) => {
    await setTypingWordMastered(item.id, mastered);
    set((s) => ({
      wrongWords: mastered ? s.wrongWords.filter((w) => w.id !== item.id) : s.wrongWords,
      masteredWords: mastered
        ? [{ ...item, mastered: true }, ...s.masteredWords]
        : s.masteredWords.filter((w) => w.id !== item.id),
      dataTick: s.dataTick + 1,
    }));
    await get().refreshStats();
  },

  resetWord: async (item) => {
    await resetTypingWord(item.id);
    set((s) => ({
      wrongWords: s.wrongWords.filter((w) => w.id !== item.id),
      masteredWords: s.masteredWords.filter((w) => w.id !== item.id),
      dataTick: s.dataTick + 1,
    }));
    await get().refreshStats();
  },

  saveSession: async (input) => {
    const bookId = get().profile.activeBookId;
    if (!bookId) return;
    const finishedAt = new Date().toISOString();
    await insertTypingSession({ ...input, bookId, finishedAt });
    set((s) => ({ dataTick: s.dataTick + 1 }));
    playTypingSound('finish');
    await get().refreshLists();
    await get().refreshStats();
  },

  importCustomBook: async (name, seeds) => {
    const key = `custom-${Date.now()}`;
    const result = await importTypingBook(
      { key, name: name.trim() || '自定义词库', description: '用户导入', builtin: false },
      seeds,
    );
    const books = await fetchTypingBooks();
    set({ books });
    await get().saveProfile({ activeBookId: result.bookId });
    await get().refreshLists();
    await get().refreshStats();
    return { imported: result.imported, bookId: result.bookId };
  },

  removeBook: async (bookId) => {
    const book = get().books.find((b) => b.id === bookId);
    if (book?.builtin) throw new Error('内置词库不可删除');
    await deleteTypingBook(bookId);
    const books = await fetchTypingBooks();
    set({ books });
    if (get().profile.activeBookId === bookId) {
      await get().saveProfile({ activeBookId: books[0]?.id ?? 0 });
    }
    await get().refreshLists();
    await get().refreshStats();
  },

  exportBackup: async () => exportTypingBackup(),

  restoreBackup: async (data) => {
    await replaceTypingBackup(data);
    set({ loaded: false });
    await get().loadFromDb(true);
  },
}));


