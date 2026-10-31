/**
 * 英语二阅读刷题状态。
 *
 * 只负责题库/配置/错题/统计与云快照；作答会话由页面本地状态管理，
 * 因为会话包含大量高频计时状态，放进全局 store 会造成无意义重渲染。
 */
import { create } from 'zustand'
import { fetchExamProfile } from '../lib/exam-db'
import { loadExamReadingFromCloud, saveExamReadingToCloud } from '../lib/cloud'
import {
  fetchCompletedPassageKeys,
  fetchCompletedSetYears,
  fetchReadingBank,
  fetchReadingProfile,
  fetchReadingStats,
  fetchReadingWrongbook,
  getExamReadingCloudSnapshot,
  importReadingBank,
  replaceExamReadingData,
  updateReadingProfile,
} from '../lib/exam-reading-db'
import type {
  ReadingBankSnapshot,
  ReadingPassageWithQuestions,
  ReadingProfile,
  ReadingStats,
  ReadingWrongItem,
} from '../lib/exam-reading-db'
import { isTauri } from '../lib/tauri'

const DEFAULT_PROFILE: ReadingProfile = {
  closeSeconds: 0,
  timedSeconds: 1080,
  setSeconds: 4200,
  examSlotStart: '14:00',
  examSlotEnd: '17:00',
  slotHint: true,
  mockYears: [],
  bankVersion: 0,
}

interface ExamReadingStore {
  loaded: boolean
  loading: boolean
  lastError: string
  passages: ReadingPassageWithQuestions[]
  profile: ReadingProfile
  examDate: string | null
  wrongbook: ReadingWrongItem[]
  stats: ReadingStats | null
  completedPassageKeys: string[]
  completedSetYears: number[]
  readingDirty: boolean

  loadFromDb: (force?: boolean) => Promise<void>
  clearError: () => void
  markDirty: () => void
  refreshWrongbook: () => Promise<void>
  refreshStats: () => Promise<void>
  refreshProgress: () => Promise<void>
  saveProfile: (updates: Partial<ReadingProfile>) => Promise<void>
  reimportBank: () => Promise<{ imported: boolean; passages: number; questions: number }>
  getCloudSnapshot: () => Promise<ReadingBankSnapshot | null>
  backupToCloud: () => Promise<{ path: string; count: number }>
  restoreFromCloud: () => Promise<{ restored: boolean; message: string }>
}

export const useExamReadingStore = create<ExamReadingStore>()((set, get) => ({
  loaded: false,
  loading: false,
  lastError: '',
  passages: [],
  profile: { ...DEFAULT_PROFILE },
  examDate: null,
  wrongbook: [],
  stats: null,
  completedPassageKeys: [],
  completedSetYears: [],
  readingDirty: false,

  loadFromDb: async (force = false) => {
    if (get().loading) return
    if (!force && get().loaded) return
    if (!isTauri()) {
      set({ loaded: true, lastError: '浏览器模式不支持阅读题库，请使用桌面端' })
      return
    }
    set({ loading: true })
    try {
      const imported = await importReadingBank()
      const [passages, profile, exam, wrongbook, stats, completedPassageKeys, completedSetYears] = await Promise.all([
        fetchReadingBank(),
        fetchReadingProfile(),
        fetchExamProfile(),
        fetchReadingWrongbook(),
        fetchReadingStats(),
        fetchCompletedPassageKeys(),
        fetchCompletedSetYears(),
      ])
      set({
        passages,
        profile,
        examDate: exam.examDate,
        wrongbook,
        stats,
        completedPassageKeys,
        completedSetYears,
        loaded: true,
        lastError: imported.passages > 0 ? '' : '题库为空，请先运行 npm run build:reading',
        readingDirty: false,
      })
    } catch (err) {
      set({
        loaded: true,
        lastError: `阅读题库加载失败：${err instanceof Error ? err.message : String(err)}（如刚更新版本，请重启应用完成迁移）`,
      })
    } finally {
      set({ loading: false })
    }
  },

  clearError: () => set({ lastError: '' }),

  markDirty: () => set({ readingDirty: true }),

  refreshWrongbook: async () => {
    if (!isTauri()) return
    try {
      set({ wrongbook: await fetchReadingWrongbook() })
    } catch (err) {
      set({ lastError: `错题本刷新失败：${err instanceof Error ? err.message : String(err)}` })
    }
  },

  refreshStats: async () => {
    if (!isTauri()) return
    try {
      set({ stats: await fetchReadingStats() })
    } catch (err) {
      set({ lastError: `统计刷新失败：${err instanceof Error ? err.message : String(err)}` })
    }
  },

  refreshProgress: async () => {
    if (!isTauri()) return
    try {
      const [completedPassageKeys, completedSetYears] = await Promise.all([
        fetchCompletedPassageKeys(),
        fetchCompletedSetYears(),
      ])
      set({ completedPassageKeys, completedSetYears })
    } catch {
      // 进度刷新失败不阻塞复盘
    }
  },

  saveProfile: async (updates) => {
    const prev = get().profile
    set({ profile: { ...prev, ...updates }, lastError: '', readingDirty: true })
    if (!isTauri()) return
    try {
      await updateReadingProfile(updates)
    } catch (err) {
      set({
        profile: prev,
        lastError: `保存阅读设置失败：${err instanceof Error ? err.message : String(err)}`,
      })
    }
  },

  reimportBank: async () => {
    const result = await importReadingBank(true)
    const passages = await fetchReadingBank()
    set({ passages, readingDirty: false })
    return result
  },

  getCloudSnapshot: async () => {
    // 从未进过阅读页或题库为空时不参与自动同步，避免覆盖云端有效数据
    if (!isTauri() || !get().loaded || get().passages.length === 0) return null
    if (!get().readingDirty) return null
    try {
      const snapshot = await getExamReadingCloudSnapshot()
      set({ readingDirty: false })
      return snapshot
    } catch {
      return null
    }
  },

  backupToCloud: async () => {
    const snapshot = await getExamReadingCloudSnapshot()
    const result = await saveExamReadingToCloud(snapshot)
    set({ readingDirty: false })
    return result
  },

  restoreFromCloud: async () => {
    const snapshot = await loadExamReadingFromCloud()
    if (!snapshot) return { restored: false, message: '云盘暂无阅读数据，请先点击「备份到云盘」上传' }
    if (!isTauri()) {
      return { restored: false, message: '浏览器模式不支持恢复阅读题库' }
    }
    const result = await replaceExamReadingData(snapshot)
    await get().loadFromDb(true)
    set({ readingDirty: false })
    return {
      restored: true,
      message: `已从云盘恢复（${snapshot.sessions.length} 次练习、${snapshot.wrongbook.length} 条错题${result.skipped ? `，${result.skipped} 条因题库版本不一致被忽略` : ''}）`,
    }
  },
}))
