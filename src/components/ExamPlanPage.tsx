/**
 * 在职考研计划专区
 *
 * 完全独立模块：exam_profile / exam_subjects / exam_phases / exam_tasks
 * 与 tasks 表零耦合，不污染首页/日历/看板。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  GraduationCap, Settings, Plus, Trash2, Play, Pause, Sparkles,
  MapPin, X, CalendarDays, Target,
} from 'lucide-react';
import { useExamStore } from '../stores/exam-store';
import type { ExamTask } from '../lib/exam-db';
import { localDateStr, formatDate } from '../lib/utils';
import { DatePicker } from './DatePicker';
import { useAiTask } from '../hooks/useAiTask';

// —— 工具 ——

function addDays(base: string, days: number): string {
  const d = new Date(`${base}T00:00:00`);
  d.setDate(d.getDate() + days);
  return localDateStr(d);
}

// —— 任务行 ——

function ExamTaskRow({ task, color }: { task: ExamTask; color: string }) {
  const { setExamTaskStatus, deleteExamTaskById } = useExamStore();
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState(task.notes);
  const isDone = task.status === 'done';
  const isDoing = task.status === 'doing';

  const saveNotes = () => {
    if (notes !== task.notes) void useExamStore.getState().updateExamTaskFields(task.id, { notes });
  };

  return (
    <div className={`exam-task-row${isDone ? ' done' : ''}${isDoing ? ' doing' : ''}`} style={{ '--exam-color': color } as React.CSSProperties}>
      <div className="exam-task-main">
        <div
          className={`checkbox${isDone ? ' checked' : ''}`}
          onClick={() => void setExamTaskStatus(task.id, isDone ? 'todo' : 'done')}
        />
        <div className="exam-task-body" onClick={() => setExpanded(!expanded)}>
          <div className="exam-task-title">
            {task.title}
            {isDoing && <span className="badge-doing">进行中</span>}
          </div>
          <div className="exam-task-meta">
            {task.planDate && (
              <span className={`task-date ${!isDone && task.planDate < localDateStr() ? 'overdue' : ''}`}>
                <CalendarDays size={12} /> {formatDate(task.planDate)}
              </span>
            )}
            {task.startedDate && !isDone && (
              <span className="task-date doing-time"><Play size={11} /> 开始 {formatDate(task.startedDate)}</span>
            )}
          </div>
        </div>
        {!isDone && (
          isDoing ? (
            <button className="btn-start" title="暂停" onClick={() => void setExamTaskStatus(task.id, 'todo')}><Pause size={15} /></button>
          ) : (
            <button className="btn-start" title="开始" onClick={() => void setExamTaskStatus(task.id, 'doing')}><Play size={15} /></button>
          )
        )}
        <button className="btn-delete" title="删除" onClick={() => void deleteExamTaskById(task.id)}><Trash2 size={15} /></button>
      </div>
      {expanded && (
        <div className="exam-task-notes-edit" onClick={e => e.stopPropagation()}>
          <textarea
            value={notes}
            placeholder="备注：安排细节、资料、验收标准..."
            onChange={e => setNotes(e.target.value)}
            onBlur={saveNotes}
            rows={3}
          />
        </div>
      )}
    </div>
  );
}

// —— 主页面 ——

type TaskRange = 'today' | 'week' | 'all';

export function ExamPlanPage() {
  const store = useExamStore();
  const ai = useAiTask();
  const today = localDateStr();

  const [preferredSubjectKey, setPreferredSubjectKey] = useState<string>('');
  const [range, setRange] = useState<TaskRange>('today');
  const [quickTitle, setQuickTitle] = useState('');

  // 弹窗开关
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [phasesOpen, setPhasesOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiRequirement, setAiRequirement] = useState('');
  const [aiChecked, setAiChecked] = useState<boolean[]>([]);
  const [aiDraft, setAiDraft] = useState<{ title: string; notes: string; planDate: string | null }[]>([]);

  useEffect(() => { void useExamStore.getState().loadFromDb(); }, []);

  // 派生：偏好科目失效时回退到第一个科目
  const activeSubjectKey = store.subjects.some(s => s.key === preferredSubjectKey)
    ? preferredSubjectKey
    : (store.subjects[0]?.key ?? '');

  const subject = store.subjects.find(s => s.key === activeSubjectKey) ?? store.subjects[0];

  const subjectTasks = useMemo(
    () => store.tasks.filter(t => t.subjectKey === activeSubjectKey),
    [store.tasks, activeSubjectKey]
  );

  const pendingCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of store.subjects) map[s.key] = 0;
    for (const t of store.tasks) {
      if (t.status !== 'done' && map[t.subjectKey] !== undefined) map[t.subjectKey]++;
    }
    return map;
  }, [store.tasks, store.subjects]);

  const filteredTasks = useMemo(() => {
    if (!subject) return [];
    if (range === 'today') return subjectTasks.filter(t => t.planDate === today);
    if (range === 'week') {
      const end = addDays(today, 6);
      return subjectTasks.filter(t => t.status !== 'done'
        ? !!t.planDate && t.planDate <= end   // 未完成且计划在近一周内（含逾期）
        : !!t.planDate && t.planDate >= today && t.planDate <= end);
    }
    return [...subjectTasks].sort((a, b) => {
      if (a.status !== b.status && (a.status === 'done' || b.status === 'done')) return a.status === 'done' ? 1 : -1;
      return (a.planDate ?? '9999').localeCompare(b.planDate ?? '9999');
    });
  }, [subjectTasks, range, today, subject]);

  // 概览统计
  const stats = useMemo(() => {
    if (!subject) return null;
    const done = subjectTasks.filter(t => t.status === 'done').length;
    const total = subjectTasks.length;
    return { done, total, rate: total > 0 ? Math.round(done / total * 100) : 0 };
  }, [subject, subjectTasks]);

  // 当前阶段（按科目 id 关联；subjects 来自 DB 时有 id）
  const currentPhase = useMemo(() => {
    if (!subject) return null;
    const dbSubject = store.subjects.find(s => s.key === subject.key);
    if (!dbSubject) return null;
    const list = store.phases.filter(p => p.subjectId === dbSubject.id);
    return list.find(p => p.startDate <= today && today <= p.endDate)
      ?? list.find(p => p.startDate > today)
      ?? list[list.length - 1]
      ?? null;
  }, [subject, store.subjects, store.phases, today]);

  const phaseProgress = useMemo(() => {
    if (!currentPhase) return 0;
    const s = new Date(`${currentPhase.startDate}T00:00:00`).getTime();
    const e = new Date(`${currentPhase.endDate}T23:59:59`).getTime();
    const n = new Date(`${today}T12:00:00`).getTime();
    if (n <= s) return 0;
    if (n >= e) return 100;
    return Math.round((n - s) / (e - s) * 100);
  }, [currentPhase, today]);

  const daysLeft = useMemo(() => {
    if (!store.profile.examDate) return null;
    const diff = Math.ceil((new Date(`${store.profile.examDate}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000);
    return diff;
  }, [store.profile.examDate, today]);

  const handleQuickAdd = async () => {
    const title = quickTitle.trim();
    if (!title || !activeSubjectKey) return;
    await store.addTask({ subjectKey: activeSubjectKey, title, planDate: today });
    setQuickTitle('');
  };

  const handleGenerate = async () => {
    if (!subject || !aiRequirement.trim()) return;
    const draft = await ai.generateExamPlan(subject.name, aiRequirement, store.profile.examDate);
    if (draft) {
      setAiChecked(draft.plans.map(() => true));
      setAiDraft(draft.plans);
    }
  };

  const handleCreateFromDraft = async () => {
    const picked = aiDraft.filter((_, i) => aiChecked[i]);
    if (!subject || picked.length === 0) return;
    await store.addTasks(picked.map(p => ({
      subjectKey: subject.key,
      title: p.title,
      notes: p.notes,
      planDate: p.planDate ?? today,
    })));
    setAiOpen(false);
    setAiDraft([]);
    setAiRequirement('');
  };

  if (!subject) {
    return <div className="exam-page"><div className="calendar-empty">加载中…</div></div>;
  }

  return (
    <div className="exam-page">
      {/* 数据库错误横幅 */}
      {store.lastError && (
        <div className="exam-error-banner">
          <span>{store.lastError}</span>
          <button className="icon-btn" onClick={() => store.clearError()}><X size={14} /></button>
        </div>
      )}

      {/* 倒计时条 */}
      <div className="exam-countdown">
        <GraduationCap size={20} />
        {daysLeft !== null ? (
          daysLeft >= 0
            ? <span>距考研初试还有 <b>{daysLeft}</b> 天</span>
            : <span>初试已结束（{formatDate(store.profile.examDate ?? today)}）</span>
        ) : (
          <span>尚未设置考试日期</span>
        )}
        {store.profile.targetNote && (
          <span className="exam-target"><Target size={14} /> {store.profile.targetNote}</span>
        )}
        <button className="icon-btn exam-settings-btn" title="考试设置" onClick={() => setSettingsOpen(true)}><Settings size={16} /></button>
      </div>

      {/* 科目 Tabs */}
      <div className="exam-tabs">
        {store.subjects.map(s => (
          <button
            key={s.key}
            className={`exam-tab${s.key === activeSubjectKey ? ' active' : ''}`}
            style={s.key === activeSubjectKey ? { borderColor: s.color, color: s.color } : {}}
            onClick={() => setPreferredSubjectKey(s.key)}
          >
            {s.name}
            {(pendingCounts[s.key] ?? 0) > 0 && <span className="exam-tab-badge">{pendingCounts[s.key]}</span>}
          </button>
        ))}
      </div>

      {/* 概览卡 */}
      {stats && (
        <div className="exam-overview">
          <div className="exam-stat-card">
            <div className="exam-stat-label"><MapPin size={12} /> 当前阶段</div>
            {currentPhase ? (
              <>
                <div className="exam-stat-value">{currentPhase.name}<span className="exam-stat-sub">{currentPhase.startDate.slice(5)} ~ {currentPhase.endDate.slice(5)}</span></div>
                <div className="cal-progress-bar"><div className="cal-progress-fill" style={{ width: `${phaseProgress}%` }} /></div>
                <div className="exam-phase-goal">{currentPhase.goal || '暂无阶段目标'}</div>
              </>
            ) : <div className="exam-stat-value">—</div>}
            <button className="exam-link-btn" onClick={() => setPhasesOpen(true)}>编辑阶段</button>
          </div>
          <div className="exam-stat-card">
            <div className="exam-stat-label">任务完成率</div>
            <div className="exam-stat-value">{stats.rate}%<span className="exam-stat-sub">{stats.done}/{stats.total} 项</span></div>
            <div className="cal-progress-bar"><div className="cal-progress-fill" style={{ width: `${stats.rate}%` }} /></div>
          </div>
        </div>
      )}

      {/* 任务区 */}
      <div className="exam-tasks-section">
        <div className="exam-tasks-toolbar">
          <div className="exam-range-tabs">
            {([['today', '今日'], ['week', '本周'], ['all', '全部']] as [TaskRange, string][]).map(([k, label]) => (
              <button key={k} className={`cal-filter-btn${range === k ? ' active' : ''}`} onClick={() => setRange(k)}>{label}</button>
            ))}
          </div>
          <button className="exam-ghost-btn" onClick={() => { setAiDraft([]); setAiChecked([]); setAiRequirement(''); setAiOpen(true); }}><Sparkles size={13} /> AI 生成周计划</button>
        </div>

        <div className="exam-quick-add">
          <Plus size={15} />
          <input
            placeholder={`添加「${subject.name}」学习任务，回车创建（计划日期=今天）`}
            value={quickTitle}
            onChange={e => setQuickTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void handleQuickAdd(); }}
          />
        </div>

        <div className="exam-task-list">
          {filteredTasks.length === 0 ? (
            <div className="calendar-empty">暂无任务</div>
          ) : filteredTasks.map(t => <ExamTaskRow key={t.id} task={t} color={subject.color} />)}
        </div>
      </div>

      {/* 考试设置弹窗 */}
      {settingsOpen && (
        <ExamSettingsModal
          profile={store.profile}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* 阶段规划弹窗 */}
      {phasesOpen && <PhasesModal onClose={() => setPhasesOpen(false)} />}

      {/* AI 周计划弹窗 */}
      {aiOpen && (
        <div className="modal-overlay open" onClick={() => setAiOpen(false)}>
          <div className="modal exam-modal" onClick={e => e.stopPropagation()}>
            <div className="detail-header">
              <span className="detail-header-title exam-modal-title"><Sparkles size={14} /> AI 生成周计划 · {subject.name}</span>
              <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={() => setAiOpen(false)}><X size={16} /></button>
            </div>
            <div className="detail-body">
              <textarea
                className="detail-notes"
                rows={3}
                placeholder={'描述本周学习需求，例如：\n每天背单词100个；周末做两篇阅读真题并精读；复习上周错题'}
                value={aiRequirement}
                onChange={e => setAiRequirement(e.target.value)}
              />
              {ai.error && <div className="ai-error-text">{ai.error}</div>}
              {aiDraft.length > 0 && (
                <div className="ai-panel" style={{ marginTop: 10 }}>
                  <div className="ai-panel-title">草稿预览（勾选后创建）</div>
                  <div className="exam-draft-list">
                    {aiDraft.map((p, i) => (
                      <label key={i} className="exam-draft-item">
                        <input
                          type="checkbox"
                          checked={aiChecked[i] ?? true}
                          onChange={e => setAiChecked(arr => arr.map((v, j) => (j === i ? e.target.checked : v)))}
                        />
                        <span className="exam-draft-title">{p.title}</span>
                        <span className="exam-draft-date">{p.planDate ? formatDate(p.planDate) : '无日期'}</span>
                      </label>
                    ))}
                  </div>
                  <div className="ai-panel-actions">
                    <button onClick={() => void handleCreateFromDraft()}>创建选中任务（{aiChecked.filter(Boolean).length}）</button>
                    <button onClick={() => { setAiDraft([]); setAiChecked([]); }}>重新生成</button>
                  </div>
                </div>
              )}
            </div>
            <div className="detail-footer">
              <button
                className="detail-close-btn"
                disabled={ai.loading || !aiRequirement.trim()}
                onClick={() => void handleGenerate()}
              >
                {ai.loading ? '生成中…' : '生成草稿'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// —— 考试设置弹窗 ——

function ExamSettingsModal({ profile, onClose }: { profile: ReturnType<typeof useExamStore.getState>['profile']; onClose: () => void }) {
  const { saveProfile, backupToCloud, restoreFromCloud } = useExamStore();
  const [examDate, setExamDate] = useState(profile.examDate ?? '');
  const [targetNote, setTargetNote] = useState(profile.targetNote);
  const [goal, setGoal] = useState(String(profile.dailyGoalMinutes));
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudMsg, setCloudMsg] = useState('');

  const handleSave = async () => {
    await saveProfile({
      examDate: examDate || null,
      targetNote: targetNote.trim(),
      dailyGoalMinutes: Math.max(30, parseInt(goal, 10) || 120),
    });
    onClose();
  };

  const handleBackup = async () => {
    setCloudBusy(true);
    setCloudMsg('');
    try {
      const r = await backupToCloud();
      setCloudMsg(`✓ 已备份（${r.path}）`);
    } catch (err) {
      setCloudMsg(`备份失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCloudBusy(false);
    }
  };

  const handleRestore = async () => {
    if (!window.confirm('将从云盘恢复考研数据并覆盖本地当前数据，确定继续？')) return;
    setCloudBusy(true);
    setCloudMsg('');
    try {
      await restoreFromCloud();
      setCloudMsg('✓ 恢复成功');
      onClose();
    } catch (err) {
      setCloudMsg(`恢复失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCloudBusy(false);
    }
  };

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal exam-modal" onClick={e => e.stopPropagation()}>
        <div className="detail-header">
          <span className="detail-header-title">考试设置</span>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onClose}><X size={16} /></button>
        </div>
        <div className="detail-body">
          <div className="detail-field">
            <div className="detail-field-label">初试日期</div>
            <div className="detail-field-row detail-date-row">
              <DatePicker value={examDate} onChange={setExamDate} icon={false} className="detail-date-trigger" />
            </div>
          </div>
          <div className="detail-field">
            <div className="detail-field-label">目标备注（院校 / 专业 / 分数）</div>
            <input className="exam-input" value={targetNote} onChange={e => setTargetNote(e.target.value)} placeholder="如：北大 MBA · 目标 220 分" />
          </div>
          <div className="detail-field">
            <div className="detail-field-label">每日目标时长（分钟）</div>
            <input className="exam-input" type="number" min={30} value={goal} onChange={e => setGoal(e.target.value)} />
          </div>
          <div className="detail-field">
            <div className="detail-field-label">云盘同步（与任务/灵感共用同一目录）</div>
            <div className="exam-cloud-row">
              <button className="exam-ghost-btn" disabled={cloudBusy} onClick={() => void handleBackup()}>备份到云盘</button>
              <button className="exam-ghost-btn" disabled={cloudBusy} onClick={() => void handleRestore()}>从云盘恢复</button>
            </div>
            {cloudMsg && <div className="exam-cloud-msg">{cloudMsg}</div>}
          </div>
        </div>
        <div className="detail-footer">
          <button className="detail-close-btn" onClick={() => void handleSave()}>保存</button>
        </div>
      </div>
    </div>
  );
}

// —— 阶段规划弹窗 ——

function PhasesModal({ onClose }: { onClose: () => void }) {
  const { subjects, phases, editPhase } = useExamStore();
  const [drafts, setDrafts] = useState(() => phases.map(p => ({ ...p })));

  const dirty = drafts.some(d => {
    const orig = phases.find(p => p.id === d.id);
    return orig && (orig.name !== d.name || orig.startDate !== d.startDate || orig.endDate !== d.endDate || orig.goal !== d.goal);
  });

  const handleSaveAll = async () => {
    for (const d of drafts) {
      const orig = phases.find(p => p.id === d.id);
      if (!orig) continue;
      if (orig.name !== d.name || orig.startDate !== d.startDate || orig.endDate !== d.endDate || orig.goal !== d.goal) {
        await editPhase(d.id, { name: d.name, startDate: d.startDate, endDate: d.endDate, goal: d.goal });
      }
    }
    onClose();
  };

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal exam-modal" onClick={e => e.stopPropagation()}>
        <div className="detail-header">
          <span className="detail-header-title">阶段规划</span>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onClose}><X size={16} /></button>
        </div>
        <div className="detail-body">
          {subjects.map(subject => {
            const subjectPhases = drafts.filter(p => p.subjectId === subject.id);
            if (subjectPhases.length === 0) return null;
            return (
              <div key={subject.key} className="detail-field">
                <div className="detail-field-label" style={{ color: subject.color }}>{subject.name}</div>
                {subjectPhases.map((p, idx) => (
                  <div key={p.id} className="exam-phase-row">
                    <input
                      className="exam-input exam-input-name"
                      value={p.name}
                      onChange={e => setDrafts(arr => arr.map(x => (x.id === p.id ? { ...x, name: e.target.value } : x)))}
                    />
                    <input
                      type="date"
                      className="exam-input"
                      value={p.startDate}
                      onChange={e => setDrafts(arr => arr.map(x => (x.id === p.id ? { ...x, startDate: e.target.value } : x)))}
                    />
                    <span className="exam-phase-sep">~</span>
                    <input
                      type="date"
                      className="exam-input"
                      value={p.endDate}
                      onChange={e => setDrafts(arr => arr.map(x => (x.id === p.id ? { ...x, endDate: e.target.value } : x)))}
                    />
                    <input
                      className="exam-input exam-input-goal"
                      placeholder="阶段目标"
                      value={p.goal}
                      onChange={e => setDrafts(arr => arr.map(x => (x.id === p.id ? { ...x, goal: e.target.value } : x)))}
                    />
                    <span className="exam-phase-order">{idx + 1}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        <div className="detail-footer">
          <button className="detail-close-btn" disabled={!dirty} onClick={() => void handleSaveAll()}>保存全部</button>
        </div>
      </div>
    </div>
  );
}
