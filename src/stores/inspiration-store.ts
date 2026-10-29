import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Inspiration } from '../lib/types';
import {
  dbDeleteInspiration,
  dbFetchInspirations,
  dbInsertInspiration,
  dbUpdateInspiration,
} from '../lib/inspiration-db';

const STORAGE_KEY = 'easysail-exam-inspiration';

interface InspirationStore {
  inspirations: Inspiration[];
  loaded: boolean;

  load: () => Promise<void>;
  add: (content: string) => Promise<Inspiration | null>;
  update: (id: number, updates: Partial<Pick<Inspiration, 'content' | 'title' | 'polished' | 'tags'>>) => Promise<void>;
  remove: (id: number) => Promise<void>;
  replaceInspirations: (newInspirations: Inspiration[]) => void;
}

let localId = -1;

export const useInspirationStore = create<InspirationStore>()(
  persist(
    (set, get) => ({
      inspirations: [],
      loaded: false,

      /** 从 SQLite 加载；数据库不可用（纯浏览器 dev）时从 localStorage 缓存恢复 */
      load: async () => {
        if (get().loaded) return;
        try {
          const inspirations = await dbFetchInspirations();
          set({ inspirations, loaded: true });
        } catch (err) {
          console.warn('[Inspiration] 数据库不可用，使用本地缓存数据:', err);
          set({ loaded: true });
        }
      },

      add: async (content) => {
        const text = content.trim();
        if (!text) return null;
        const now = new Date().toISOString();
        try {
          const created = await dbInsertInspiration(text);
          set(s => ({ inspirations: [created, ...s.inspirations] }));
          return created;
        } catch {
          // 内存态降级（dev 环境无 SQLite）
          const fallback: Inspiration = {
            id: localId--,
            content: text,
            title: '',
            polished: '',
            tags: [],
            createdAt: now,
            updatedAt: now,
          };
          set(s => ({ inspirations: [fallback, ...s.inspirations] }));
          return fallback;
        }
      },

      update: async (id, updates) => {
        const now = new Date().toISOString();
        set(s => ({
          inspirations: s.inspirations.map(item =>
            item.id === id ? { ...item, ...updates, updatedAt: now } : item
          ),
        }));
        try {
          await dbUpdateInspiration(id, updates);
        } catch { /* 内存态忽略持久化失败 */ }
      },

      remove: async (id) => {
        set(s => ({ inspirations: s.inspirations.filter(item => item.id !== id) }));
        try {
          await dbDeleteInspiration(id);
        } catch { /* 内存态忽略持久化失败 */ }
      },

      /** 替换所有灵感（用于导入/云盘加载），同时规范化数据字段 */
      replaceInspirations: (newInspirations) => {
        const now = new Date().toISOString();
        const normalized: Inspiration[] = newInspirations.map(ins => ({
          id: ins.id,
          content: ins.content || '',
          title: ins.title || '',
          polished: ins.polished || '',
          tags: Array.isArray(ins.tags) ? ins.tags : [],
          createdAt: ins.createdAt || now,
          updatedAt: ins.updatedAt || now,
        }));
        set({ inspirations: normalized });
      },
    }),
    {
      name: STORAGE_KEY,
      partialize: (state) => ({ inspirations: state.inspirations }),
    }
  )
);
