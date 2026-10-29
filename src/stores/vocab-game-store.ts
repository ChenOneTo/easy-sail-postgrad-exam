import { create } from 'zustand';
import { Rating } from 'ts-fsrs';
import type { VocabMnemonicRecord, VocabQueueItem } from '../lib/exam-vocab-db';
import {
  ensureCardsForDirection, fetchVocabMnemonics, saveVocabMnemonic,
} from '../lib/exam-vocab-db';
import type { AiMnemonicDraft } from '../lib/ai-json';
import { canGenerateMnemonic, generateVocabMnemonic } from '../lib/vocab-mnemonic';
import {
  fetchGameProgress, fetchLevelWords, fetchRecentRuns, fetchWeeklyMinutes,
  fetchWordStatusCounts, insertGameRun, searchGameWords,
} from '../lib/vocab-game-db';
import type { DailyMinutes, GameProgress, GameRun, WordStatusCounts } from '../lib/vocab-game-db';
import { getPhonetics } from '../lib/vocab-phonetics';
import { isTauri } from '../lib/tauri';
import { useExamVocabStore } from './exam-vocab-store';

const SETTINGS_KEY = 'easysail-exam-vocab-game';

export type GamePhase = 'memory' | 'quiz' | 'result';
export type WordMark = 'fuzzy' | 'known';
export type WordStatus = 'new' | 'seen' | 'familiar' | 'mastered';

export interface GameSettings {
  /** 每关词数：10 / 15 / 20 */
  levelSize: 10 | 15 | 20;
  /** 记忆阶段时长（分钟，>0，无上限） */
  memoryMin: number;
  /** 测验阶段时长（分钟，>0，无上限） */
  quizMin: number;
  /** 每日目标关数 */
  dailyGoal: number;
  /** 通关正确率标准（0–1），全部关卡统一生效 */
  passAccuracy: number;
}

export interface GameWord extends VocabQueueItem {
  /** 兼容字段：优先美音，无则英音 */
  phonetic: string | null;
  phoneticUk: string | null;
  phoneticUs: string | null;
}

/** 关卡内单个词的 AI 助记状态 */
export interface GameMnemonic {
  status: 'loading' | 'ready' | 'error';
  data?: AiMnemonicDraft;
}

export interface QuizOption {
  id: number;
  text: string;
  correct: boolean;
}

export interface QuizQuestion {
  wordId: number;
  word: string;
  phonetic: string | null;
  options: QuizOption[];
  /** 已选项的 id；null = 未作答 */
  picked: number | null;
}

export interface GameResult {
  level: number;
  total: number;
  correct: number;
  accuracy: number;
  score: number;
  passed: boolean;
  durationMs: number;
  wrongWordIds: number[];
}

export interface GameSession {
  level: number;
  size: number;
  /** 开始时的通关线快照，避免会话中途改设置导致判定不一致 */
  passAccuracy: number;
  phase: GamePhase;
  words: GameWord[];
  memoryIndex: number;
  marks: Record<number, WordMark>;
  /** 当前阶段截止时间戳（ms） */
  phaseEndsAt: number;
  quiz: QuizQuestion[];
  quizIndex: number;
  startedAt: number;
  durationMs: number;
  /** 错词重测：不写成绩表，避免同一关重复累计 */
  isRetry: boolean;
  /** 重闯已通关卡：可写成绩表，但 replay=1 不计入关卡进度 */
  isReplay: boolean;
  /** 按 wordId 缓存的 AI 助记；进入关卡后后台预生成 */
  mnemonics: Record<number, GameMnemonic>;
  result: GameResult | null;
  /** 结果页写库中 */
  busy: boolean;
  lastError: string;
}

export interface VocabGameStore {
  loaded: boolean;
  loading: boolean;
  loadError: string;
  progress: GameProgress | null;
  statusCounts: WordStatusCounts;
  weekly: DailyMinutes[];
  runs: GameRun[];
  /** 到期复习数（今日待复习卡片，按当前背单词方向统计） */
  dueCount: number;
  /** 当前关卡（下一关）的词，用于首页词范围与单词本 */
  previewWords: GameWord[];
  settings: GameSettings;
  session: GameSession | null;

  load: () => Promise<void>;
  refresh: () => Promise<void>;
  clearLoadError: () => void;
  saveSettings: (updates: Partial<GameSettings>) => void;
  /** 不传关卡号 = 继续当前关；传已通关的关卡号 = 重闯（不推进进度） */
  startLevel: (level?: number) => Promise<boolean>;
  mark: (wordId: number, mark: WordMark) => void;
  /** 单条助记生成失败后的重试 */
  retryMnemonic: (wordId: number) => Promise<void>;
  gotoMemory: (index: number) => void;
  beginQuiz: () => void;
  pickOption: (optionId: number) => void;
  nextQuestion: () => void;
  expirePhase: () => void;
  retryWrong: () => void;
  exit: () => void;
  search: (keyword: string) => Promise<GameWord[]>;
}

const DEFAULT_SETTINGS: GameSettings = {
  levelSize: 20,
  memoryMin: 5,
  quizMin: 3,
  dailyGoal: 3,
  passAccuracy: 0.8,
};

const EMPTY_COUNTS: WordStatusCounts = { new: 0, seen: 0, familiar: 0, mastered: 0 };

/** 分钟数只约束「>0」，允许小数，不设上下限 */
function positiveMinutes(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n * 100) / 100;
}

function readSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    // 旧版本按秒存储（memorySec/quizSec），读取时折算成分钟
    const parsed = JSON.parse(raw) as Partial<GameSettings> & { memorySec?: number; quizSec?: number };
    const size = parsed.levelSize;
    const legacyMemory = typeof parsed.memorySec === 'number' && parsed.memorySec > 0
      ? Math.round((parsed.memorySec / 60) * 100) / 100
      : DEFAULT_SETTINGS.memoryMin;
    const legacyQuiz = typeof parsed.quizSec === 'number' && parsed.quizSec > 0
      ? Math.round((parsed.quizSec / 60) * 100) / 100
      : DEFAULT_SETTINGS.quizMin;
    return {
      levelSize: size === 10 || size === 15 || size === 20 ? size : DEFAULT_SETTINGS.levelSize,
      memoryMin: positiveMinutes(parsed.memoryMin, legacyMemory),
      quizMin: positiveMinutes(parsed.quizMin, legacyQuiz),
      dailyGoal: typeof parsed.dailyGoal === 'number' ? parsed.dailyGoal : DEFAULT_SETTINGS.dailyGoal,
      passAccuracy: typeof parsed.passAccuracy === 'number' && parsed.passAccuracy >= 0.5 && parsed.passAccuracy <= 1
        ? parsed.passAccuracy
        : DEFAULT_SETTINGS.passAccuracy,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function withPhonetic(w: VocabQueueItem): GameWord {
  const p = getPhonetics(w.word);
  return { ...w, phonetic: p.us ?? p.uk, phoneticUk: p.uk, phoneticUs: p.us };
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 由词表生成 4 选 1 的英译中题目；干扰项优先取同批其他词，词数不足时降级为更少选项 */
function buildQuiz(words: GameWord[]): QuizQuestion[] {
  const pool = words.map((w) => w.meaning).filter((m, i, arr) => m && arr.indexOf(m) === i);
  return words.map((w) => {
    const distractors = shuffle(pool.filter((m) => m !== w.meaning)).slice(0, 3);
    const options = shuffle([w.meaning, ...distractors].map((text, i) => ({
      id: i + 1,
      text,
      correct: text === w.meaning,
    })));
    return {
      wordId: w.wordId,
      word: w.word,
      phonetic: w.phonetic,
      options,
      picked: null,
    };
  });
}

/** 卡片状态 → 四档掌握度（与状态栏口径一致） */
export function wordStatusOf(w: { state: string; reps: number }): WordStatus {
  if (w.state === 'new') return 'new';
  if (w.state !== 'review' || w.reps <= 1) return 'seen';
  return w.reps <= 2 ? 'familiar' : 'mastered';
}

function accuracyOf(quiz: QuizQuestion[]): { correct: number; total: number } {
  const total = quiz.length;
  const correct = quiz.filter((q) => {
    const picked = q.options.find((o) => o.id === q.picked);
    return !!picked?.correct;
  }).length;
  return { correct, total };
}

export const useVocabGameStore = create<VocabGameStore>((set, get) => ({
  loaded: false,
  loading: false,
  loadError: '',
  progress: null,
  statusCounts: EMPTY_COUNTS,
  weekly: [],
  runs: [],
  dueCount: 0,
  previewWords: [],
  settings: readSettings(),
  session: null,

  load: async () => {
    if (get().loading) return;
    if (!isTauri()) {
      set({ loaded: true, loadError: '单词闯关依赖本地词库，请在桌面端使用。' });
      return;
    }
    set({ loading: true });
    try {
      const vocab = useExamVocabStore.getState();
      if (!vocab.loaded) await vocab.loadFromDb();
      if (useExamVocabStore.getState().wordCount === 0) {
        set({ loaded: true, loadError: useExamVocabStore.getState().lastError || '词库为空，无法开始闯关。' });
        return;
      }
      // 用户可能把卡片方向切到 zh2en，闯关固定英译中，先补建 en2zh 卡
      await ensureCardsForDirection('en2zh');
      await get().refresh();
      set({ loaded: true, loadError: '' });
    } catch (err) {
      console.error('[VocabGameStore] 加载失败:', err);
      set({
        loaded: true,
        loadError: `闯关数据加载失败：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      set({ loading: false });
    }
  },

  clearLoadError: () => set({ loadError: '' }),

  refresh: async () => {
    const size = get().settings.levelSize;
    const [progress, statusCounts, weekly, runs] = await Promise.all([
      fetchGameProgress(),
      fetchWordStatusCounts(),
      fetchWeeklyMinutes(),
      fetchRecentRuns(200),
    ]);
    const preview = await fetchLevelWords(progress.passedWords, size);
    let dueCount = 0;
    try {
      dueCount = await useExamVocabStore.getState().dueReviewCount(new Date().toISOString());
    } catch { /* 复习计数失败不影响闯关概览 */ }
    set({ progress, statusCounts, weekly, runs, dueCount, previewWords: preview.map(withPhonetic) });
  },

  saveSettings: (updates) => {
    const candidate = { ...get().settings, ...updates };
    // 只保证 >0 且为整数分钟，不设上下限
    const next: GameSettings = {
      ...candidate,
      memoryMin: positiveMinutes(candidate.memoryMin, DEFAULT_SETTINGS.memoryMin),
      quizMin: positiveMinutes(candidate.quizMin, DEFAULT_SETTINGS.quizMin),
    };
    set({ settings: next });
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* 隐私模式忽略 */ }
    void get().refresh().catch((err) => console.error('[VocabGameStore] 刷新失败:', err));
  },

  startLevel: async (level) => {
    const { progress, settings } = get();
    let passedWords = progress?.passedWords ?? 0;
    try {
      // 以库里最新进度为准：刚通关时 refresh 可能尚未回落，避免重复加载已通过的关卡
      try {
        passedWords = (await fetchGameProgress()).passedWords;
      } catch { /* 取不到则沿用内存进度 */ }
      const currentLevel = Math.floor(passedWords / settings.levelSize) + 1;
      // 不能跳关：越界的关卡号夹到当前关；小于当前关即重闯
      const target = level === undefined ? currentLevel : Math.max(1, Math.min(level, currentLevel));
      const isReplay = target < currentLevel;
      const offset = (target - 1) * settings.levelSize;
      const words = (await fetchLevelWords(offset, settings.levelSize)).map(withPhonetic);
      if (words.length === 0) {
        set({ loadError: '词库已全部学完，等待新一轮词表。' });
        return false;
      }
      const now = Date.now();
      set({
        session: {
          level: target,
          size: settings.levelSize,
          passAccuracy: settings.passAccuracy,
          phase: 'memory',
          words,
          memoryIndex: 0,
          marks: {},
          phaseEndsAt: now + settings.memoryMin * 60 * 1000,
          quiz: [],
          quizIndex: 0,
          startedAt: now,
          durationMs: 0,
          isRetry: false,
          isReplay,
          mnemonics: {},
          result: null,
          busy: false,
          lastError: '',
        },
        loadError: '',
      });
      // 进入记忆阶段即后台预生成整关助记；用户翻到某词时通常已就绪
      mnemonicAbort?.abort();
      void preloadMnemonics(set, get, words, now);
      return true;
    } catch (err) {
      set({ loadError: `关卡装载失败：${err instanceof Error ? err.message : String(err)}` });
      return false;
    }
  },

  mark: (wordId, mark) => {
    const s = get().session;
    if (!s) return;
    // 标记后自动进入下一个单词；最后一个词停留原地，等用户手动开始测验
    const next = Math.min(s.memoryIndex + 1, s.words.length - 1);
    set({ session: { ...s, marks: { ...s.marks, [wordId]: mark }, memoryIndex: next } });
  },

  retryMnemonic: async (wordId) => {
    const s = get().session;
    const word = s?.words.find((w) => w.wordId === wordId);
    if (!s || !word) return;
    const token = s.startedAt;
    setMnemonic(set, get, token, wordId, { status: 'loading' });
    try {
      const draft = await generateVocabMnemonic(word.word, word.meaning);
      if (!draft) {
        setMnemonic(set, get, token, wordId, { status: 'error' });
        return;
      }
      try { await saveVocabMnemonic(wordId, draft); } catch { /* 存库失败不阻塞展示 */ }
      setMnemonic(set, get, token, wordId, { status: 'ready', data: draft });
    } catch {
      setMnemonic(set, get, token, wordId, { status: 'error' });
    }
  },

  gotoMemory: (index) => {
    const s = get().session;
    if (!s) return;
    const next = Math.max(0, Math.min(index, s.words.length - 1));
    set({ session: { ...s, memoryIndex: next } });
  },

  beginQuiz: () => {
    const s = get().session;
    if (!s || s.phase !== 'memory') return;
    // 记忆阶段结束，剩余词的助记不再需要，停掉后台请求
    mnemonicAbort?.abort();
    const quiz = buildQuiz(s.words);
    set({
      session: {
        ...s,
        phase: 'quiz',
        quiz,
        quizIndex: 0,
        phaseEndsAt: Date.now() + get().settings.quizMin * 60 * 1000,
      },
    });
  },

  pickOption: (optionId) => {
    const s = get().session;
    if (!s || s.phase !== 'quiz') return;
    const q = s.quiz[s.quizIndex];
    if (!q || q.picked !== null) return;
    const quiz = s.quiz.map((item, i) => (i === s.quizIndex ? { ...item, picked: optionId } : item));
    set({ session: { ...s, quiz } });
  },

  nextQuestion: () => {
    const s = get().session;
    if (!s || s.phase !== 'quiz') return;
    if (s.quizIndex + 1 >= s.quiz.length) {
      void finishQuiz(set, get);
      return;
    }
    set({ session: { ...s, quizIndex: s.quizIndex + 1 } });
  },

  expirePhase: () => {
    const s = get().session;
    if (!s) return;
    if (s.phase === 'memory') get().beginQuiz();
    else if (s.phase === 'quiz') void finishQuiz(set, get);
  },

  retryWrong: () => {
    const s = get().session;
    if (!s?.result || s.result.wrongWordIds.length === 0) return;
    mnemonicAbort?.abort();
    const wrongIds = new Set(s.result.wrongWordIds);
    const words = s.words.filter((w) => wrongIds.has(w.wordId));
    const quiz = buildQuiz(words);
    set({
      session: {
        ...s,
        phase: 'quiz',
        words,
        quiz,
        quizIndex: 0,
        marks: {},
        result: null,
        isRetry: true,
        busy: false,
        lastError: '',
        startedAt: Date.now(),
        phaseEndsAt: Date.now() + get().settings.quizMin * 60 * 1000,
      },
    });
  },

  exit: () => {
    mnemonicAbort?.abort();
    mnemonicAbort = null;
    set({ session: null });
    void get().refresh().catch((err) => console.error('[VocabGameStore] 刷新失败:', err));
  },

  search: async (keyword) => {
    const q = keyword.trim();
    if (!q) return get().previewWords;
    try {
      const rows = await searchGameWords(q, 100);
      return rows.map(withPhonetic);
    } catch {
      return [];
    }
  },
}));

type SetFn = (
  partial: Partial<VocabGameStore> | ((state: VocabGameStore) => Partial<VocabGameStore>)
) => void;

/**
 * 结束测验：先出结果页，再异步提交评分与成绩。
 * 评分走背单词 store 的 rateCard，即闯关成绩同样参与 FSRS 调度与难词本；
 * 答错记 Again，答对记 Good。单项失败不阻断其余词。
 */
async function finishQuiz(set: SetFn, get: () => VocabGameStore): Promise<void> {
  const s = get().session;
  if (!s || s.phase !== 'quiz') return;
  const { correct, total } = accuracyOf(s.quiz);
  const accuracy = total > 0 ? correct / total : 0;
  const durationMs = Date.now() - s.startedAt;
  const wrongWordIds = s.quiz
    .filter((q) => !q.options.find((o) => o.id === q.picked)?.correct)
    .map((q) => q.wordId);
  const result: GameResult = {
    level: s.level,
    total,
    correct,
    accuracy,
    score: Math.round(accuracy * 100),
    passed: accuracy >= s.passAccuracy,
    durationMs,
    wrongWordIds,
  };
  set({
    session: { ...s, phase: 'result', quizIndex: Math.max(0, s.quiz.length - 1), durationMs, result, busy: true },
  });

  const vocab = useExamVocabStore.getState();
  const perMs = Math.max(1, Math.round(durationMs / Math.max(1, total)));
  let failed = '';
  for (const q of s.quiz) {
    const word = s.words.find((w) => w.wordId === q.wordId);
    if (!word) continue;
    const isCorrect = !!q.options.find((o) => o.id === q.picked)?.correct;
    try {
      await vocab.rateCard(word, isCorrect ? Rating.Good : Rating.Again, perMs);
    } catch {
      failed = '部分单词的复习记录写入失败，可在背单词页重试。';
    }
  }

  if (!s.isRetry) {
    try {
      await insertGameRun({
        level: s.level,
        levelSize: s.size,
        wordsTotal: total,
        correct,
        answered: total,
        accuracy,
        durationMs,
        passed: result.passed,
        replay: s.isReplay,
        startedAt: new Date(s.startedAt).toISOString(),
      });
    } catch {
      failed = failed || '闯关成绩保存失败，本次进度可能未计入。';
    }
  }

  try { await get().refresh(); } catch { /* 概览刷新失败不影响结果页 */ }
  const latest = get().session;
  if (latest) set({ session: { ...latest, busy: false, lastError: failed } });
}

// ========== AI 助记预生成 ==========

/** 当前关卡的助记生成控制器；切关/退出/进入测验时中止，避免浪费额度 */
let mnemonicAbort: AbortController | null = null;

function mnemonicDraftFromRecord(rec: VocabMnemonicRecord): AiMnemonicDraft {
  return {
    roots: rec.roots,
    mnemonic: rec.mnemonic,
    method: rec.method,
    scene: rec.scene,
    sentence: rec.sentence,
    sentenceZh: rec.sentenceZh,
  };
}

/** 仅更新仍属于同一会话的助记状态，防止旧会话的异步结果写进新关卡 */
function setMnemonic(
  set: SetFn,
  get: () => VocabGameStore,
  token: number,
  wordId: number,
  entry: GameMnemonic,
): void {
  const s = get().session;
  if (!s || s.startedAt !== token) return;
  set({ session: { ...s, mnemonics: { ...s.mnemonics, [wordId]: entry } } });
}

/**
 * 关卡开始时预生成整关助记：
 * 1. 批量读库，已缓存的直接置为 ready；
 * 2. 缺的并发 3 路生成并逐个回写，用户翻到后面单词时通常已经就绪；
 * 3. 单条失败只标记 error，可在卡片上点重试。
 */
async function preloadMnemonics(
  set: SetFn,
  get: () => VocabGameStore,
  words: GameWord[],
  token: number,
): Promise<void> {
  if (!canGenerateMnemonic()) return;

  let records: VocabMnemonicRecord[] = [];
  try {
    records = await fetchVocabMnemonics(words.map((w) => w.wordId));
  } catch { /* 表未迁移/读库失败：全部按未缓存处理 */ }

  const cached = new Map(records.map((rec) => [rec.wordId, rec]));
  const missing: GameWord[] = [];
  const ready: Record<number, GameMnemonic> = {};
  for (const w of words) {
    const rec = cached.get(w.wordId);
    // scene/method 为空代表旧版助记（只有词根+口诀），按未缓存处理，补生成生动画面
    if (rec?.mnemonic && (rec.scene || rec.method)) {
      ready[w.wordId] = { status: 'ready', data: mnemonicDraftFromRecord(rec) };
    } else {
      missing.push(w);
    }
  }

  const s = get().session;
  if (!s || s.startedAt !== token) return;
  const mnemonics: Record<number, GameMnemonic> = { ...s.mnemonics, ...ready };
  for (const w of missing) mnemonics[w.wordId] = { status: 'loading' };
  set({ session: { ...s, mnemonics } });
  if (missing.length === 0) return;

  const controller = new AbortController();
  mnemonicAbort = controller;
  const queue = [...missing];
  const worker = async (): Promise<void> => {
    for (;;) {
      if (controller.signal.aborted) return;
      const w = queue.shift();
      if (!w) return;
      try {
        const draft = await generateVocabMnemonic(w.word, w.meaning, controller.signal);
        if (!draft) {
          setMnemonic(set, get, token, w.wordId, { status: 'error' });
          continue;
        }
        try { await saveVocabMnemonic(w.wordId, draft); } catch { /* 存库失败不阻塞展示 */ }
        setMnemonic(set, get, token, w.wordId, { status: 'ready', data: draft });
      } catch (err) {
        if (controller.signal.aborted) return;
        console.warn('[VocabGame] AI 助记生成失败:', err);
        setMnemonic(set, get, token, w.wordId, { status: 'error' });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, missing.length) }, () => worker()));
  if (mnemonicAbort === controller) mnemonicAbort = null;
}
