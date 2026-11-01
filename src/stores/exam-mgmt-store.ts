/**
 * 199 管综刷题状态。
 *
 * 只负责题库/配置/错题/统计与云快照；作答会话由页面本地状态管理，
 * 因为会话包含大量高频计时状态，放进全局 store 会造成无意义重渲染。
 */
import { create } from 'zustand'
import { fetchExamProfile } from '../lib/exam-db'
import { loadExamMgmtFromCloud, saveExamMgmtToCloud } from '../lib/cloud'
import {
  fetchAttemptedQuestionIds,
  fetchCompletedSetYears,
  fetchMgmtProfile,
  fetchMgmtQuestions,
  fetchMgmtStats,
  fetchMgmtWrongbook,
  getExamMgmtCloudSnapshot,
  importMgmtBank,
  replaceExamMgmtData,
  updateMgmtProfile,
} from '../lib/exam-mgmt-db'
import type {
  MgmtProfile,
  MgmtQuestion,
  MgmtSnapshot,
  MgmtStats,
  MgmtSubject,
  MgmtWrongItem,
} from '../lib/exam-mgmt-db'
import { isTauri } from '../lib/tauri'

const DEFAULT_PROFILE: MgmtProfile = {
  mathSeconds: 3600,
  logicSeconds: 3300,
  slotHint: true,
  bankVersion: 0,
}

interface ExamMgmtStore {
  loaded: boolean
  loading: boolean
  lastError: string
  questions: MgmtQuestion[]
  profile: MgmtProfile
  examDate: string | null
  wrongbook: MgmtWrongItem[]
  stats: Record<MgmtSubject, MgmtStats | null>
  completedSetYears: Record<MgmtSubject, number[]>
  attemptedIds: Record<MgmtSubject, number[]>
  mgmtDirty: boolean

  loadFromDb: (force?: boolean) => Promise<void>
  clearError: () => void
  markDirty: () => void
  refreshWrongbook: () => Promise<void>
  refreshStats: (subject: MgmtSubject) => Promise<void>
  refreshProgress: (subject: MgmtSubject) => Promise<void>
  saveProfile: (updates: Partial<MgmtProfile>) => Promise<void>
  reimportBank: () => Promise<{ imported: boolean; questions: number }>
  getCloudSnapshot: () => Promise<MgmtSnapshot | null>
  backupToCloud: () => Promise<{ path: string; count: number }>
  restoreFromCloud: () => Promise<{ restored: boolean; message: string }>
}

export const useExamMgmtStore = create<ExamMgmtStore>()((set, get) => ({
  loaded: false,
  loading: false,
  lastError: '',
  questions: [],
  profile: { ...DEFAULT_PROFILE },
  examDate: null,
  wrongbook: [],
  stats: { math: null, logic: null },
  completedSetYears: { math: [], logic: [] },
  attemptedIds: { math: [], logic: [] },
  mgmtDirty: false,

  loadFromDb: async (force = false) => {
    if (get().loading) return
    if (!force && get().loaded) return
    if (!isTauri()) {
      set({ loaded: true, lastError: '浏览器模式不支持管综刷题，请使用桌面端' })
      return
    }
    set({ loading: true })
    try {
      const imported = await importMgmtBank()
      const [
        questions, profile, exam, mathWrong, logicWrong, mathStats, logicStats,
        mathSets, logicSets, mathIds, logicIds,
      ] = await Promise.all([
        fetchMgmtQuestions(),
        fetchMgmtProfile(),
        fetchExamProfile(),
        fetchMgmtWrongbook('math'),
        fetchMgmtWrongbook('logic'),
        fetchMgmtStats('math'),
        fetchMgmtStats('logic'),
        fetchCompletedSetYears('math'),
        fetchCompletedSetYears('logic'),
        fetchAttemptedQuestionIds('math'),
        fetchAttemptedQuestionIds('logic'),
      ])
      set({
        questions,
        profile,
        examDate: exam.examDate,
        wrongbook: [...mathWrong, ...logicWrong],
        stats: { math: mathStats, logic: logicStats },
        completedSetYears: { math: mathSets, logic: logicSets },
        attemptedIds: { math: mathIds, logic: logicIds },
        loaded: true,
        lastError: imported.questions > 0 ? '' : '题库为空，请先运行 npm run build:mgmt',
        mgmtDirty: false,
      })
    } catch (err) {
      set({
        loaded: true,
        lastError: `管综题库加载失败：${err instanceof Error ? err.message : String(err)}（如刚更新版本，请重启应用完成迁移）`,
      })
    } finally {
      set({ loading: false })
    }
  },

  clearError: () => set({ lastError: '' }),

  markDirty: () => set({ mgmtDirty: true }),

  refreshWrongbook: async () => {
    if (!isTauri()) return
    try {
      const [math, logic] = await Promise.all([fetchMgmtWrongbook('math'), fetchMgmtWrongbook('logic')])
      set({ wrongbook: [...math, ...logic] })
    } catch (err) {
      set({ lastError: `错题本刷新失败：${err instanceof Error ? err.message : String(err)}` })
    }
  },

  refreshStats: async (subject) => {
    if (!isTauri()) return
    try {
      const stats = await fetchMgmtStats(subject)
      set((state) => ({ stats: { ...state.stats, [subject]: stats } }))
    } catch (err) {
      set({ lastError: `统计刷新失败：${err instanceof Error ? err.message : String(err)}` })
    }
  },

  refreshProgress: async (subject) => {
    if (!isTauri()) return
    try {
      const [years, ids] = await Promise.all([
        fetchCompletedSetYears(subject),
        fetchAttemptedQuestionIds(subject),
      ])
      set((state) => ({
        completedSetYears: { ...state.completedSetYears, [subject]: years },
        attemptedIds: { ...state.attemptedIds, [subject]: ids },
      }))
    } catch {
      // 进度刷新失败不阻塞复盘
    }
  },

  saveProfile: async (updates) => {
    const prev = get().profile
    set({ profile: { ...prev, ...updates }, lastError: '', mgmtDirty: true })
    if (!isTauri()) return
    try {
      await updateMgmtProfile(updates)
    } catch (err) {
      set({
        profile: prev,
        lastError: `保存刷题设置失败：${err instanceof Error ? err.message : String(err)}`,
      })
    }
  },

  reimportBank: async () => {
    const result = await importMgmtBank(true)
    const questions = await fetchMgmtQuestions()
    set({ questions, mgmtDirty: false })
    return result
  },

  getCloudSnapshot: async () => {
    // 从未进过刷题页或题库为空时不参与自动同步，避免覆盖云端有效数据
    if (!isTauri() || !get().loaded || get().questions.length === 0) return null
    if (!get().mgmtDirty) return null
    try {
      const snapshot = await getExamMgmtCloudSnapshot()
      set({ mgmtDirty: false })
      return snapshot
    } catch {
      return null
    }
  },

  backupToCloud: async () => {
    const snapshot = await getExamMgmtCloudSnapshot()
    const result = await saveExamMgmtToCloud(snapshot)
    set({ mgmtDirty: false })
    return result
  },

  restoreFromCloud: async () => {
    const snapshot = await loadExamMgmtFromCloud()
    if (!snapshot) return { restored: false, message: '云盘暂无管综刷题数据，请先点击「备份到云盘」上传' }
    if (!isTauri()) return { restored: false, message: '浏览器模式不支持恢复管综题库' }
    const result = await replaceExamMgmtData(snapshot)
    await get().loadFromDb(true)
    set({ mgmtDirty: false })
    return {
      restored: true,
      message: `已从云盘恢复（${snapshot.sessions.length} 次练习、${snapshot.wrongbook.length} 条错题${result.skipped ? `，${result.skipped} 条因题库版本不一致被忽略` : ''}）`,
    }
  },
}))
