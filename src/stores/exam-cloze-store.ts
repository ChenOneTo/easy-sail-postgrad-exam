/**
 * 英语二完形填空状态。
 *
 * 只负责题库/配置/错题/统计与云快照；作答会话由页面本地状态管理，
 * 因为会话包含高频计时状态，放进全局 store 会造成无意义重渲染。
 */
import { create } from 'zustand'
import { fetchExamProfile } from '../lib/exam-db'
import { loadExamClozeFromCloud, saveExamClozeToCloud } from '../lib/cloud'
import {
  fetchClozeBank,
  fetchClozeProfile,
  fetchClozeStats,
  fetchClozeWrongbook,
  fetchCompletedClozeKeys,
  getExamClozeCloudSnapshot,
  importClozeBank,
  replaceClozeData,
  updateClozeProfile,
} from '../lib/exam-cloze-db'
import type {
  ClozeBankSnapshot,
  ClozePassageWithQuestions,
  ClozeProfile,
  ClozeStats,
  ClozeWrongItem,
} from '../lib/exam-cloze-db'
import { isTauri } from '../lib/tauri'

const DEFAULT_PROFILE: ClozeProfile = {
  timedSeconds: 900,
  examSlotStart: '14:00',
  examSlotEnd: '17:00',
  slotHint: true,
  bankVersion: 0,
}

interface ExamClozeStore {
  loaded: boolean
  loading: boolean
  lastError: string
  passages: ClozePassageWithQuestions[]
  profile: ClozeProfile
  examDate: string | null
  wrongbook: ClozeWrongItem[]
  stats: ClozeStats | null
  completedKeys: string[]
  clozeDirty: boolean

  loadFromDb: (force?: boolean) => Promise<void>
  clearError: () => void
  markDirty: () => void
  refreshWrongbook: () => Promise<void>
  refreshStats: () => Promise<void>
  refreshProgress: () => Promise<void>
  saveProfile: (updates: Partial<ClozeProfile>) => Promise<void>
  reimportBank: () => Promise<{ imported: boolean; passages: number; questions: number }>
  getCloudSnapshot: () => Promise<ClozeBankSnapshot | null>
  backupToCloud: () => Promise<{ path: string; count: number }>
  restoreFromCloud: () => Promise<{ restored: boolean; message: string }>
}

export const useExamClozeStore = create<ExamClozeStore>()((set, get) => ({
  loaded: false,
  loading: false,
  lastError: '',
  passages: [],
  profile: { ...DEFAULT_PROFILE },
  examDate: null,
  wrongbook: [],
  stats: null,
  completedKeys: [],
  clozeDirty: false,

  loadFromDb: async (force = false) => {
    if (get().loading) return
    if (!force && get().loaded) return
    if (!isTauri()) {
      set({ loaded: true, lastError: '浏览器模式不支持完形题库，请使用桌面端' })
      return
    }
    set({ loading: true })
    try {
      const imported = await importClozeBank()
      const [passages, profile, exam, wrongbook, stats, completedKeys] = await Promise.all([
        fetchClozeBank(),
        fetchClozeProfile(),
        fetchExamProfile(),
        fetchClozeWrongbook(),
        fetchClozeStats(),
        fetchCompletedClozeKeys(),
      ])
      set({
        passages,
        profile,
        examDate: exam.examDate,
        wrongbook,
        stats,
        completedKeys,
        loaded: true,
        lastError: imported.passages > 0 ? '' : '题库为空，请先运行 npm run build:cloze',
        clozeDirty: false,
      })
    } catch (err) {
      set({
        loaded: true,
        lastError: `完形题库加载失败：${err instanceof Error ? err.message : String(err)}（如刚更新版本，请重启应用完成迁移）`,
      })
    } finally {
      set({ loading: false })
    }
  },

  clearError: () => set({ lastError: '' }),

  markDirty: () => set({ clozeDirty: true }),

  refreshWrongbook: async () => {
    if (!isTauri()) return
    try {
      set({ wrongbook: await fetchClozeWrongbook() })
    } catch (err) {
      set({ lastError: `错题本刷新失败：${err instanceof Error ? err.message : String(err)}` })
    }
  },

  refreshStats: async () => {
    if (!isTauri()) return
    try {
      set({ stats: await fetchClozeStats() })
    } catch (err) {
      set({ lastError: `统计刷新失败：${err instanceof Error ? err.message : String(err)}` })
    }
  },

  refreshProgress: async () => {
    if (!isTauri()) return
    try {
      set({ completedKeys: await fetchCompletedClozeKeys() })
    } catch {
      // 进度刷新失败不阻塞复盘
    }
  },

  saveProfile: async (updates) => {
    const prev = get().profile
    set({ profile: { ...prev, ...updates }, lastError: '', clozeDirty: true })
    if (!isTauri()) return
    try {
      await updateClozeProfile(updates)
    } catch (err) {
      set({
        profile: prev,
        lastError: `保存完形设置失败：${err instanceof Error ? err.message : String(err)}`,
      })
    }
  },

  reimportBank: async () => {
    const result = await importClozeBank(true)
    const passages = await fetchClozeBank()
    set({ passages, clozeDirty: false })
    return result
  },

  getCloudSnapshot: async () => {
    if (!isTauri() || !get().loaded || get().passages.length === 0) return null
    if (!get().clozeDirty) return null
    try {
      const snapshot = await getExamClozeCloudSnapshot()
      set({ clozeDirty: false })
      return snapshot
    } catch {
      return null
    }
  },

  backupToCloud: async () => {
    const snapshot = await getExamClozeCloudSnapshot()
    const result = await saveExamClozeToCloud(snapshot)
    set({ clozeDirty: false })
    return result
  },

  restoreFromCloud: async () => {
    const snapshot = await loadExamClozeFromCloud()
    if (!snapshot) return { restored: false, message: '云盘暂无完形数据，请先点击「备份到云盘」上传' }
    if (!isTauri()) {
      return { restored: false, message: '浏览器模式不支持恢复完形题库' }
    }
    const result = await replaceClozeData(snapshot)
    await get().loadFromDb(true)
    set({ clozeDirty: false })
    return {
      restored: true,
      message: `已从云盘恢复（${snapshot.sessions.length} 次练习、${snapshot.wrongbook.length} 条错题${result.skipped ? `，${result.skipped} 条因题库版本不一致被忽略` : ''}）`,
    }
  },
}))
