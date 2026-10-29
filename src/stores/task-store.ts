import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Task, KanbanStatus, ViewMode, SectionId, RecurrenceRule } from '../lib/types';
import { dbFetchAll, dbInsert, dbUpdate, dbDelete } from '../lib/db';
import { localDateStr } from '../lib/utils';
import { initCloudSync, registerTaskGetter, registerInspirationGetter, registerExamGetter, registerExamVocabGetter } from '../lib/cloud';
import { useInspirationStore } from './inspiration-store';
import { useExamStore } from './exam-store';
import { useExamVocabStore } from './exam-vocab-store';
import { isTauri } from '../lib/tauri';

export type AccentColor = 'green' | 'blue' | 'purple' | 'orange' | 'pink' | 'red';
type KnownProjectId = 'project-work' | 'project-study' | 'project-life';

export interface CreateTaskInput {
  title: string;
  notes?: string;
  projectId?: KnownProjectId | string;
  dueDate?: string | null;
  tags?: string[];
  starred?: boolean;
  // —— 提醒通知 ——
  reminderAt?: string | null;
  reminderEnabled?: boolean;
  reminderText?: string | null;
  recurrence?: RecurrenceRule | null;
}

export const ACCENT_COLORS: { id: AccentColor; label: string; hex: string }[] = [
  { id: 'green',  label: '翠绿', hex: '#6cc788' },
  { id: 'blue',   label: '天蓝', hex: '#3B82F6' },
  { id: 'purple', label: '紫罗兰', hex: '#8B5CF6' },
  { id: 'orange', label: '暖橙', hex: '#F59E0B' },
  { id: 'pink',   label: '桃粉', hex: '#EC4899' },
  { id: 'red',    label: '中国红', hex: '#EF4444' },
];

const STORAGE_KEY = 'easysail-exam-storage';

interface TaskStore {
  tasks: Task[];
  currentView: ViewMode;
  currentSection: SectionId;
  detailTaskId: number | null;
  searchQuery: string;
  theme: 'light' | 'dark';
  accentColor: AccentColor;
  dbReady: boolean;
  calendarSelectedDate: string;
  viewOrder: ViewMode[];

  // 数据库操作
  loadFromDb: () => Promise<void>;
  replaceTasks: (tasks: Task[]) => void;
  addTask: (title: string, projectId?: string, dueDate?: string | null, reminder?: { reminderAt?: string | null; reminderEnabled?: boolean; recurrence?: RecurrenceRule | null }) => Promise<void>;
  createTask: (input: CreateTaskInput) => Promise<Task | null>;
  updateTask: (id: number, updates: Partial<Task>) => Promise<void>;
  deleteTask: (id: number) => Promise<void>;
  toggleTask: (id: number) => Promise<void>;
  setKanban: (id: number, status: KanbanStatus) => Promise<void>;
  startTask: (id: number) => Promise<void>;
  pauseTask: (id: number) => Promise<void>;
  toggleStar: (id: number) => Promise<void>;
  toggleTag: (id: number, tag: string) => Promise<void>;
  reorderTasks: (activeId: number, overId: number) => Promise<void>;
  applyTaskOrder: (orderedIds: number[]) => Promise<void>;

  setView: (view: ViewMode) => void;
  setSection: (section: SectionId) => void;
  setSearchQuery: (q: string) => void;
  openDetail: (id: number) => void;
  closeDetail: () => void;
  setTheme: (theme: 'light' | 'dark') => void;
  setAccentColor: (color: AccentColor) => void;
  setCalendarSelectedDate: (date: string) => void;
  setViewOrder: (order: ViewMode[]) => void;
}

/** 生成相对今天的日期字符串（YYYY-MM-DD，本地时区） */
function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localDateStr(d);
}

/** 生成相对今天的 ISO 时间字符串 */
function timeOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

const _created = timeOffset(-9);
const PROJECT_IDS = new Set(['project-work', 'project-study', 'project-life']);
const TAG_IDS = new Set(['tag-urgent', 'tag-important']);
const KANBAN_VALUES = new Set<KanbanStatus>(['todo', 'doing', 'done']);

/** 校验 kanban 值合法性，非法值回退 todo（防云同步/导入脏数据） */
function normalizeKanban(value: unknown): KanbanStatus {
  return KANBAN_VALUES.has(value as KanbanStatus) ? (value as KanbanStatus) : 'todo';
}

function normalizeCreateInput(input: CreateTaskInput): CreateTaskInput | null {
  const title = input.title.trim();
  if (!title) return null;
  const projectId = PROJECT_IDS.has(String(input.projectId)) ? String(input.projectId) : 'project-work';
  const dueDate = input.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) ? input.dueDate : null;
  const tags = Array.isArray(input.tags)
    ? [...new Set(input.tags.filter(tag => TAG_IDS.has(tag)))]
    : [];

  return {
    title,
    notes: input.notes?.trim() ?? '',
    projectId,
    dueDate,
    tags,
    starred: !!input.starred,
    reminderAt: input.reminderAt ?? null,
    reminderEnabled: !!input.reminderEnabled,
    reminderText: input.reminderText ?? null,
    recurrence: input.recurrence ?? null,
  };
}

const INITIAL_TASKS: Task[] = [
  { id: 1, title: '完成项目设计稿', notes: '需要完成首页、详情页、设置页的设计', projectId: 'project-work', kanban: 'todo', starred: true, completed: false, completedAt: null, dueDate: dayOffset(0), tags: ['tag-urgent', 'tag-important'], sortOrder: 0, createdAt: _created, updatedAt: _created, reminderAt: null, reminderEnabled: false, reminderText: null, recurrence: null, snoozedUntil: null, lastNotifiedAt: null, startDate: null },
  { id: 2, title: '回复客户邮件', notes: '', projectId: 'project-work', kanban: 'todo', starred: false, completed: false, completedAt: null, dueDate: dayOffset(0), tags: [], sortOrder: 1, createdAt: _created, updatedAt: _created, reminderAt: null, reminderEnabled: false, reminderText: null, recurrence: null, snoozedUntil: null, lastNotifiedAt: null, startDate: null },
  { id: 3, title: '准备周会汇报材料', notes: '', projectId: 'project-work', kanban: 'todo', starred: false, completed: false, completedAt: null, dueDate: dayOffset(0), tags: ['tag-important'], sortOrder: 2, createdAt: _created, updatedAt: _created, reminderAt: null, reminderEnabled: false, reminderText: null, recurrence: null, snoozedUntil: null, lastNotifiedAt: null, startDate: null },
  { id: 4, title: '学习 TypeScript 高级类型', notes: '看文档 + 练习', projectId: 'project-study', kanban: 'todo', starred: false, completed: false, completedAt: null, dueDate: dayOffset(1), tags: [], sortOrder: 3, createdAt: _created, updatedAt: _created, reminderAt: null, reminderEnabled: false, reminderText: null, recurrence: null, snoozedUntil: null, lastNotifiedAt: null, startDate: null },
  { id: 5, title: '阅读《代码整洁之道》', notes: '', projectId: 'project-study', kanban: 'todo', starred: false, completed: false, completedAt: null, dueDate: dayOffset(5), tags: [], sortOrder: 4, createdAt: _created, updatedAt: _created, reminderAt: null, reminderEnabled: false, reminderText: null, recurrence: null, snoozedUntil: null, lastNotifiedAt: null, startDate: null },
  { id: 6, title: '整理书桌', notes: '', projectId: 'project-life', kanban: 'done', starred: false, completed: true, completedAt: timeOffset(-1), dueDate: dayOffset(-1), tags: [], sortOrder: 5, createdAt: _created, updatedAt: timeOffset(-1), reminderAt: null, reminderEnabled: false, reminderText: null, recurrence: null, snoozedUntil: null, lastNotifiedAt: null, startDate: null },
  { id: 7, title: '预约牙医', notes: '', projectId: 'project-life', kanban: 'todo', starred: false, completed: false, completedAt: null, dueDate: dayOffset(0), tags: ['tag-urgent'], sortOrder: 6, createdAt: _created, updatedAt: _created, reminderAt: null, reminderEnabled: false, reminderText: null, recurrence: null, snoozedUntil: null, lastNotifiedAt: null, startDate: null },
  { id: 8, title: '更新简历', notes: '', projectId: 'project-study', kanban: 'todo', starred: false, completed: false, completedAt: null, dueDate: dayOffset(2), tags: [], sortOrder: 7, createdAt: _created, updatedAt: _created, reminderAt: null, reminderEnabled: false, reminderText: null, recurrence: null, snoozedUntil: null, lastNotifiedAt: null, startDate: null },
  { id: 9, title: '编写 API 文档', notes: '', projectId: 'project-work', kanban: 'todo', starred: false, completed: false, completedAt: null, dueDate: dayOffset(1), tags: ['tag-important'], sortOrder: 8, createdAt: _created, updatedAt: _created, reminderAt: null, reminderEnabled: false, reminderText: null, recurrence: null, snoozedUntil: null, lastNotifiedAt: null, startDate: null },
  { id: 10, title: '代码审查 - 用户模块', notes: '', projectId: 'project-work', kanban: 'todo', starred: true, completed: false, completedAt: null, dueDate: dayOffset(1), tags: [], sortOrder: 9, createdAt: _created, updatedAt: _created, reminderAt: null, reminderEnabled: false, reminderText: null, recurrence: null, snoozedUntil: null, lastNotifiedAt: null, startDate: null },
];

export const useTaskStore = create<TaskStore>()(
  persist(
    (set, get) => ({
      tasks: INITIAL_TASKS,
      currentView: 'calendar',
      currentSection: 'inbox',
      detailTaskId: null,
      searchQuery: '',
      theme: 'light',
      accentColor: 'green',
      dbReady: false,
      calendarSelectedDate: localDateStr(),
      viewOrder: ['calendar', 'kanban'] as ViewMode[],

      /** 从 SQLite 加载数据 */
      loadFromDb: async () => {
        try {
          const tasks = await dbFetchAll();
          set({ tasks, dbReady: true });
        } catch (err) {
          console.warn('[Store] 数据库不可用，使用本地缓存数据:', err);
          set({ dbReady: true });
        }
      },

      /** 替换所有任务（用于导入/云盘加载），同时规范化数据字段 */
      replaceTasks: (newTasks) => {
        const now = new Date().toISOString();
        const normalizeDate = (v: unknown): string | null => {
          if (!v) return null;
          const s = String(v);
          if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
          const sliced = s.slice(0, 10);
          if (/^\d{4}-\d{2}-\d{2}$/.test(sliced)) return sliced;
          const d = new Date(s);
          if (!isNaN(d.getTime())) return localDateStr(d);
          return null;
        };
        const normalized: Task[] = newTasks.map(t => ({
          id: t.id,
          title: t.title || '',
          notes: t.notes || '',
          projectId: t.projectId || 'project-work',
          kanban: normalizeKanban(t.kanban),
          starred: !!t.starred,
          completed: !!t.completed,
          completedAt: t.completedAt ?? null,
          dueDate: normalizeDate(t.dueDate),
          tags: Array.isArray(t.tags) ? t.tags : [],
          sortOrder: t.sortOrder || 0,
          createdAt: t.createdAt || now,
          updatedAt: t.updatedAt || now,
          // 提醒通知
          reminderAt: t.reminderAt ?? null,
          reminderEnabled: !!t.reminderEnabled,
          reminderText: t.reminderText ?? null,
          recurrence: t.recurrence ?? null,
          snoozedUntil: t.snoozedUntil ?? null,
          lastNotifiedAt: t.lastNotifiedAt ?? null,
          startDate: normalizeDate(t.startDate),
        }));
        set({ tasks: normalized });
      },

      addTask: async (title, projectId = 'project-work', dueDate, reminder) => {
        const finalDueDate = dueDate === undefined ? localDateStr() : dueDate;
        await get().createTask({
          title,
          projectId,
          dueDate: finalDueDate,
          ...(reminder?.reminderEnabled
            ? {
                reminderAt: reminder.reminderAt ?? null,
                reminderEnabled: true,
                recurrence: reminder.recurrence ?? null,
              }
            : {}),
        });
      },

      createTask: async (input) => {
        const normalized = normalizeCreateInput(input);
        if (!normalized) return null;
        const now = new Date().toISOString();
        const finalDueDate = normalized.dueDate ?? null;
        const reminderEnabled = !!input.reminderEnabled && !!input.reminderAt;
        let newTask: Task = {
          id: Date.now(),
          title: normalized.title,
          notes: normalized.notes || '',
          projectId: normalized.projectId || 'project-work',
          kanban: 'todo',
          starred: !!normalized.starred,
          completed: false,
          completedAt: null,
          dueDate: finalDueDate,
          tags: normalized.tags || [],
          sortOrder: 0,
          createdAt: now,
          updatedAt: now,
          // 提醒通知
          reminderAt: reminderEnabled ? (input.reminderAt ?? null) : null,
          reminderEnabled,
          reminderText: input.reminderText ?? null,
          recurrence: reminderEnabled ? (input.recurrence ?? null) : null,
          snoozedUntil: null,
          lastNotifiedAt: null,
          startDate: null,
        };

        try {
          newTask = await dbInsert(
            normalized.title,
            normalized.projectId,
            finalDueDate ?? undefined,
            newTask.reminderAt,
            newTask.reminderEnabled,
            newTask.reminderText,
            newTask.recurrence,
          );
          const patch: Partial<Task> = {};
          if (normalized.dueDate === null) patch.dueDate = null;
          if (normalized.notes) patch.notes = normalized.notes;
          if (normalized.tags?.length) patch.tags = normalized.tags;
          if (normalized.starred) patch.starred = normalized.starred;
          if (Object.keys(patch).length > 0) {
            await dbUpdate(newTask.id, patch);
            newTask = { ...newTask, ...patch, updatedAt: new Date().toISOString() };
          }
        } catch {
          // 数据库不可用时回退到内存
        }

        set((state) => ({ tasks: [newTask, ...state.tasks] }));
        return newTask;
      },

      updateTask: async (id, updates) => {
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === id ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t
          ),
        }));

        try { await dbUpdate(id, updates); } catch { /* fallback */ }
      },

      deleteTask: async (id) => {
        set((state) => ({
          tasks: state.tasks.filter((t) => t.id !== id),
          detailTaskId: state.detailTaskId === id ? null : state.detailTaskId,
        }));

        try { await dbDelete(id); } catch { /* fallback */ }
      },

      toggleTask: async (id) => {
        const now = new Date().toISOString();
        const task = get().tasks.find(t => t.id === id);
        if (!task) return;

        const updates = {
          completed: !task.completed,
          kanban: (!task.completed ? 'done' : 'todo') as KanbanStatus,
          completedAt: !task.completed ? now : null,
          updatedAt: now,
        };

        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === id ? { ...t, ...updates } : t
          ),
        }));

        try { await dbUpdate(id, updates); } catch { /* fallback */ }
      },

      /** 统一三态迁移：todo/doing/done，联动 completed/completedAt/startDate/dueDate。
       *  开始时若截止日期早于生效开始日期，自动顺延为开始日期（用户可再手动延长）。 */
      setKanban: async (id, status) => {
        const task = get().tasks.find(t => t.id === id);
        if (!task || task.kanban === status) return;
        const now = new Date().toISOString();
        const updates: Partial<Task> = { kanban: status, updatedAt: now };
        if (status === 'done') {
          updates.completed = true;
          updates.completedAt = now;
        } else {
          updates.completed = false;
          updates.completedAt = null;
          if (status === 'doing') {
            const nextStart = task.startDate || localDateStr();
            updates.startDate = nextStart; // 重复开始则覆盖为最近一次
            if (task.dueDate && task.dueDate < nextStart) updates.dueDate = nextStart;
          }
        }

        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === id ? { ...t, ...updates } : t
          ),
        }));

        try { await dbUpdate(id, updates); } catch { /* fallback */ }
      },

      startTask: async (id) => {
        const task = get().tasks.find(t => t.id === id);
        if (!task || task.completed) return;
        await get().setKanban(id, 'doing');
      },

      pauseTask: async (id) => {
        await get().setKanban(id, 'todo');
      },

      toggleStar: async (id) => {
        const task = get().tasks.find(t => t.id === id);
        if (!task) return;
        const updates = { starred: !task.starred, updatedAt: new Date().toISOString() };

        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === id ? { ...t, ...updates } : t
          ),
        }));

        try { await dbUpdate(id, updates); } catch { /* fallback */ }
      },

      toggleTag: async (id, tag) => {
        const task = get().tasks.find(t => t.id === id);
        if (!task) return;
        const newTags = task.tags.includes(tag)
          ? task.tags.filter(x => x !== tag)
          : [...task.tags, tag];
        const updates = { tags: newTags, updatedAt: new Date().toISOString() };

        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === id ? { ...t, ...updates } : t
          ),
        }));

        try { await dbUpdate(id, updates); } catch { /* fallback */ }
      },

      reorderTasks: async (activeId, overId) => {
        // 记录原始 sortOrder，set 后只写变化项
        const oldOrder = new Map(get().tasks.map(t => [t.id, t.sortOrder]));
        set((state) => {
          const tasks = [...state.tasks];
          const activeIdx = tasks.findIndex((t) => t.id === activeId);
          const overIdx = tasks.findIndex((t) => t.id === overId);
          if (activeIdx === -1 || overIdx === -1) return state;
          const [moved] = tasks.splice(activeIdx, 1);
          tasks.splice(overIdx, 0, moved);
          return { tasks: tasks.map((t, i) => ({ ...t, sortOrder: i })) };
        });
        // 持久化：只写 sortOrder 变化的任务
        const changed = get().tasks.filter(t => oldOrder.get(t.id) !== t.sortOrder);
        await Promise.allSettled(changed.map(t => dbUpdate(t.id, { sortOrder: t.sortOrder })));
      },

      applyTaskOrder: async (orderedIds) => {
        const orderMap = new Map(orderedIds.map((id, index) => [id, index]));
        const oldOrder = new Map(get().tasks.map(t => [t.id, t.sortOrder]));
        set((state) => ({
          tasks: state.tasks.map((task) => (
            orderMap.has(task.id) ? { ...task, sortOrder: orderMap.get(task.id)! } : task
          )),
        }));
        // 只写变化项，并发写入
        const changed = orderedIds.filter(id => oldOrder.get(id) !== orderMap.get(id));
        await Promise.allSettled(changed.map(id => dbUpdate(id, { sortOrder: orderMap.get(id)! })));
      },

      setView: (view) => set({ currentView: view, detailTaskId: null }),
      setSection: (section) => {
        const prev = useTaskStore.getState();
        set({
          currentSection: section,
          currentView: section === 'ai' ? 'ai' : (prev.currentView === 'ai' ? 'calendar' : prev.currentView),
          detailTaskId: null,
        });
      },
      setSearchQuery: (q) => set({ searchQuery: q }),
      openDetail: (id) => set({ detailTaskId: id }),
      closeDetail: () => set({ detailTaskId: null }),
      setTheme: (theme) => {
        document.documentElement.setAttribute('data-theme', theme);
        set({ theme });
      },
      setAccentColor: (color) => {
        document.documentElement.setAttribute('data-accent', color);
        set({ accentColor: color });
      },
      setCalendarSelectedDate: (date) => set({ calendarSelectedDate: date }),
      setViewOrder: (order) => set({ viewOrder: order }),
    }),
    {
      name: STORAGE_KEY,
      partialize: (state) => ({
        theme: state.theme,
        accentColor: state.accentColor,
        tasks: state.tasks,
        viewOrder: state.viewOrder,
      }),
    }
  )
);

// ============ 初始化：加载数据库 + 云盘同步 + 恢复主题 + 自启动 + 通知引擎 ============
(async () => {
  const store = useTaskStore.getState();
  document.documentElement.setAttribute('data-accent', store.accentColor);
  await store.loadFromDb();
  initCloudSync();
  registerTaskGetter(() => useTaskStore.getState().tasks);
  registerInspirationGetter(() => useInspirationStore.getState().inspirations);
  // 考研计划快照：仅在数据已加载（用户进入过考研专区）时参与自动同步
  registerExamGetter(() => useExamStore.getState().getCloudSnapshot());
  // 背单词快照：需查库故为异步；用户进入过背单词页后才参与自动同步
  registerExamVocabGetter(() => useExamVocabStore.getState().getCloudSnapshot());
  // 默认开启开机自启动（仅 Tauri 环境）
  if (isTauri()) {
    try {
      const { isEnabled, enable } = await import('@tauri-apps/plugin-autostart');
      const enabled = await isEnabled();
      if (!enabled) await enable();
    } catch { /* fallback */ }
    // 启动提醒通知引擎（仅 Tauri 环境）
    try {
      const { startReminderEngine } = await import('../lib/notification-engine');
      await startReminderEngine();
    } catch { /* fallback */ }
  }
})();
