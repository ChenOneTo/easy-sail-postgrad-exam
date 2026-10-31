import type { Task } from './types';
import type { ExamCloudSnapshot } from './exam-db';
import type { ExamVocabCloudSnapshot } from './exam-vocab-db';
import type { ReadingBankSnapshot } from './exam-reading-db';
import { isTauri } from './tauri';

const CLOUD_DIR_KEY = 'easysail-exam-cloud-dir';
const CLOUD_FILE = 'easysail-exam-tasks.json';
const EXAM_CLOUD_FILE = 'easysail-exam-plan.json';
const EXAM_VOCAB_CLOUD_FILE = 'easysail-exam-vocab.json';
const EXAM_READING_CLOUD_FILE = 'easysail-exam-reading.json';
const AUTO_SAVE_KEY = 'easysail-exam-cloud-autosave';
const AUTO_INTERVAL_KEY = 'easysail-exam-cloud-interval';
const CLOUD_DATA_KEY = 'easysail-exam-cloud-data'; // 浏览器模式 fallback
const CLOUD_EXAM_DATA_KEY = 'easysail-exam-cloud-plan-data';
const CLOUD_EXAM_VOCAB_DATA_KEY = 'easysail-exam-cloud-vocab-data';
const CLOUD_EXAM_READING_DATA_KEY = 'easysail-exam-cloud-reading-data';

let autoSaveTimer: ReturnType<typeof setInterval> | null = null;

// ========== 配置管理 ==========

/** 获取云盘同步目录 */
export function getCloudDir(): string {  return localStorage.getItem(CLOUD_DIR_KEY) || '';
}

/** 设置云盘同步目录 */
export function setCloudDir(dir: string) {  if (dir) {
    localStorage.setItem(CLOUD_DIR_KEY, dir);
  } else {
    localStorage.removeItem(CLOUD_DIR_KEY);
  }
}

/** 是否启用自动同步 */
export function getAutoSave(): boolean {  return localStorage.getItem(AUTO_SAVE_KEY) === 'true';
}

/** 设置自动同步开关 */
export function setAutoSave(enabled: boolean) {  localStorage.setItem(AUTO_SAVE_KEY, String(enabled));
  if (enabled) {
    startAutoSave();
  } else {
    stopAutoSave();
  }
}

/** 获取自动同步间隔（秒） */
export function getAutoInterval(): number {  const val = parseInt(localStorage.getItem(AUTO_INTERVAL_KEY) || '60', 10);
  return val >= 10 ? val : 60;
}

/** 设置自动同步间隔 */
export function setAutoInterval(seconds: number) {  localStorage.setItem(AUTO_INTERVAL_KEY, String(seconds));
  if (getAutoSave()) {
    stopAutoSave();
    startAutoSave();
  }
}

// ========== 核心读写（Tauri + 浏览器双模式） ==========

/** 将任务数据保存到云盘目录 */
export async function saveToCloud(tasks: Task[]): Promise<{ path: string; count: number }> {
  const data = { version: 1, exportedAt: new Date().toISOString(), tasks };
  return saveCollectionToCloud(CLOUD_FILE, data, CLOUD_DATA_KEY);
}

/** 从云盘目录读取任务数据（Tauri 文件优先，失败 fallback 到 localStorage） */
export async function loadFromCloud(): Promise<Task[]> {
  return loadCollectionFromCloud<Task[]>(CLOUD_FILE, CLOUD_DATA_KEY, parseTaskData);
}

/** 将考研计划数据保存到云盘目录（独立文件，不与任务混合） */
export async function saveExamToCloud(snapshot: ExamCloudSnapshot): Promise<{ path: string; count: number }> {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    exam: {
      profile: snapshot.profile,
      subjects: snapshot.subjects,
      phases: snapshot.phases,
      tasks: snapshot.tasks,
    },
  };
  return saveCollectionToCloud(EXAM_CLOUD_FILE, data, CLOUD_EXAM_DATA_KEY);
}

/** 从云盘目录读取考研计划数据 */
export async function loadExamFromCloud(): Promise<ExamCloudSnapshot> {
  return loadCollectionFromCloud<ExamCloudSnapshot>(EXAM_CLOUD_FILE, CLOUD_EXAM_DATA_KEY, parseExamData);
}

/** 将背单词调度数据保存到云盘目录（独立文件，不含词库本体，可从 TSV 重导） */
export async function saveExamVocabToCloud(snapshot: ExamVocabCloudSnapshot): Promise<{ path: string; count: number }> {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    vocab: snapshot,
  };
  return saveCollectionToCloud(EXAM_VOCAB_CLOUD_FILE, data, CLOUD_EXAM_VOCAB_DATA_KEY);
}

/** 从云盘目录读取背单词数据；云盘与本地均无数据时返回 null（不抛错），格式/IO 错误仍抛出 */
export async function loadExamVocabFromCloud(): Promise<ExamVocabCloudSnapshot | null> {
  try {
    return await loadCollectionFromCloud<ExamVocabCloudSnapshot>(EXAM_VOCAB_CLOUD_FILE, CLOUD_EXAM_VOCAB_DATA_KEY, parseExamVocabData);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 云盘与本地均无数据：视为空态而非失败，返回 null 由调用方给出友好提示
    if (msg.includes('未找到云盘数据')) return null;
    throw err;
  }
}

/** 解析背单词数据（兼容 {vocab:{...}} 与顶层字段两种格式） */
function parseExamVocabData(text: string): ExamVocabCloudSnapshot {
  const data = JSON.parse(text);
  const vocab = data?.vocab ?? data;
  if (vocab?.profile && Array.isArray(vocab.cards)) {
    // reviews/hardwords/mnemonics 可能在手工编辑/旧备份/部分损坏时缺失，
    // 这里归一化为 []，避免 replaceExamVocabData 的 for...of 拿到 undefined 崩溃
    return {
      ...vocab,
      reviews: Array.isArray(vocab.reviews) ? vocab.reviews : [],
      hardwords: Array.isArray(vocab.hardwords) ? vocab.hardwords : [],
      mnemonics: Array.isArray(vocab.mnemonics) ? vocab.mnemonics : [],
      gameRuns: Array.isArray(vocab.gameRuns) ? vocab.gameRuns : [],
    } as ExamVocabCloudSnapshot;
  }
  throw new Error('文件格式无法识别');
}

/** 将英语二阅读数据保存到云盘目录（独立文件，不含题库本体） */
export async function saveExamReadingToCloud(snapshot: ReadingBankSnapshot): Promise<{ path: string; count: number }> {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    reading: snapshot,
  };
  return saveCollectionToCloud(EXAM_READING_CLOUD_FILE, data, CLOUD_EXAM_READING_DATA_KEY);
}

/** 从云盘目录读取阅读数据；云盘与本地均无数据时返回 null（不抛错），格式/IO 错误仍抛出 */
export async function loadExamReadingFromCloud(): Promise<ReadingBankSnapshot | null> {
  try {
    return await loadCollectionFromCloud<ReadingBankSnapshot>(
      EXAM_READING_CLOUD_FILE,
      CLOUD_EXAM_READING_DATA_KEY,
      parseExamReadingData,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('未找到云盘数据')) return null;
    throw err;
  }
}

/** 解析阅读数据（兼容 {reading:{...}} 与顶层字段两种格式） */
function parseExamReadingData(text: string): ReadingBankSnapshot {
  const data = JSON.parse(text);
  const reading = data?.reading ?? data;
  if (reading?.profile && Array.isArray(reading.sessions)) {
    return {
      profile: reading.profile,
      sessions: Array.isArray(reading.sessions) ? reading.sessions : [],
      sessionQuestions: Array.isArray(reading.sessionQuestions) ? reading.sessionQuestions : [],
      attempts: Array.isArray(reading.attempts) ? reading.attempts : [],
      wrongbook: Array.isArray(reading.wrongbook) ? reading.wrongbook : [],
    } as ReadingBankSnapshot;
  }
  throw new Error('文件格式无法识别');
}

/** 解析考研数据（兼容 {exam:{...}} 与顶层字段两种格式） */
function parseExamData(text: string): ExamCloudSnapshot {
  const data = JSON.parse(text);
  const exam = data?.exam ?? data;
  if (exam?.profile && Array.isArray(exam.subjects) && Array.isArray(exam.tasks)) {
    return exam as ExamCloudSnapshot;
  }
  throw new Error('文件格式无法识别');
}

/** 检查云盘目录中是否存在数据文件（含 localStorage fallback） */
export async function cloudFileExists(): Promise<boolean> {  const dir = getCloudDir();

  if (isTauri()) {
    if (dir) {
      try {
        const { exists } = await import('@tauri-apps/plugin-fs');
        const { join } = await import('@tauri-apps/api/path');
        const filePath = await join(dir, CLOUD_FILE);
        if (await exists(filePath)) return true;
        // 也检查考研计划文件
        const examFilePath = await join(dir, EXAM_CLOUD_FILE);
        if (await exists(examFilePath)) return true;
        // 也检查背单词文件
        const vocabFilePath = await join(dir, EXAM_VOCAB_CLOUD_FILE);
        if (await exists(vocabFilePath)) return true;
        // 也检查阅读文件
        const readingFilePath = await join(dir, EXAM_READING_CLOUD_FILE);
        if (await exists(readingFilePath)) return true;
      } catch {
        // 文件检查失败，继续检查 localStorage
      }
    }
    return !!localStorage.getItem(CLOUD_DATA_KEY)
      || !!localStorage.getItem(CLOUD_EXAM_DATA_KEY)
      || !!localStorage.getItem(CLOUD_EXAM_VOCAB_DATA_KEY)
      || !!localStorage.getItem(CLOUD_EXAM_READING_DATA_KEY);
  }

  // 浏览器 fallback
  return !!localStorage.getItem(CLOUD_DATA_KEY)
    || !!localStorage.getItem(CLOUD_EXAM_DATA_KEY)
    || !!localStorage.getItem(CLOUD_EXAM_VOCAB_DATA_KEY)
    || !!localStorage.getItem(CLOUD_EXAM_READING_DATA_KEY);
}

/** 解析任务数据（兼容纯数组和对象格式） */
function parseTaskData(text: string): Task[] {
  const data = JSON.parse(text);
  if (Array.isArray(data)) return data;
  if (data?.tasks && Array.isArray(data.tasks)) return data.tasks;
  throw new Error('文件格式无法识别');
}

// ========== 通用集合同写（Tauri + 浏览器双模式） ==========

/** 将任意集合数据保存到云盘目录的指定文件 */
export async function saveCollectionToCloud(
  filename: string,
  data: unknown,
  localStorageKey: string,
): Promise<{ path: string; count: number }> {  const dir = getCloudDir();
  if (!dir) throw new Error('未设置云盘同步目录');

  const json = JSON.stringify(data, null, 2);

  if (isTauri()) {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const { join } = await import('@tauri-apps/api/path');
    const filePath = await join(dir, filename);
    await writeTextFile(filePath, json);
    return { path: filePath, count: Array.isArray(data) ? data.length : 1 };
  }

  // 浏览器 fallback：存到 localStorage
  localStorage.setItem(localStorageKey, json);
  return { path: `${dir}/${filename}（浏览器模式）`, count: Array.isArray(data) ? data.length : 1 };
}

/** 从云盘目录读取任意集合数据（Tauri 文件优先，失败 fallback 到 localStorage） */
export async function loadCollectionFromCloud<T>(
  filename: string,
  localStorageKey: string,
  parser: (text: string) => T,
): Promise<T> {  const dir = getCloudDir();

  // Tauri 模式：优先读文件，失败则 fallback 到 localStorage
  if (isTauri()) {
    if (dir) {
      try {
        const { readTextFile, exists } = await import('@tauri-apps/plugin-fs');
        const { join } = await import('@tauri-apps/api/path');
        const filePath = await join(dir, filename);
        const fileExists = await exists(filePath);
        if (fileExists) {
          const text = await readTextFile(filePath);
          return parser(text);
        }
      } catch (err) {
        console.warn('[Cloud] 文件读取失败，尝试 localStorage fallback:', err);
      }
    }
    // fallback：读取 localStorage
    const text = localStorage.getItem(localStorageKey);
    if (text) return parser(text);
    throw new Error('未找到云盘数据（文件与本地缓存均无数据）');
  }

  // 浏览器模式：从 localStorage 读取
  const text = localStorage.getItem(localStorageKey);
  if (!text) throw new Error('浏览器模式：未找到云盘数据');
  return parser(text);
}

// ========== 目录选择 ==========

/** 弹出目录选择对话框 */
export async function pickCloudDir(): Promise<string | null> {
  if (isTauri()) {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择云盘同步目录（如 OneDrive / Dropbox / 坚果云文件夹）',
      });
      if (selected) {
        setCloudDir(selected as string);
        return selected as string;
      }
      return null;
    } catch (err) {
      console.warn('[Cloud] 目录选择对话框出错:', err);
    }
  }

  // 非 Tauri 环境或对话框出错：回退到手动输入
  const manual = prompt(
    '请输入云盘同步目录的完整路径：\n' +
    '（例如 C:\\Users\\xxx\\OneDrive\\轻舟AI考研）\n\n' +
    '提示：当前为浏览器模式，数据将保存在浏览器本地存储中。'
  );
  if (manual?.trim()) {
    setCloudDir(manual.trim());
    return manual.trim();
  }
  return null;
}

// ========== 自动同步 ==========

let _getTasks: (() => Task[]) | null = null;
let _getExam: (() => ExamCloudSnapshot | null) | null = null;
let _getExamVocab: (() => Promise<ExamVocabCloudSnapshot | null>) | null = null;
let _getExamReading: (() => Promise<ReadingBankSnapshot | null>) | null = null;

/** 注册获取任务的回调（由 store 调用） */
export function registerTaskGetter(fn: () => Task[]) {
  _getTasks = fn;
}

/** 注册考研计划快照回调：未加载/无科目时返回 null，自动同步将跳过该文件 */
export function registerExamGetter(fn: () => ExamCloudSnapshot | null) {
  _getExam = fn;
}

/**
 * 注册背单词快照回调：未加载时返回 null，自动同步将跳过该文件。
 * 背单词快照需查库（cards/reviews 全量），故允许返回 Promise。
 */
export function registerExamVocabGetter(fn: () => Promise<ExamVocabCloudSnapshot | null>) {
  _getExamVocab = fn;
}

/** 注册阅读快照回调：未加载/无题库/无写入时返回 null，自动同步将跳过该文件 */
export function registerExamReadingGetter(fn: () => Promise<ReadingBankSnapshot | null>) {
  _getExamReading = fn;
}

function startAutoSave() {
  stopAutoSave();
  const interval = getAutoInterval() * 1000;
  autoSaveTimer = setInterval(async () => {
    if (!getCloudDir()) return;
    try {
      if (_getTasks) await saveToCloud(_getTasks());
      const exam = _getExam?.();
      if (exam) await saveExamToCloud(exam);
      const vocab = await _getExamVocab?.();
      if (vocab) await saveExamVocabToCloud(vocab);
      const reading = await _getExamReading?.();
      if (reading) await saveExamReadingToCloud(reading);
      console.log('[Cloud] 自动保存完成');
    } catch (err) {
      console.warn('[Cloud] 自动保存失败:', err);
    }
  }, interval);
}

function stopAutoSave() {
  if (autoSaveTimer) {
    clearInterval(autoSaveTimer);
    autoSaveTimer = null;
  }
}

/** 初始化自动同步（应用启动时调用） */
export function initCloudSync() {  if (getAutoSave() && getCloudDir()) {
    startAutoSave();
    console.log(`[Cloud] 自动同步已启用，间隔 ${getAutoInterval()}秒`);
  }
}
