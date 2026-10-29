import { useState, useEffect, useRef } from 'react';
import { Bell, CalendarDays, Trash2, X, Briefcase, BookOpen, House, Clock } from 'lucide-react';
import { useTaskStore } from '../stores/task-store';
import { TAG_MAP, TASK_TYPES } from '../lib/types';
import type { KanbanStatus } from '../lib/types';
import { formatDateTime } from '../lib/utils';
import { useAiTask } from '../hooks/useAiTask';
import type { AiBreakdownDraft } from '../lib/ai-json';
import { AiButton } from './AiButton';
import { ReminderDialog } from './ReminderDialog';
import { DatePicker } from './DatePicker';
import { snoozeTask, clearSnooze } from '../lib/notification-engine';

const TYPE_ICON_MAP: Record<string, React.ReactNode> = {
  'project-work': <Briefcase size={13} />,
  'project-study': <BookOpen size={13} />,
  'project-life': <House size={13} />,
};

function dayOffsetStr(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const DUE_DATE_PRESETS = [
  { label: '今天', date: dayOffsetStr(0) },
  { label: '明天', date: dayOffsetStr(1) },
  { label: '后天', date: dayOffsetStr(2) },
  { label: '下周', date: dayOffsetStr(7) },
];

const START_DATE_PRESETS = [
  { label: '今天', date: dayOffsetStr(0) },
  { label: '明天', date: dayOffsetStr(1) },
];

const STATUS_OPTIONS: { id: KanbanStatus; label: string; color: string }[] = [
  { id: 'todo', label: '待完成', color: '#9CA3AF' },
  { id: 'doing', label: '进行中', color: '#3B82F6' },
  { id: 'done', label: '已完成', color: '#6cc788' },
];

export function DetailPanel() {
  const { tasks, detailTaskId, closeDetail, updateTask, setKanban, toggleTag, deleteTask, createTask } = useTaskStore();
  const task = tasks.find(t => t.id === detailTaskId);

  // 本地缓存标题和备注，debounce 写库避免每次击键都触发 SQLite UPDATE
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [notesPreview, setNotesPreview] = useState('');
  const [breakdownPreview, setBreakdownPreview] = useState<AiBreakdownDraft | null>(null);
  const [reminderPickerOpen, setReminderPickerOpen] = useState(false);
  const [dateHint, setDateHint] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ai = useAiTask();

  // 任务切换时同步本地状态
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTitle(task?.title ?? '');
    setNotes(task?.notes ?? '');
    setNotesPreview('');
    setBreakdownPreview(null);
    setDateHint('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailTaskId]);

  // debounce 提交标题和备注（400ms 无新输入后写入）
  useEffect(() => {
    if (!task) return;
    if (title === task.title && notes === task.notes) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateTask(task.id, { title, notes });
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, notes]);

  if (!task) return null;

  const currentTask = { ...task, title, notes };
  const currentStatus: KanbanStatus = task.completed ? 'done' : task.kanban === 'doing' ? 'doing' : 'todo';

  const handlePolishNotes = async () => {
    const result = await ai.polishNotes(currentTask);
    if (result) setNotesPreview(result.slice(0, 3000));
  };

  const handleCompleteNotes = async () => {
    const result = await ai.completeNotes(currentTask);
    if (result) setNotesPreview(result.slice(0, 3000));
  };

  const handleBreakdown = async () => {
    const result = await ai.breakdownTask(currentTask);
    if (result) setBreakdownPreview(result);
  };

  const replaceNotes = () => {
    setNotes(notesPreview);
    setNotesPreview('');
  };

  const appendNotes = () => {
    setNotes(prev => [prev.trim(), notesPreview.trim()].filter(Boolean).join('\n\n'));
    setNotesPreview('');
  };

  const confirmBreakdown = async () => {
    if (!breakdownPreview) return;
    for (const item of breakdownPreview.subtasks) {
      await createTask({
        title: item.title,
        notes: [item.notes, `来源任务：${title}`].filter(Boolean).join('\n'),
        projectId: item.projectId ?? task.projectId,
        dueDate: item.dueDate ?? task.dueDate,
        tags: item.tags,
      });
    }
    setBreakdownPreview(null);
  };

  /** 开始日期变更：不得晚于截止日期 */
  const handleStartDateChange = (v: string) => {
    const due = task.dueDate || '';
    if (v && due && v > due) {
      setDateHint('开始日期不能晚于截止日期');
      return;
    }
    setDateHint('');
    void updateTask(task.id, { startDate: v });
  };

  /** 截止日期变更：不得早于开始日期 */
  const handleDueDateChange = (v: string) => {
    const start = task.startDate || '';
    if (v && start && v < start) {
      setDateHint('截止日期不能早于开始日期');
      return;
    }
    setDateHint('');
    void updateTask(task.id, { dueDate: v });
  };

  return (
    <div className="modal-overlay open" onClick={closeDetail}>
    <div className="modal detail-modal" onClick={e => e.stopPropagation()}>
      <div className="detail-header">
        <span className="detail-header-title">任务详情</span>
        <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={() => deleteTask(task.id)}><Trash2 size={16} /></button>
      </div>
      <div className="detail-body">
        <input
          className="detail-title-input"
          value={title}
          onChange={e => setTitle(e.target.value)}
        />
        <div className="detail-ai-actions">
          <AiButton loading={ai.loading} onClick={handleBreakdown}>拆解任务</AiButton>
        </div>
        {breakdownPreview && (
          <div className="ai-panel">
            <div className="ai-panel-title">拆解预览</div>
            <div className="ai-subtask-list">
              {breakdownPreview.subtasks.map((item, index) => (
                <div key={`${item.title}-${index}`} className="ai-subtask-item">
                  <div className="ai-subtask-title">{item.title}</div>
                  <div className="ai-subtask-meta">
                    {item.dueDate || task.dueDate || '无日期'} · {TASK_TYPES.find(t => t.id === (item.projectId ?? task.projectId))?.name ?? '工作'}
                  </div>
                </div>
              ))}
            </div>
            <div className="ai-panel-actions">
              <button onClick={confirmBreakdown}>创建 {breakdownPreview.subtasks.length} 个任务</button>
              <button onClick={() => setBreakdownPreview(null)}>取消</button>
            </div>
          </div>
        )}
        {/* 任务类型 + 状态：合并一行 */}
        <div className="detail-field">
          <div className="detail-pair">
            <div className="detail-pair-item">
              <div className="detail-field-label">任务类型</div>
              <div className="detail-type-row">
                {TASK_TYPES.map(t => (
                  <span
                    key={t.id}
                    className={`detail-type-pill${task.projectId === t.id ? ' active' : ''}`}
                    style={task.projectId === t.id ? { background: t.color, borderColor: t.color } : {}}
                    onClick={() => updateTask(task.id, { projectId: t.id })}
                  >
                    <span>{TYPE_ICON_MAP[t.id]}</span>
                    <span>{t.name}</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="detail-pair-item">
              <div className="detail-field-label">状态</div>
              <div className="detail-type-row">
                {STATUS_OPTIONS.map(s => (
                  <span
                    key={s.id}
                    className={`detail-type-pill${currentStatus === s.id ? ' active' : ''}`}
                    style={currentStatus === s.id ? { background: s.color, borderColor: s.color } : {}}
                    onClick={() => {
                      if (s.id === currentStatus) return;
                      setDateHint('');
                      void setKanban(task.id, s.id);
                    }}
                  >
                    {s.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
        {/* 开始日期 + 截止日期：合并一行；进入「进行中」时自动记开始为当天，可手动修改 */}
        <div className="detail-field">
          <div className="detail-pair">
            <div className="detail-pair-item">
              <div className="detail-field-label">开始日期</div>
              <div className="detail-field-row detail-date-row">
                <span className="detail-field-icon"><Clock size={14} /></span>
                <DatePicker
                  value={task.startDate || ''}
                  onChange={(v) => handleStartDateChange(v)}
                  presets={START_DATE_PRESETS}
                  icon={false}
                  className="detail-date-trigger"
                />
                {task.startDate && (
                  <button
                    className="detail-date-clear"
                    title="清除开始日期"
                    onClick={e => { e.stopPropagation(); updateTask(task.id, { startDate: '' }); }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>
            <div className="detail-pair-item">
              <div className="detail-field-label">截止日期</div>
              <div className="detail-field-row detail-date-row">
                <span className="detail-field-icon"><CalendarDays size={14} /></span>
                <DatePicker
                  value={task.dueDate || ''}
                  onChange={(v) => handleDueDateChange(v)}
                  presets={DUE_DATE_PRESETS}
                  icon={false}
                  className="detail-date-trigger"
                />
                {task.dueDate && (
                  <button
                    className="detail-date-clear"
                    title="清除日期"
                    onClick={e => { e.stopPropagation(); updateTask(task.id, { dueDate: '' }); }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>
          {dateHint && <div className="detail-date-hint">{dateHint}</div>}
        </div>
        {/* 提醒设置区域 */}
        <div className="detail-field">
          <div className="detail-field-label">
            <Bell size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            提醒设置
          </div>
          <div className="detail-reminder-row">
            <div
              className={`detail-reminder-toggle${task.reminderEnabled ? ' active' : ''}`}
              onClick={() => updateTask(task.id, { reminderEnabled: !task.reminderEnabled })}
            >
              <div className={`reminder-toggle-track${task.reminderEnabled ? ' on' : ''}`}>
                <div className="reminder-toggle-thumb" />
              </div>
              <span>{task.reminderEnabled ? '已启用' : '已关闭'}</span>
            </div>
            {task.reminderEnabled && task.reminderAt && (
              <span className="detail-reminder-time">
                🔔 {formatDateTime(task.reminderAt)}
              </span>
            )}
            {task.reminderEnabled && task.recurrence?.type && task.recurrence.type !== 'none' && (
              <span className="detail-reminder-recurrence">
                {task.recurrence.type === 'daily' && '每天'}
                {task.recurrence.type === 'weekly' && '每周'}
                {task.recurrence.type === 'monthly' && '每月'}
                {task.recurrence.type === 'yearly' && '每年'}
              </span>
            )}
            <button
              className="detail-reminder-edit"
              onClick={() => setReminderPickerOpen(!reminderPickerOpen)}
            >
              {task.reminderAt ? '编辑' : '设置提醒'}
            </button>
          </div>
          {/* Snooze 按钮：已 snooze 时显示 */}
          {task.reminderEnabled && task.snoozedUntil && new Date(task.snoozedUntil) > new Date() && (
            <div className="detail-reminder-snooze">
              <span>稍后提醒：{formatDateTime(task.snoozedUntil)}</span>
              <button
                className="detail-reminder-snooze-clear"
                onClick={() => clearSnooze(task.id)}
              >
                取消稍后提醒
              </button>
            </div>
          )}
          {/* 快捷 snooze：已触发过提醒时显示 */}
          {task.reminderEnabled && task.lastNotifiedAt && !task.snoozedUntil && (
            <div className="detail-reminder-quick-snooze">
              <span>稍后提醒：</span>
              <button onClick={() => snoozeTask(task.id, 10)}>10分钟</button>
              <button onClick={() => snoozeTask(task.id, 60)}>1小时</button>
              <button onClick={() => {
                const t = new Date();
                t.setDate(t.getDate() + 1);
                t.setHours(9, 0, 0, 0);
                snoozeTask(task.id, Math.round((t.getTime() - Date.now()) / 60000));
              }}>明天</button>
            </div>
          )}
        </div>
        <ReminderDialog
          open={reminderPickerOpen}
          value={{
            reminderAt: task.reminderAt,
            reminderEnabled: task.reminderEnabled,
            reminderText: task.reminderText,
            recurrence: task.recurrence,
          }}
          onChange={(v) => {
            updateTask(task.id, {
              reminderAt: v.reminderAt,
              reminderEnabled: v.reminderEnabled,
              recurrence: v.recurrence,
              snoozedUntil: null,
              lastNotifiedAt: null,
            });
          }}
          onClose={() => setReminderPickerOpen(false)}
        />

        <div className="detail-field">
          <div className="detail-field-label">标签</div>
          <div className="detail-tags">
            {Object.entries(TAG_MAP).map(([key, info]) => (
              <span
                key={key}
                className={`detail-tag${task.tags.includes(key) ? ' active' : ''}`}
                onClick={() => toggleTag(task.id, key)}
              >
                {info.label}
              </span>
            ))}
          </div>
        </div>
        <div className="detail-field">
          <div className="detail-field-label">备注</div>
          <div className="detail-ai-actions">
            <AiButton loading={ai.loading} disabled={!notes.trim()} onClick={handlePolishNotes}>润色</AiButton>
            <AiButton loading={ai.loading} onClick={handleCompleteNotes}>补全</AiButton>
          </div>
          <textarea
            className="detail-notes"
            placeholder="添加备注..."
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
          {notesPreview && (
            <div className="ai-panel">
              <div className="ai-panel-title">备注预览</div>
              <div className="ai-notes-preview">{notesPreview}</div>
              <div className="ai-panel-actions">
                <button onClick={replaceNotes}>替换备注</button>
                <button onClick={appendNotes}>追加到备注</button>
                <button onClick={() => setNotesPreview('')}>取消</button>
              </div>
            </div>
          )}
          {ai.error && <div className="ai-error-text">{ai.error}</div>}
        </div>
      </div>
      <div className="detail-footer">
        <button className="detail-close-btn" onClick={closeDetail}>关闭</button>
      </div>
    </div>
    </div>
  );
}
