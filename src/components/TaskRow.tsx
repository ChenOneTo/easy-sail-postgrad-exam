import { memo } from 'react';
import { CalendarDays, Trash2, Play, Pause, Clock } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useTaskStore } from '../stores/task-store';
import type { Task } from '../lib/types';
import { TAG_MAP, TASK_TYPES } from '../lib/types';
import { formatDate, getDateClass } from '../lib/utils';
import { TaskTypeIcon } from './TaskTypeIcon';

export const TaskRow = memo(function TaskRow({ task }: { task: Task }) {
  const { toggleTask, deleteTask, openDetail, startTask, pauseTask } = useTaskStore(
    useShallow(s => ({ toggleTask: s.toggleTask, deleteTask: s.deleteTask, openDetail: s.openDetail, startTask: s.startTask, pauseTask: s.pauseTask }))
  );
  const dc = task.dueDate ? getDateClass(task.dueDate, task.completed) : '';
  const dl = task.dueDate ? formatDate(task.dueDate) : '';
  const typeInfo = TASK_TYPES.find(t => t.id === task.projectId);
  const isDoing = task.kanban === 'doing' && !task.completed;

  return (
    <div className={`task-row${task.completed ? ' completed' : ''}${isDoing ? ' doing' : ''} animate-in`} onClick={() => openDetail(task.id)}>
      <div
        className={`checkbox${task.completed ? ' checked' : ''}`}
        onClick={e => { e.stopPropagation(); toggleTask(task.id); }}
      />
      <div className="task-content">
        <div className="task-title">{task.title}</div>
        {(dl || task.tags.length > 0 || typeInfo || isDoing) && (
          <div className="task-meta">
            {typeInfo && <span className="task-type-badge" style={{ '--type-color': typeInfo.color } as React.CSSProperties}><TaskTypeIcon typeId={typeInfo.id} /> {typeInfo.name}</span>}
            {dl && <span className={`task-date ${dc}`}><CalendarDays size={13} /> {dl}</span>}
            {isDoing && task.startDate && <span className="task-date today"><Clock size={13} /> 开始 {formatDate(task.startDate)}</span>}
            {task.tags.map(tag => {
              const info = TAG_MAP[tag];
              return info ? <span key={tag} className={`tag ${info.class}`}>{info.label}</span> : null;
            })}
            {isDoing && <span className="badge-doing">进行中</span>}
          </div>
        )}
      </div>
      <div className="task-actions">
        {!task.completed && (
          isDoing ? (
            <button className="btn-start" title="暂停" onClick={e => { e.stopPropagation(); pauseTask(task.id); }}><Pause size={15} /></button>
          ) : (
            <button className="btn-start" title="开始" onClick={e => { e.stopPropagation(); void startTask(task.id); }}><Play size={15} /></button>
          )
        )}
        <button className="btn-delete" onClick={e => { e.stopPropagation(); deleteTask(task.id); }}><Trash2 size={15} /></button>
      </div>
    </div>
  );
});
