import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Briefcase, BookOpen, House, X } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { useTaskStore } from '../stores/task-store';
import { TASK_TYPES } from '../lib/types';
import type { RecurrenceRule } from '../lib/types';
import { ReminderDialog } from './ReminderDialog';
import { DatePicker } from './DatePicker';
import { formatDateTime } from '../lib/utils';

const TYPE_ICONS: Record<string, React.ReactNode> = {
  'project-work': <Briefcase size={13} />,
  'project-study': <BookOpen size={13} />,
  'project-life': <House size={13} />,
};

const MIN_HEIGHT = 48;
const MAX_HEIGHT = 360;
const DEFAULT_HEIGHT = 48;
const STORAGE_KEY = 'quick-add-composer-height';

function loadStoredHeight(): number {
  const stored = Number(localStorage.getItem(STORAGE_KEY));
  if (!Number.isFinite(stored) || stored < MIN_HEIGHT) return DEFAULT_HEIGHT;
  return Math.min(stored, MAX_HEIGHT);
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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

export function QuickAdd() {
  const { addTask, openDetail, currentSection, currentView, calendarSelectedDate } = useTaskStore();
  const defaultType = TASK_TYPES.find(t => t.id === currentSection)?.id || TASK_TYPES[0].id;
  const [selType, setSelType] = useState(defaultType);
  const [value, setValue] = useState('');
  const [dueDate, setDueDate] = useState(() => currentView === 'calendar' ? calendarSelectedDate : todayStr());
  const [composerHeight, setComposerHeight] = useState(() => loadStoredHeight());
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderAt, setReminderAt] = useState<string | null>(null);
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [recurrence, setRecurrence] = useState<RecurrenceRule | null>(null);
  const draggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const handle = async (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && value.trim()) {
      e.preventDefault();
      const text = value.trim();
      setValue('');
      const openAfter = e.metaKey || e.ctrlKey;
      await addTask(text, selType, dueDate, {
        reminderAt: reminderEnabled ? reminderAt : null,
        reminderEnabled,
        recurrence,
      });
      // 重置提醒设置
      setReminderAt(null);
      setReminderEnabled(false);
      setRecurrence(null);
      setReminderOpen(false);
      if (openAfter) {
        const task = useTaskStore.getState().tasks[0];
        if (task) openDetail(task.id);
      }
    }
  };

  useEffect(() => {
    if (currentView === 'calendar') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDueDate(calendarSelectedDate);
    }
  }, [calendarSelectedDate, currentView]);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    startYRef.current = e.clientY;
    startHeightRef.current = composerHeight;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }, [composerHeight]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const delta = startYRef.current - e.clientY;
      const next = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, startHeightRef.current + delta));
      setComposerHeight(next);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setComposerHeight(currentHeight => {
        localStorage.setItem(STORAGE_KEY, String(currentHeight));
        return currentHeight;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  return (
    <div className="quick-add">
      <div className="quick-add-inner">
        <div className="quick-add-row">
          <div className="quick-add-composer" style={{ height: composerHeight }}>
            <div className="quick-add-composer-resizer" onMouseDown={onDragStart} title="拖拽调整输入框高度">
              <span className="quick-add-resizer-grip" />
            </div>
            <textarea
              className="quick-add-input"
              placeholder="新建任务，按 Enter 添加...（Shift+Enter 换行）"
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={handle}
              rows={1}
            />
            <span className="quick-add-hint">
              <span className="kbd">Enter</span> 添加
              <span className="kbd">Ctrl</span>+<span className="kbd">Enter</span> 并打开
            </span>
          </div>
        </div>
        <div className="quick-add-types">
          {TASK_TYPES.map(t => (
            <button
              key={t.id}
              className={`qa-type-btn${selType === t.id ? ' active' : ''}`}
              style={selType === t.id ? { background: t.color, borderColor: t.color } : {}}
              onClick={() => setSelType(t.id)}
            >
              <span>{TYPE_ICONS[t.id]}</span>
              <span>{t.name}</span>
            </button>
          ))}
          <div className="quick-add-date">
            <DatePicker
              value={dueDate}
              onChange={setDueDate}
              presets={DUE_DATE_PRESETS}
              className="quick-add-date-trigger"
            />
            {dueDate && (
              <button
                type="button"
                className="quick-add-date-clear"
                title="清除日期"
                onClick={() => setDueDate('')}
              >
                <X size={13} />
              </button>
            )}
          </div>
          <button
            type="button"
            className={`quick-add-reminder-btn${reminderEnabled ? ' active' : ''}`}
            title={reminderEnabled && reminderAt ? formatDateTime(reminderAt) : '设置提醒'}
            onClick={() => setReminderOpen(!reminderOpen)}
          >
            <Bell size={14} />
            <span>{reminderEnabled && reminderAt ? formatDateTime(reminderAt) : '提醒'}</span>
          </button>
        </div>
      </div>
      <ReminderDialog
        open={reminderOpen}
        value={{
          reminderAt: reminderEnabled ? reminderAt : null,
          reminderEnabled,
          reminderText: null,
          recurrence,
        }}
        onChange={(v) => {
          setReminderAt(v.reminderAt);
          setReminderEnabled(v.reminderEnabled);
          setRecurrence(v.recurrence);
        }}
        onClose={() => setReminderOpen(false)}
      />
    </div>
  );
}
