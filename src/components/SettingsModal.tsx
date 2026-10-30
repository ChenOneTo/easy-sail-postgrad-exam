import { useRef, useState, useEffect } from 'react';
import { Sun, Moon, Settings, Palette, Cloud, Database, Bot, Plus, Trash2, Check, Pencil, Info } from 'lucide-react';
import { useTaskStore, ACCENT_COLORS } from '../stores/task-store';
import { useExamStore } from '../stores/exam-store';
import { useExamVocabStore } from '../stores/exam-vocab-store';
import { useVocabGameStore } from '../stores/vocab-game-store';
import { dbReplaceAll } from '../lib/db';
import { getExamVocabCloudSnapshot } from '../lib/exam-vocab-db';
import {
  getCloudDir, pickCloudDir, setCloudDir, saveToCloud, loadFromCloud,
  saveExamToCloud, saveExamVocabToCloud,
  getAutoSave, setAutoSave, getAutoInterval, setAutoInterval,
} from '../lib/cloud';
import {
  getAiModels, getActiveModelId, addAiModel, updateAiModel, removeAiModel,
  setActiveModelId, testAiConnection, listModels, baseUrlSupportsModels, AI_PRESETS,
  isAiEnabled, setAiEnabled,
} from '../lib/ai';
import type { AiModelConfig, ModelInfo } from '../lib/ai';
import { isTauri } from '../lib/tauri';
import { TASK_TYPES, TAG_MAP } from '../lib/types';
import { useAiTask } from '../hooks/useAiTask';
import type { AiClassifyDraft } from '../lib/ai-json';
import { getSplashMode, setSplashMode, SPLASH_MODE_OPTIONS } from '../lib/splash';
import type { SplashMode } from '../lib/splash';
import { isDailyQuoteEnabled, setDailyQuoteEnabled } from '../lib/daily-quote';
import { checkAndInstallUpdate } from '../lib/updater';
import authorQrCode from '../assets/AuthorQRCode.png';

type SettingsTab = 'general' | 'appearance' | 'cloud' | 'data' | 'ai' | 'about';
const TABS: { key: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { key: 'general', label: '通用', icon: <Settings size={16} /> },
  { key: 'appearance', label: '外观', icon: <Palette size={16} /> },
  { key: 'cloud', label: '云盘同步', icon: <Cloud size={16} /> },
  { key: 'ai', label: '大模型设置', icon: <Bot size={16} /> },
  { key: 'data', label: '数据管理', icon: <Database size={16} /> },
  { key: 'about', label: '关于', icon: <Info size={16} /> },
];

/** 错误信息转文本 */
function errText(err: unknown): string {
  return err instanceof Error ? err.message : '未知错误';
}

/** 汇总手动同步结果：已保存 / 已跳过 / 失败 */
function formatSyncMsg(prefix: string, saved: string[], skipped: string[], failed: string[]): string {
  const parts: string[] = [];
  if (saved.length) parts.push(`${prefix}：${saved.join('、')}`);
  if (skipped.length) parts.push(`已跳过 ${skipped.join('、')}`);
  if (failed.length) parts.push(`失败 ${failed.join('；')}`);
  return parts.join('；') || '没有可同步的数据';
}

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { theme, setTheme, accentColor, setAccentColor, tasks, updateTask } = useTaskStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState('');
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [appVersion, setAppVersion] = useState<string>(() => {
    // 非 Tauri 环境直接使用环境变量，避免在 effect 中同步 setState
    if (!isTauri()) return import.meta.env.VITE_APP_VERSION || '';
    return '';
  });
  const [splashMode, setSplashModeState] = useState<SplashMode>(getSplashMode);
  const [dailyQuoteOn, setDailyQuoteOn] = useState(isDailyQuoteEnabled);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateMsg, setUpdateMsg] = useState('');

  // 云盘同步状态
  const [cloudDir, setCloudDirState] = useState(getCloudDir);
  const [autoSave, setAutoSaveState] = useState(getAutoSave);
  const [autoInterval, setAutoIntervalState] = useState(getAutoInterval);
  const [cloudMsg, setCloudMsg] = useState('');
  const [pickingDir, setPickingDir] = useState(false);

  // 大模型设置配置状态
  const [aiModels, setAiModelsState] = useState<AiModelConfig[]>(getAiModels);
  const [activeId, setActiveIdState] = useState<string | null>(getActiveModelId);
  const [aiMsg, setAiMsg] = useState('');
  const [aiTesting, setAiTesting] = useState(false);
  const [modelList, setModelList] = useState<ModelInfo[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [aiEnabled, setAiEnabledState] = useState(isAiEnabled);
  const [classifyPreview, setClassifyPreview] = useState<AiClassifyDraft | null>(null);

  const aiTask = useAiTask();

  // 模型编辑弹窗状态（新增/编辑共用）
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [modalId, setModalId] = useState<string | null>(null);
  const [modalForm, setModalForm] = useState<AiModelConfig>({
    id: '', name: '', apiKey: '', baseUrl: '', model: '',
  });

  // 当前弹窗表单的 Base URL 是否支持获取模型列表
  const canFetchModels = baseUrlSupportsModels(modalForm.baseUrl);

  // 开机自启动状态
  const [autoStart, setAutoStart] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    import('@tauri-apps/plugin-autostart').then(({ isEnabled }) => {
      isEnabled().then(setAutoStart).catch(() => {});
    }).catch(() => {});
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    const fallbackVersion = import.meta.env.VITE_APP_VERSION || '';

    if (!open) return;
    if (!isTauri()) return;

    import('@tauri-apps/api/app')
      .then(({ getVersion }) => getVersion())
      .then(version => {
        if (!cancelled) setAppVersion(version || fallbackVersion);
      })
      .catch(() => {
        if (!cancelled) setAppVersion(fallbackVersion);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  // ===== 数据导出/导入 =====
  const handleExport = async () => {
    const exportData = {
      version: 2,
      exportedAt: new Date().toISOString(),
      tasks,
    };
    const json = JSON.stringify(exportData, null, 2);
    const fileName = `easysail-exam-backup-${new Date().toISOString().split('T')[0]}.json`;

    // Tauri 环境：使用原生保存对话框
    if (isTauri()) {
      try {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const { writeTextFile } = await import('@tauri-apps/plugin-fs');
        const filePath = await save({
          title: '导出数据',
          defaultPath: fileName,
          filters: [{ name: 'JSON 文件', extensions: ['json'] }],
        });
        if (filePath) {
          await writeTextFile(filePath, json);
          setImportMsg(`已导出 ${tasks.length} 条任务`);
        }
      } catch (err) {
        console.error('[Export] Tauri 导出失败:', err);
        setImportMsg('导出失败');
      }
      return;
    }

    // 浏览器 fallback
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    setImportMsg(`已导出 ${tasks.length} 条任务`);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportMsg('');
    try {
      const text = await file.text();
      const data = JSON.parse(text);

      // 新格式：{ version, tasks }
      if (data && typeof data === 'object' && !Array.isArray(data) && Array.isArray(data.tasks)) {
        const taskList = data.tasks;
        const valid = taskList.every((t: Record<string, unknown>) => typeof t === 'object' && t.title && typeof t.id === 'number');
        if (!valid) { setImportMsg('文件格式错误：任务数据缺少必要字段'); return; }
        try { await dbReplaceAll(taskList); } catch { /* fallback */ }
        useTaskStore.getState().replaceTasks(taskList);
        setImportMsg(`成功导入 ${taskList.length} 条任务`);
        e.target.value = '';
        return;
      }

      // 旧格式：纯任务数组
      if (Array.isArray(data) && data.length > 0) {
        const valid = data.every((t: Record<string, unknown>) => typeof t === 'object' && t.title && typeof t.id === 'number');
        if (!valid) { setImportMsg('文件格式错误：任务数据缺少必要字段'); return; }
        try { await dbReplaceAll(data); } catch { /* fallback */ }
        useTaskStore.getState().replaceTasks(data);
        setImportMsg(`成功导入 ${data.length} 条任务`);
        e.target.value = '';
        return;
      }

      setImportMsg('文件格式错误：需要包含任务数组');
    } catch { setImportMsg('导入失败：无法解析 JSON 文件'); }
    e.target.value = '';
  };

  // ===== 云盘同步 =====
  const handlePickDir = async () => {
    if (pickingDir) return;
    setPickingDir(true);
    try {
      const dir = await pickCloudDir();
      if (dir) setCloudDirState(dir);
    } finally {
      setPickingDir(false);
    }
  };

  const handleClearDir = () => {
    setCloudDir('');
    setCloudDirState('');
    setAutoSave(false);
    setAutoSaveState(false);
  };

  /**
   * 手动保存到云盘：任务、考研计划、背单词进度各存一个 JSON 文件。
   * 各模块独立容错：某个模块失败不影响其余模块写入。
   * 本地没有数据的模块一律跳过，避免用空快照覆盖云端有效数据。
   */
  const handleCloudSave = async () => {
    setCloudMsg('');
    const saved: string[] = [];
    const skipped: string[] = [];
    const failed: string[] = [];

    // 任务
    try {
      const taskResult = await saveToCloud(tasks);
      saved.push(`${taskResult.count} 条任务`);
    } catch (err: unknown) {
      failed.push(`任务（${errText(err)}）`);
    }

    // 考研计划
    try {
      const snapshot = useExamStore.getState().getCloudSnapshot();
      if (!snapshot) {
        skipped.push('考研计划（本地未加载）');
      } else {
        await saveExamToCloud(snapshot);
        saved.push(`考研计划（${snapshot.tasks.length} 项考务）`);
      }
    } catch (err: unknown) {
      failed.push(`考研计划（${errText(err)}）`);
    }

    // 背单词：词卡调度 + 难词本 + AI 助记 + 闯关成绩
    try {
      if (!isTauri()) {
        skipped.push('背单词（浏览器模式不支持）');
      } else {
        const snapshot = await getExamVocabCloudSnapshot();
        const runs = snapshot.gameRuns?.length ?? 0;
        const hasData = snapshot.cards.length > 0 || snapshot.reviews.length > 0 || runs > 0;
        if (!hasData) {
          skipped.push('背单词（本地暂无进度）');
        } else {
          await saveExamVocabToCloud(snapshot);
          saved.push(`背单词（${snapshot.cards.length} 张卡片 / ${runs} 条闯关成绩）`);
        }
      }
    } catch (err: unknown) {
      failed.push(`背单词（${errText(err)}）`);
    }

    setCloudMsg(formatSyncMsg('已保存', saved, skipped, failed));
  };

  /**
   * 从云盘加载：任务、考研计划、背单词进度分别恢复。
   * 云盘缺少某模块时只提示、不清空本地数据。
   */
  const handleCloudLoad = async () => {
    setCloudMsg('');
    const restored: string[] = [];
    const missing: string[] = [];
    const failed: string[] = [];

    // 任务
    try {
      const taskData = await loadFromCloud();
      useTaskStore.getState().replaceTasks(taskData);
      try { await dbReplaceAll(useTaskStore.getState().tasks); } catch { /* fallback */ }
      restored.push(`${taskData.length} 条任务`);
    } catch (err) {
      console.warn('[CloudLoad] 任务加载失败:', err);
      missing.push('任务');
    }

    // 考研计划
    try {
      await useExamStore.getState().restoreFromCloud();
      restored.push('考研计划');
    } catch (err) {
      console.warn('[CloudLoad] 考研计划加载失败:', err);
      missing.push('考研计划');
    }

    // 背单词（含闯关成绩）
    try {
      const { restored: ok } = await useExamVocabStore.getState().restoreFromCloud();
      if (ok) {
        restored.push('背单词进度');
        // 恢复后刷新闯关概览（关卡进度与最近成绩）
        try { await useVocabGameStore.getState().refresh(); } catch { /* 浏览器模式无库 */ }
      } else {
        missing.push('背单词');
      }
    } catch (err) {
      console.warn('[CloudLoad] 背单词加载失败:', err);
      failed.push(`背单词（${errText(err)}）`);
    }

    const parts: string[] = [];
    if (restored.length) parts.push(`已从云盘加载：${restored.join('、')}`);
    if (missing.length) parts.push(`云盘缺少：${missing.join('、')}`);
    if (failed.length) parts.push(`失败：${failed.join('；')}`);
    setCloudMsg(parts.join('；') || '未找到云盘数据');
  };

  const handleToggleAutoSave = (enabled: boolean) => {
    setAutoSave(enabled);
    setAutoSaveState(enabled);
  };

  const handleIntervalChange = (val: number) => {
    setAutoInterval(val);
    setAutoIntervalState(val);
  };

  // ===== 大模型设置 =====

  // 刷新模型列表状态
  const refreshAiModels = () => {
    setAiModelsState(getAiModels());
    setActiveIdState(getActiveModelId());
  };

  // 修改弹窗表单字段
  const handleModalFieldChange = <K extends keyof AiModelConfig>(key: K, value: AiModelConfig[K]) => {
    setModalForm(prev => ({ ...prev, [key]: value }));
    if (key === 'baseUrl') {
      setModelList([]);
      setShowModelDropdown(false);
    }
  };

  // 弹窗内应用预设
  const handleModalPreset = (baseUrl: string, model: string) => {
    setModalForm(prev => ({ ...prev, baseUrl, model }));
    setModelList([]);
    setShowModelDropdown(false);
  };

  // 打开新增弹窗
  const handleAddModel = () => {
    setModalMode('add');
    setModalId(null);
    setModalForm({
      id: '', name: '',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: '', model: 'deepseek-chat',
    });
    setModelList([]);
    setShowModelDropdown(false);
    setAiMsg('');
    setModalOpen(true);
  };

  // 打开编辑弹窗
  const handleEditModel = (id: string) => {
    const model = aiModels.find(m => m.id === id);
    if (!model) return;
    setModalMode('edit');
    setModalId(id);
    setModalForm({ ...model });
    setModelList([]);
    setShowModelDropdown(false);
    setAiMsg('');
    setModalOpen(true);
  };

  // 弹窗确认提交（新增或保存编辑）
  const handleModalConfirm = () => {
    const name = modalForm.name.trim() || `模型 ${aiModels.length + 1}`;
    if (modalMode === 'add') {
      addAiModel({
        name,
        baseUrl: modalForm.baseUrl.trim(),
        apiKey: modalForm.apiKey.trim(),
        model: modalForm.model.trim(),
      });
      refreshAiModels();
      setModalOpen(false);
    } else if (modalMode === 'edit' && modalId) {
      updateAiModel(modalId, {
        name,
        baseUrl: modalForm.baseUrl.trim(),
        apiKey: modalForm.apiKey.trim(),
        model: modalForm.model.trim(),
      });
      refreshAiModels();
      setModalOpen(false);
    }
    setAiMsg('');
    setModelList([]);
    setShowModelDropdown(false);
  };

  // 弹窗取消
  const handleModalCancel = () => {
    setModalOpen(false);
    setModelList([]);
    setShowModelDropdown(false);
  };

  // 删除模型
  const handleRemoveModel = (id: string) => {
    removeAiModel(id);
    refreshAiModels();
    setAiMsg('');
    setModelList([]);
    setShowModelDropdown(false);
  };

  // 设为当前使用的模型
  const handleSetActive = (id: string) => {
    setActiveModelId(id);
    setActiveIdState(id);
  };

  const handleToggleAiEnabled = () => {
    const next = !aiEnabled;
    setAiEnabled(next);
    setAiEnabledState(next);
  };

  const handleSplashModeChange = (mode: SplashMode) => {
    setSplashMode(mode);
    setSplashModeState(mode);
  };

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateMsg('');
    try {
      const result = await checkAndInstallUpdate();
      if (result.status === 'not-supported') setUpdateMsg('当前环境不支持自动更新，请在安装包内使用');
      if (result.status === 'no-update') setUpdateMsg('当前已是最新版本');
      if (result.status === 'updated') setUpdateMsg(`已安装 v${result.version}，正在重启应用`);
    } catch (err: unknown) {
      console.error('[updater] 检查更新失败', err);
      const msg = err instanceof Error ? err.message : String(err);
      setUpdateMsg(`检查更新失败：${msg}`);
    } finally {
      setCheckingUpdate(false);
    }
  };

  // 弹窗内测试连接
  const handleTestAi = async () => {
    setAiMsg('');
    setAiTesting(true);
    try {
      const reply = await testAiConnection(modalForm);
      setAiMsg(`连接成功：${reply}`);
    } catch (err: unknown) {
      setAiMsg(`连接失败：${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setAiTesting(false);
    }
  };

  // 弹窗内获取模型列表
  const handleFetchModels = async () => {
    setAiMsg('');
    setFetchingModels(true);
    try {
      const models = await listModels(modalForm);
      setModelList(models);
      setShowModelDropdown(models.length > 0);
      if (models.length === 0) {
        setAiMsg('该服务未返回任何模型，请手动填写');
      }
    } catch (err: unknown) {
      setAiMsg(`获取失败：${err instanceof Error ? err.message : '未知错误'}`);
      setModelList([]);
      setShowModelDropdown(false);
    } finally {
      setFetchingModels(false);
    }
  };

  const classifyCandidates = tasks
    .filter(t => !t.completed)
    .filter(t => t.tags.length === 0 || !['project-work', 'project-study', 'project-life'].includes(t.projectId))
    .slice(0, 30);

  const handleClassifyTasks = async () => {
    const result = await aiTask.classifyTasks(classifyCandidates);
    if (result) setClassifyPreview(result);
  };

  const handleApplyClassify = async () => {
    if (!classifyPreview) return;
    for (const item of classifyPreview.suggestions) {
      const task = tasks.find(t => t.id === item.taskId);
      if (!task) continue;
      await updateTask(item.taskId, {
        projectId: item.projectId ?? task.projectId,
        tags: item.tags.length > 0 ? item.tags : task.tags,
      });
    }
    setClassifyPreview(null);
    setAiMsg(`已应用 ${classifyPreview.suggestions.length} 条归类建议`);
  };

  // ===== 样式 =====
  const btnStyle: React.CSSProperties = {
    padding: '5px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)',
    fontSize: 13, cursor: 'pointer', background: 'var(--bg-secondary)', color: 'var(--text-primary)',
  };
  const primaryBtnStyle: React.CSSProperties = { ...btnStyle, background: 'var(--brand-primary)', color: '#fff', border: 'none' };
  const inputStyle: React.CSSProperties = {
    flex: 1, width: '100%', padding: '7px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)',
    fontSize: 13, background: 'var(--bg-primary)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box',
  };

  const msgStyle = (msg: string): React.CSSProperties => {
    // 成功：含「成功」或以「已/从」开头；使用主题色（brand）而非红色
    const isSuccess = msg.includes('成功') || msg.startsWith('已') || msg.startsWith('从');
    return {
      marginTop: 8, padding: '8px 12px', borderRadius: 'var(--radius-md)', fontSize: 13,
      background: isSuccess ? 'var(--brand-light)' : 'var(--danger-light)',
      color: isSuccess ? 'var(--brand-primary)' : 'var(--danger)',
    };
  };

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal settings-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>设置</h2>
            <div className="modal-header-sub">版本 v{appVersion || '获取中...'}</div>
          </div>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="settings-layout">
          <div className="settings-sidebar">
            {TABS.map(tab => (
              <div
                key={tab.key}
                className={`settings-menu-item${activeTab === tab.key ? ' active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </div>
            ))}
          </div>
          <div className="settings-content">

            {/* 通用 */}
            {activeTab === 'general' && (
              <div className="setting-section">
                <h3>通用</h3>
                <div className="setting-row">
                  <div>
                    <div className="setting-label">开机自启动</div>
                    <div className="setting-desc">系统启动时自动运行轻舟考研台</div>
                  </div>
                  <div
                    className={`toggle${autoStart ? ' active' : ''}${!isTauri() ? ' disabled' : ''}`}
                    onClick={async () => {
                      if (!isTauri()) return;
                      try {
                        const { enable, disable } = await import('@tauri-apps/plugin-autostart');
                        if (autoStart) { await disable(); setAutoStart(false); }
                        else { await enable(); setAutoStart(true); }
                      } catch (err) { console.warn('[AutoStart] 切换失败:', err); }
                    }}
                  />
                </div>
                <div className="setting-row">
                  <div>
                    <div className="setting-label">启动页显示</div>
                    <div className="setting-desc">{SPLASH_MODE_OPTIONS.find(option => option.value === splashMode)?.desc}</div>
                  </div>
                  <select
                    value={splashMode}
                    onChange={e => handleSplashModeChange(e.target.value as SplashMode)}
                    style={{ ...inputStyle, maxWidth: 190, flex: '0 0 190px' }}
                  >
                    {SPLASH_MODE_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="setting-row">
                  <div>
                    <div className="setting-label">每日激励语</div>
                    <div className="setting-desc">每天由 AI 生成一句激励语显示在顶栏，需开启大模型功能</div>
                  </div>
                  <div
                    className={`toggle${dailyQuoteOn ? ' active' : ''}`}
                    onClick={() => {
                      const next = !dailyQuoteOn;
                      setDailyQuoteEnabled(next);
                      setDailyQuoteOn(next);
                    }}
                  />
                </div>
              </div>
            )}

            {/* 外观 */}
            {activeTab === 'appearance' && (
              <div className="setting-section">
                <h3>外观</h3>
                <div className="setting-row">
                  <div>
                    <div className="setting-label">主题</div>
                    <div className="setting-desc">选择你喜欢的外观风格</div>
                  </div>
                  <div className="theme-options">
                    <div className={`theme-option light${theme === 'light' ? ' active' : ''}`} onClick={() => setTheme('light')}><Sun size={20} /></div>
                    <div className={`theme-option dark${theme === 'dark' ? ' active' : ''}`} onClick={() => setTheme('dark')}><Moon size={20} /></div>
                  </div>
                </div>
                <div className="setting-row">
                  <div>
                    <div className="setting-label">主题色</div>
                    <div className="setting-desc">选择应用的主色调</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {ACCENT_COLORS.map(c => (
                      <div
                        key={c.id}
                        title={c.label}
                        onClick={() => setAccentColor(c.id)}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: '50%',
                          background: c.hex,
                          cursor: 'pointer',
                          border: accentColor === c.id ? '3px solid var(--text-primary)' : '3px solid transparent',
                          boxShadow: accentColor === c.id ? `0 0 0 2px ${c.hex}44` : 'none',
                          transition: 'all 150ms ease-out',
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 云盘同步 */}
            {activeTab === 'cloud' && (
              <div className="setting-section">
                <h3>云盘同步</h3>
                <div className="setting-row">
                  <div style={{ flex: 1 }}>
                    <div className="setting-label">同步目录</div>
                    <div className="setting-desc">选择云盘文件夹（如 OneDrive / Dropbox / 坚果云），数据将保存为 JSON 文件</div>
                  </div>
                </div>
                <div style={{
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-default)',
                  fontSize: 12,
                  lineHeight: 1.7,
                  color: 'var(--text-secondary)',
                  marginBottom: 12,
                }}>
                  <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>支持的云盘：</div>
                  <div>• <b>OneDrive / Dropbox / iCloud / 坚果云</b> — 直接选择本地同步文件夹即可</div>
                  <div>• <b>阿里云盘</b> — 安装客户端后开启同步文件夹，选择同步目录即可</div>
                  <div>• <b>百度云盘</b> — 安装客户端后开启同步空间，选择同步目录即可</div>
                </div>
                <div style={{
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-default)',
                  fontSize: 12,
                  lineHeight: 1.7,
                  color: 'var(--text-secondary)',
                  marginBottom: 12,
                }}>
                  <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>同步内容（各存一个 JSON 文件）：</div>
                  <div>• <b>easysail-exam-tasks.json</b> — 任务清单</div>
                  <div>• <b>easysail-exam-plan.json</b> — 考研计划（科目 / 阶段 / 考务）</div>
                  <div>• <b>easysail-exam-vocab.json</b> — 背单词进度（词卡调度 / 难词本 / AI 助记 / 闯关成绩）</div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <input
                    type="text"
                    readOnly
                    value={cloudDir}
                    placeholder="未选择目录"
                    style={{ ...inputStyle, cursor: 'default' }}
                  />
                  <button
                    style={{ ...btnStyle, opacity: pickingDir ? 0.6 : 1 }}
                    onClick={handlePickDir}
                    disabled={pickingDir}
                  >
                    {pickingDir ? '选择中...' : '选择目录'}
                  </button>
                  {cloudDir && <button style={btnStyle} onClick={handleClearDir}>清除</button>}
                </div>

                {cloudDir && (
                  <>
                    <div className="setting-row">
                      <div>
                        <div className="setting-label">手动同步</div>
                        <div className="setting-desc">将当前数据（任务 / 考研计划 / 背单词进度）保存到云盘；从云盘加载会覆盖本地对应数据</div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button style={btnStyle} onClick={handleCloudLoad}>从云盘加载</button>
                        <button style={primaryBtnStyle} onClick={handleCloudSave}>保存到云盘</button>
                      </div>
                    </div>

                    <div className="setting-row">
                      <div>
                        <div className="setting-label">自动保存</div>
                        <div className="setting-desc">定时将数据自动保存到云盘目录</div>
                      </div>
                      <div
                        className={`toggle${autoSave ? ' active' : ''}`}
                        onClick={() => handleToggleAutoSave(!autoSave)}
                      />
                    </div>

                    {autoSave && (
                      <div className="setting-row">
                        <div>
                          <div className="setting-label">保存间隔</div>
                          <div className="setting-desc">自动保存的时间间隔</div>
                        </div>
                        <select
                          value={autoInterval}
                          onChange={e => handleIntervalChange(Number(e.target.value))}
                          style={{
                            padding: '6px 12px', borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--border-default)', fontSize: 13,
                            background: 'var(--bg-primary)', color: 'var(--text-primary)',
                          }}
                        >
                          <option value={30}>30 秒</option>
                          <option value={60}>1 分钟</option>
                          <option value={180}>3 分钟</option>
                          <option value={300}>5 分钟</option>
                          <option value={600}>10 分钟</option>
                        </select>
                      </div>
                    )}

                    {cloudMsg && <div style={msgStyle(cloudMsg)}>{cloudMsg}</div>}
                  </>
                )}
              </div>
            )}

            {/* 大模型设置 */}
            {activeTab === 'ai' && (
              <div className="setting-section">
                <h3>大模型设置</h3>

                <div className="setting-row">
                  <div>
                    <div className="setting-label">启用 AI 功能</div>
                    <div className="setting-desc">开启后任务详情、AI 助手、智能归类等 AI 操作才会调用模型</div>
                  </div>
                  <div
                    className={`toggle${aiEnabled ? ' active' : ''}`}
                    onClick={handleToggleAiEnabled}
                  />
                </div>

                <div className="setting-row">
                  <div>
                    <div className="setting-label">智能归类</div>
                    <div className="setting-desc">为未完成且缺少标签/类型不明确的任务建议类型和紧急/重要标签</div>
                  </div>
                  <button
                    style={{ ...btnStyle, opacity: aiTask.loading || classifyCandidates.length === 0 ? 0.55 : 1 }}
                    disabled={aiTask.loading || classifyCandidates.length === 0}
                    onClick={handleClassifyTasks}
                  >
                    {aiTask.loading ? '分析中...' : `分析 ${classifyCandidates.length} 条`}
                  </button>
                </div>

                {aiTask.error && <div style={msgStyle(aiTask.error)}>{aiTask.error}</div>}

                {classifyPreview && (
                  <div className="ai-panel" style={{ marginBottom: 12 }}>
                    <div className="ai-panel-title">归类建议</div>
                    <div className="ai-classify-list">
                      {classifyPreview.suggestions.map(item => {
                        const task = tasks.find(t => t.id === item.taskId);
                        if (!task) return null;
                        const project = item.projectId ? TASK_TYPES.find(t => t.id === item.projectId) : null;
                        return (
                          <div key={item.taskId} className="ai-classify-item">
                            <div className="ai-classify-title">{task.title}</div>
                            <div className="ai-classify-meta">
                              {project && <span>{project.name}</span>}
                              {item.tags.map(tag => TAG_MAP[tag] ? <span key={tag}>{TAG_MAP[tag].label}</span> : null)}
                            </div>
                            <div className="ai-classify-reason">{item.reason}</div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="ai-panel-actions">
                      <button onClick={handleApplyClassify}>应用建议</button>
                      <button onClick={() => setClassifyPreview(null)}>取消</button>
                    </div>
                  </div>
                )}

                {/* 已配置的模型列表 */}
                <div style={{ marginBottom: 12, marginTop: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div className="setting-label">已配置模型（{aiModels.length} 个）</div>
                    <button style={{ ...btnStyle, padding: '4px 12px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }} onClick={handleAddModel}>
                      <Plus size={13} /> 新增
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {aiModels.map(m => {
                      const isActive = m.id === activeId;
                      return (
                        <div
                          key={m.id}
                          className="nav-item"
                          style={{ padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)', background: 'var(--bg-primary)' }}
                        >
                          <span className="nav-icon" style={{ width: 16, height: 16 }}>
                            {isActive && <Check size={14} style={{ color: 'var(--brand-primary)' }} />}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.model} · {m.baseUrl}</div>
                          </div>
                          {!isActive && (
                            <button
                              title="设为当前使用"
                              style={{ padding: '2px 8px', fontSize: 11, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' }}
                              onClick={() => handleSetActive(m.id)}
                            >
                              使用
                            </button>
                          )}
                          {isActive && <span style={{ fontSize: 11, color: 'var(--brand-primary)', fontWeight: 600, whiteSpace: 'nowrap' }}>使用中</span>}
                          <button
                            title="编辑"
                            style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', cursor: 'pointer', flexShrink: 0 }}
                            onClick={() => handleEditModel(m.id)}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            title="删除"
                            style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', cursor: 'pointer', flexShrink: 0 }}
                            onClick={() => handleRemoveModel(m.id)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 当前编辑的模型配置 - 已移至弹窗 */}

                {/* 隐私提示 */}
                <div style={{
                  marginTop: 8, padding: '10px 14px', borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-primary)', border: '1px solid var(--border-default)',
                  fontSize: 12, lineHeight: 1.7, color: 'var(--text-secondary)',
                }}>
                  <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>隐私说明</div>
                  <div>• API Key 仅保存在本地存储，不会上传到任何第三方服务器</div>
                  <div>• 对话请求直接发送到你配置的服务地址，轻舟考研台不经过任何中转</div>
                </div>

                {/* 模型新增/编辑弹窗 */}
                {modalOpen && (
                  <div className="modal-overlay open" onClick={handleModalCancel}>
                    <div
                      className="modal"
                      style={{ width: 600, maxWidth: '90vw', maxHeight: '88vh' }}
                      onClick={e => e.stopPropagation()}
                    >
                      <div className="modal-header">
                        <h2>{modalMode === 'add' ? '新增模型' : '编辑模型'}</h2>
                        <button className="icon-btn" onClick={handleModalCancel}>✕</button>
                      </div>
                      <div className="modal-body">
                        {/* 名称 */}
                        <div style={{ marginBottom: 12 }}>
                          <div className="setting-label" style={{ marginBottom: 6 }}>名称</div>
                          <input
                            type="text"
                            value={modalForm.name}
                            placeholder="如 我的 DeepSeek（留空自动命名）"
                            onChange={e => handleModalFieldChange('name', e.target.value)}
                            style={{ ...inputStyle, width: '100%' }}
                          />
                        </div>

                        {/* 服务预设 */}
                        <div style={{ marginBottom: 12 }}>
                          <div className="setting-label" style={{ marginBottom: 8 }}>快速选择服务</div>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {AI_PRESETS.map(p => {
                              const active = modalForm.baseUrl === p.baseUrl;
                              return (
                                <button
                                  key={p.name}
                                  title={p.desc}
                                  style={{
                                    ...btnStyle, padding: '4px 12px', fontSize: 12,
                                    ...(active ? { background: 'var(--brand-primary)', color: '#fff', border: 'none' } : {}),
                                  }}
                                  onClick={() => handleModalPreset(p.baseUrl, p.model)}
                                >
                                  {p.name}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Base URL */}
                        <div style={{ marginBottom: 12 }}>
                          <div className="setting-label" style={{ marginBottom: 6 }}>服务地址（Base URL）</div>
                          <div className="setting-desc" style={{ marginBottom: 6 }}>仅支持 OpenAI 兼容协议 API</div>
                          <input
                            type="text"
                            value={modalForm.baseUrl}
                            placeholder="https://api.openai.com/v1"
                            onChange={e => handleModalFieldChange('baseUrl', e.target.value.trim())}
                            style={{ ...inputStyle, width: '100%' }}
                          />
                        </div>

                        {/* API Key */}
                        <div style={{ marginBottom: 12 }}>
                          <div className="setting-label" style={{ marginBottom: 6 }}>API Key</div>
                          <input
                            type="password"
                            value={modalForm.apiKey}
                            placeholder="sk-..."
                            onChange={e => handleModalFieldChange('apiKey', e.target.value.trim())}
                            style={{ ...inputStyle, width: '100%' }}
                          />
                        </div>

                        {/* 模型名称 + 获取列表 */}
                        <div style={{ marginBottom: 12 }}>
                          <div className="setting-label" style={{ marginBottom: 6 }}>模型名称</div>
                          <div style={{ display: 'flex', gap: 8, width: '100%', position: 'relative' }}>
                            <input
                              type="text"
                              value={modalForm.model}
                              placeholder="gpt-4o-mini"
                              onChange={e => { handleModalFieldChange('model', e.target.value.trim()); setShowModelDropdown(false); }}
                              onFocus={() => { if (modelList.length > 0) setShowModelDropdown(true); }}
                              style={{ ...inputStyle, flex: 1 }}
                            />
                            <button
                              style={{ ...btnStyle, opacity: (fetchingModels || !canFetchModels) ? 0.5 : 1, whiteSpace: 'nowrap', cursor: canFetchModels ? 'pointer' : 'not-allowed' }}
                              disabled={fetchingModels || !canFetchModels}
                              title={canFetchModels ? '从服务端获取可用模型列表' : '当前服务不支持获取模型列表，请手动填写'}
                              onClick={handleFetchModels}
                            >
                              {fetchingModels ? '获取中...' : '获取列表'}
                            </button>

                            {showModelDropdown && modelList.length > 0 && (
                              <div style={{
                                position: 'absolute', top: '100%', left: 0, right: 90, marginTop: 4,
                                maxHeight: 240, overflowY: 'auto', background: 'var(--bg-primary)',
                                border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
                                boxShadow: 'var(--shadow-2)', zIndex: 50,
                              }}>
                                {modelList.map(m => (
                                  <div
                                    key={m.id}
                                    className={`sort-option${m.id === modalForm.model ? ' active' : ''}`}
                                    style={{ padding: '8px 12px', fontSize: 13 }}
                                    onClick={() => { handleModalFieldChange('model', m.id); setShowModelDropdown(false); }}
                                  >
                                    {m.id}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          {modelList.length > 0 && showModelDropdown && (
                            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                              共 {modelList.length} 个可用模型，点击选择
                            </div>
                          )}
                        </div>

                        {/* 测试连接 */}
                        <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div className="setting-desc">发送测试消息验证配置是否可用</div>
                          <button
                            style={{ ...primaryBtnStyle, opacity: aiTesting ? 0.6 : 1 }}
                            disabled={aiTesting}
                            onClick={handleTestAi}
                          >
                            {aiTesting ? '测试中...' : '测试连接'}
                          </button>
                        </div>

                        {aiMsg && <div style={msgStyle(aiMsg)}>{aiMsg}</div>}

                        {/* 操作按钮 */}
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
                          <button style={btnStyle} onClick={handleModalCancel}>取消</button>
                          <button
                            style={primaryBtnStyle}
                            onClick={handleModalConfirm}
                            disabled={!modalForm.baseUrl.trim() || !modalForm.model.trim()}
                          >
                            {modalMode === 'add' ? '确认添加' : '保存'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {aiMsg && !modalOpen && <div style={msgStyle(aiMsg)}>{aiMsg}</div>}
              </div>
            )}

            {/* 数据管理 */}
            {activeTab === 'data' && (
              <div className="setting-section">
                <h3>数据管理</h3>
                <div className="setting-row">
                  <div>
                    <div className="setting-label">导出数据</div>
                    <div className="setting-desc">将任务导出为 JSON 文件，可用于备份或迁移</div>
                  </div>
                  <button style={btnStyle} onClick={handleExport}>导出</button>
                </div>
                <div className="setting-row">
                  <div>
                    <div className="setting-label">导入数据</div>
                    <div className="setting-desc">从 JSON 文件导入任务（将覆盖当前所有数据）</div>
                  </div>
                  <div>
                    <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImport} />
                    <button style={btnStyle} onClick={() => fileInputRef.current?.click()}>导入</button>
                  </div>
                </div>
                {importMsg && <div style={msgStyle(importMsg)}>{importMsg}</div>}
              </div>
            )}

            {activeTab === 'about' && (
              <div className="setting-section">
                <h3>关于</h3>
                <div className="about-panel">
                  <div className="about-meta">
                    <div className="about-item">
                      <span className="about-label">应用名称</span>
                      <span className="about-value">轻舟考研台</span>
                    </div>
                    <div className="about-item">
                      <span className="about-label">作者</span>
                      <span className="about-value">北陈哥</span>
                    </div>
                    <div className="about-item">
                      <span className="about-label">版本号</span>
                      <span className="about-value">{appVersion ? `v${appVersion}` : '获取中...'}</span>
                    </div>
                  </div>

                  <div className="about-block">
                    <div className="about-block-title">版本更新</div>
                    <div className="about-update-row">
                      <div>
                        <div className="about-update-title">自动检查新版本</div>
                        <div className="about-update-desc">发现新版本后会下载并安装，完成后自动重启应用</div>
                      </div>
                      <button
                        className="about-update-btn"
                        disabled={checkingUpdate}
                        onClick={handleCheckUpdate}
                      >
                        {checkingUpdate ? '检查中...' : '检查更新'}
                      </button>
                    </div>
                    {updateMsg && <div className="about-update-msg">{updateMsg}</div>}
                  </div>

                  <div className="about-block">
                    <div className="about-block-title">公众号</div>
                    <div className="about-qr-wrap">
                      <img className="about-qr-image" src={authorQrCode} alt="作者公众号二维码" />
                      <div className="about-qr-text">扫码关注作者公众号</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
