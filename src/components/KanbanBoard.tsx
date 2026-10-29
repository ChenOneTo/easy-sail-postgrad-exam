import { memo, useMemo, useState } from 'react';
import { CalendarDays, Pause, Play, Clock } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useTaskStore } from '../stores/task-store';
import type { Task, KanbanStatus } from '../lib/types';
import { TAG_MAP, TASK_TYPES } from '../lib/types';
import { formatDate, filterTasksByRange, searchTasks, localDateStr } from '../lib/utils';
import type { StatRange } from '../lib/utils';
import { TYPE_ICON_MAP } from './TaskRow';

const COLUMNS: { key: KanbanStatus; label: string; dot: string }[] = [
  { key: 'todo', label: '待完成', dot: 'todo' },
  { key: 'doing', label: '进行中', dot: 'doing' },
  { key: 'done', label: '已完成', dot: 'done' },
];

const KanbanCard = memo(function KanbanCard({ task }: { task: Task }) {
  const { toggleTask, openDetail, startTask, pauseTask } = useTaskStore(
    useShallow(s => ({ toggleTask: s.toggleTask, openDetail: s.openDetail, startTask: s.startTask, pauseTask: s.pauseTask }))
  );
  const typeInfo = TASK_TYPES.find(t => t.id === task.projectId);
  const isDoing = task.kanban === 'doing' && !task.completed;

  return (
    <div className={`kanban-card${isDoing ? ' doing' : ''}`} onClick={() => openDetail(task.id)}>
      <div
        className={`checkbox${task.completed ? ' checked' : ''}`}
        onClick={e => { e.stopPropagation(); toggleTask(task.id); }}
      />
      <div className="kanban-card-body">
        <div className="kanban-card-title">{task.title}</div>
        <div className="kanban-card-meta">
          {typeInfo && (
            <span className="task-type-badge" style={{ '--type-color': typeInfo.color } as React.CSSProperties}>
              {TYPE_ICON_MAP[typeInfo.id]} {typeInfo.name}
            </span>
          )}
          {task.tags.map(tag => {
            const info = TAG_MAP[tag];
            return info ? <span key={tag} className={`tag ${info.class}`}>{info.label}</span> : null;
          })}
          {task.dueDate && (
            <span className="kanban-card-date">
              <CalendarDays size={11} />
              {formatDate(task.dueDate)}
            </span>
          )}
          {isDoing && task.startDate && (
            <span className="kanban-card-date doing-time">
              <Clock size={11} />
              开始 {formatDate(task.startDate)}
            </span>
          )}
        </div>
      </div>
      {!task.completed && (
        isDoing ? (
          <button className="btn-start" title="暂停" onClick={e => { e.stopPropagation(); pauseTask(task.id); }}><Pause size={14} /></button>
        ) : (
          <button className="btn-start" title="开始" onClick={e => { e.stopPropagation(); void startTask(task.id); }}><Play size={14} /></button>
        )
      )}
    </div>
  );
});

const RANGE_TABS: { key: StatRange; label: string }[] = [
  { key: 'today', label: '今日' },
  { key: 'week', label: '本周' },
  { key: 'month', label: '本月' },
  { key: 'quarter', label: '本季度' },
  { key: 'year', label: '本年' },
];

export function KanbanBoard() {
  const { tasks, searchQuery } = useTaskStore(
    useShallow(s => ({ tasks: s.tasks, searchQuery: s.searchQuery }))
  );
  const [statRange, setStatRange] = useState<StatRange>('month');
  const today = localDateStr();

  const rangeTasks = useMemo(() => filterTasksByRange(tasks, statRange), [tasks, statRange]);
  const filteredTasks = useMemo(() => searchTasks(rangeTasks, searchQuery), [rangeTasks, searchQuery]);

  const stats = useMemo(() => {
    let done = 0, pending = 0, overdue = 0, doing = 0;
    for (const t of rangeTasks) {
      if (t.completed) done++;
      else {
        pending++;
        if (t.kanban === 'doing') doing++;
        if (t.dueDate && t.dueDate < today) overdue++;
      }
    }
    const total = done + pending;
    return { done, pending, overdue, doing, total, pct: total > 0 ? Math.round(done / total * 100) : 0 };
  }, [rangeTasks, today]);

  const columns = useMemo(() => {
    return COLUMNS.map(col => {
      let tasks = filteredTasks.filter(t => t.kanban === col.key);
      // 进行中列按开始日期倒序（最近开始的在前）
      if (col.key === 'doing') {
        tasks = [...tasks].sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''));
      }
      return { ...col, tasks };
    });
  }, [filteredTasks]);

  return (
    <div className="kanban-board">
      <div className="cal-stats-bar">
        <div className="cal-stats-left">
          <div className="cal-stat-pill"><span className="cal-stat-num">{stats.total}</span><span className="cal-stat-text">总任务</span></div>
          <div className="cal-stat-pill"><span className="cal-stat-num green">{stats.done}</span><span className="cal-stat-text">已完成</span></div>
          <div className="cal-stat-pill"><span className="cal-stat-num purple">{stats.doing}</span><span className="cal-stat-text">进行中</span></div>
          <div className="cal-stat-pill"><span className="cal-stat-num blue">{stats.pending}</span><span className="cal-stat-text">待完成</span></div>
          <div className="cal-stat-pill"><span className="cal-stat-num red">{stats.overdue}</span><span className="cal-stat-text">已逾期</span></div>
        </div>
        <div className="cal-stats-right">
          <div className="cal-stats-tabs">
            {RANGE_TABS.map(tab => (
              <button key={tab.key} className={`cal-stats-tab${statRange === tab.key ? ' active' : ''}`} onClick={() => setStatRange(tab.key)}>{tab.label}</button>
            ))}
          </div>
          <div className="cal-progress-bar"><div className="cal-progress-fill" style={{ width: `${stats.pct}%` }} /></div>
          <span className="cal-progress-value">{stats.pct}%</span>
        </div>
      </div>
      <div className="kanban-columns">
        {columns.map(col => (
          <div key={col.key} className="kanban-column">
            <div className="kanban-col-header">
              <span className={`kanban-col-dot ${col.dot}`} />
              <span className="kanban-col-title">{col.label}</span>
              <span className="kanban-col-count">{col.tasks.length}</span>
            </div>
            <div className="kanban-cards">
              {col.tasks.map(t => (
                <KanbanCard key={t.id} task={t} />
              ))}
              {col.tasks.length === 0 && (
                <div className="kanban-col-empty">暂无任务</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
