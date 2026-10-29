/**
 * 通知历史 Store
 *
 * 记录已触发的提醒通知，支持稍后提醒、关闭、清空。
 * 持久化到 localStorage，保留最近 100 条。
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** 通知来源（健康提醒已移除，历史持久化数据中可能残留 'water' / 'sedentary'） */
export type ReminderSource = 'task';

export interface ReminderRecord {
  id: string;
  /** 未关联任务的通知，taskId 为空 */
  taskId?: number;
  taskTitle: string;
  triggeredAt: string;  // ISO 时间
  snoozed: boolean;     // 是否被 snooze 过
  dismissed: boolean;   // 是否已关闭
  read: boolean;        // 是否已读
  source: ReminderSource;
}

interface ReminderHistoryStore {
  records: ReminderRecord[];
  addRecord: (input: { taskId?: number; taskTitle: string; triggeredAt: string }) => void;
  snoozeRecord: (id: string) => void;
  dismissRecord: (id: string) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clearAll: () => void;
  clearByTask: (taskId: number) => void;
}

const MAX_RECORDS = 100;
const STORAGE_KEY = 'easysail-exam-reminder-history';

export const useReminderHistoryStore = create<ReminderHistoryStore>()(
  persist(
    (set) => ({
      records: [],

      addRecord: ({ taskId, taskTitle, triggeredAt }) =>
        set((state) => {
          const record: ReminderRecord = {
            id: `${taskId ?? 'task'}-${Date.now()}`,
            taskId,
            taskTitle,
            triggeredAt,
            snoozed: false,
            dismissed: false,
            read: false,
            source: 'task',
          };
          const next = [record, ...state.records].slice(0, MAX_RECORDS);
          return { records: next };
        }),

      snoozeRecord: (id) =>
        set((state) => ({
          records: state.records.map((r) =>
            r.id === id ? { ...r, snoozed: true } : r
          ),
        })),

      dismissRecord: (id) =>
        set((state) => ({
          records: state.records.map((r) =>
            r.id === id ? { ...r, dismissed: true, read: true } : r
          ),
        })),

      markRead: (id) =>
        set((state) => ({
          records: state.records.map((r) =>
            r.id === id ? { ...r, read: true } : r
          ),
        })),

      markAllRead: () =>
        set((state) => ({
          records: state.records.map((r) => ({ ...r, read: true })),
        })),

      clearAll: () => set({ records: [] }),

      clearByTask: (taskId) =>
        set((state) => ({
          records: state.records.filter((r) => r.taskId !== taskId),
        })),
    }),
    {
      name: STORAGE_KEY,
      /** 迁移：丢弃已移除的健康提醒历史（旧数据 source 为 water / sedentary） */
      merge: (persisted, current) => {
        const p = persisted as Partial<ReminderHistoryStore> | undefined;
        const records = (p?.records ?? []).filter((r) => {
          const source = (r as { source?: string }).source;
          return source !== 'water' && source !== 'sedentary';
        });
        return { ...current, ...p, records };
      },
    }
  )
);

/** 未读通知数量（selector hook 用） */
export function useUnreadReminderCount(): number {
  return useReminderHistoryStore((s) => s.records.filter((r) => !r.read && !r.dismissed).length);
}
