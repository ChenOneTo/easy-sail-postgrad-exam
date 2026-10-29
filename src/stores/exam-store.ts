import { create } from 'zustand';
import type { ExamProfile, ExamSubject, ExamPhase, ExamTask, ExamTaskStatus, ExamTaskPatch, ExamCloudSnapshot } from '../lib/exam-db';
import {
  fetchExamProfile, updateExamProfile as dbUpdateProfile,
  fetchExamSubjects, fetchExamPhases, updateExamPhase as dbUpdatePhase,
  fetchExamTasks, insertExamTask, updateExamTask as dbUpdateExamTask, deleteExamTask as dbDeleteExamTask,
  replaceExamData,
} from '../lib/exam-db';
import { saveExamToCloud, loadExamFromCloud } from '../lib/cloud';
import { localDateStr } from '../lib/utils';
import { isTauri } from '../lib/tauri';

const DEFAULT_PROFILE: ExamProfile = { examDate: '2026-12-19', targetNote: '', dailyGoalMinutes: 120 };

/** 数据库不可用时的科目兜底，保证页面可用 */
const FALLBACK_SUBJECTS: ExamSubject[] = [
  { id: 1, key: 'english', name: '英语', color: '#3B82F6', sortOrder: 0, archived: false },
  { id: 2, key: 'math', name: '数学', color: '#F59E0B', sortOrder: 1, archived: false },
  { id: 3, key: 'logic', name: '逻辑', color: '#8B5CF6', sortOrder: 2, archived: false },
];

export interface AddExamTaskInput {
  subjectKey: string;
  title: string;
  notes?: string;
  planDate?: string | null;
}

interface ExamStore {
  loaded: boolean;
  loading: boolean;
  /** 最近一次数据库操作失败的提示（空串=无错误），页面顶部横幅展示 */
  lastError: string;
  profile: ExamProfile;
  subjects: ExamSubject[];
  phases: ExamPhase[];
  tasks: ExamTask[];

  /** 惰性加载：进入考研专区时调用一次；force=true 时强制重新从数据库读取 */
  loadFromDb: (force?: boolean) => Promise<void>;
  clearError: () => void;
  /** 当前状态的云盘备份快照（未加载或无科目时返回 null） */
  getCloudSnapshot: () => ExamCloudSnapshot | null;
  /** 备份当前数据到云盘 */
  backupToCloud: () => Promise<{ path: string; count: number }>;
  /** 从云盘恢复（整体覆盖本地考试数据） */
  restoreFromCloud: () => Promise<void>;
  saveProfile: (updates: Partial<Omit<ExamProfile, 'examDate'> & { examDate: string | null }>) => Promise<void>;

  addTask: (input: AddExamTaskInput) => Promise<ExamTask | null>;
  addTasks: (inputs: AddExamTaskInput[]) => Promise<void>;
  updateExamTaskFields: (id: number, patch: ExamTaskPatch) => Promise<void>;
  deleteExamTaskById: (id: number) => Promise<void>;
  /** 三态切换：doing 时记开始日期，并自动顺延早于开始日的计划日期 */
  setExamTaskStatus: (id: number, status: ExamTaskStatus) => Promise<void>;

  editPhase: (id: number, patch: Partial<Pick<ExamPhase, 'name' | 'startDate' | 'endDate' | 'goal'>>) => Promise<void>;
}

export const useExamStore = create<ExamStore>()((set, get) => ({
  loaded: false,
  loading: false,
  lastError: '',
  profile: DEFAULT_PROFILE,
  subjects: [],
  phases: [],
  tasks: [],

  /**
   * 惰性加载：进入考研专区时调用一次。
   * - Tauri 桌面端：从 SQLite 加载，失败显示横幅
   * - 浏览器模式：跳过数据库，使用兜底数据（仅内存，不持久化）
   */
  loadFromDb: async (force?: boolean) => {
    if (get().loading) return;
    if (!force && get().loaded) return;
    if (!isTauri()) {
      set({ loaded: true, subjects: FALLBACK_SUBJECTS });
      return;
    }
    set({ loading: true });
    try {
      const [profile, subjects, phases, tasks] = await Promise.all([
        fetchExamProfile(),
        fetchExamSubjects(),
        fetchExamPhases(),
        fetchExamTasks(),
      ]);
      set({ profile, subjects, phases, tasks, loaded: true, lastError: '' });
    } catch (err) {
      console.error('[ExamStore] 数据库不可用:', err);
      const msg = err instanceof Error ? err.message : String(err);
      set({
        loaded: true,
        subjects: FALLBACK_SUBJECTS,
        lastError: `考试计划数据库加载失败：${msg}（可能需要重启应用完成数据迁移）`,
      });
    } finally {
      set({ loading: false });
    }
  },

  clearError: () => set({ lastError: '' }),

  getCloudSnapshot: () => {
    const s = get();
    if (!s.loaded || s.subjects.length === 0) return null;
    return { profile: s.profile, subjects: s.subjects, phases: s.phases, tasks: s.tasks };
  },

  backupToCloud: async () => {
    const snapshot = get().getCloudSnapshot();
    if (!snapshot) throw new Error('考研数据尚未加载');
    return saveExamToCloud(snapshot);
  },

  restoreFromCloud: async () => {
    const snapshot = await loadExamFromCloud();
    if (!isTauri()) {
      // 浏览器模式：仅恢复到内存
      set({ profile: snapshot.profile, subjects: snapshot.subjects, phases: snapshot.phases, tasks: snapshot.tasks, loaded: true, lastError: '' });
      return;
    }
    await replaceExamData(snapshot);
    await get().loadFromDb(true);
  },

  saveProfile: async (updates) => {
    const prev = get().profile;
    set({ profile: { ...prev, ...updates }, lastError: '' });
    if (!isTauri()) return;
    try { await dbUpdateProfile(updates); } catch (err) {
      console.error('[ExamStore] 保存考试设置失败:', err);
      set({ lastError: `保存设置失败：${err instanceof Error ? err.message : String(err)}` });
    }
  },

  addTask: async (input) => {
    const title = input.title.trim();
    if (!title || !input.subjectKey) return null;
    // 乐观插入：先上屏，再落库（浏览器模式下仅内存）
    const now = new Date().toISOString();
    const temp: ExamTask = {
      id: Date.now(),
      subjectKey: input.subjectKey,
      title,
      notes: input.notes || '',
      status: 'todo',
      planDate: input.planDate ?? null,
      startedDate: null,
      completedAt: null,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({ tasks: [...s.tasks, temp], lastError: '' }));

    if (!isTauri()) return temp;
    try {
      const task = await insertExamTask({ ...input, title });
      // 用真实记录替换临时项
      set((s) => ({ tasks: s.tasks.map(t => (t.id === temp.id ? task : t)) }));
      return task;
    } catch (err) {
      console.error('[ExamStore] 创建学习任务失败:', err);
      const msg = err instanceof Error ? err.message : String(err);
      set({ lastError: `创建任务失败（本条仅保存在内存）：${msg}` });
      return temp;
    }
  },

  addTasks: async (inputs) => {
    for (const input of inputs) {
      await get().addTask(input);
    }
  },

  updateExamTaskFields: async (id, patch) => {
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
    if (!isTauri()) return;
    try { await dbUpdateExamTask(id, patch); } catch { /* fallback */ }
  },

  deleteExamTaskById: async (id) => {
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
    if (!isTauri()) return;
    try { await dbDeleteExamTask(id); } catch { /* fallback */ }
  },

  setExamTaskStatus: async (id, status) => {
    const task = get().tasks.find((t) => t.id === id);
    if (!task || task.status === status) return;
    const now = new Date().toISOString();
    const patch: ExamTaskPatch = { status };
    if (status === 'done') {
      patch.completedAt = now;
    } else {
      patch.completedAt = null;
      if (status === 'doing') {
        const nextStart = task.startedDate || localDateStr();
        patch.startedDate = nextStart;
        // 截止（计划）日期早于生效开始日期时，自动顺延为开始日期
        if (task.planDate && task.planDate < nextStart) patch.planDate = nextStart;
      }
    }
    await get().updateExamTaskFields(id, patch);
  },

  editPhase: async (id, patch) => {
    set((s) => ({
      phases: s.phases.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
    if (!isTauri()) return;
    try { await dbUpdatePhase(id, patch); } catch { /* fallback */ }
  },
}));
