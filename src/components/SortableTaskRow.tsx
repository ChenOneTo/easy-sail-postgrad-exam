import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Task } from '../lib/types';
import { TaskRow } from './TaskRow';

/** 可拖拽的 TaskRow 包装：用 dnd-kit 把整行变成 sortable 项，拖拽柄为 .drag-handle。 */
export function SortableTaskRow({ task }: { task: Task }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        ...(isDragging ? { opacity: 0.5, zIndex: 50 } : {}),
      }}
      {...attributes}
    >
      {/* 拖拽事件绑定到拖拽柄，避免点击行触发拖拽 */}
      <div className="sortable-row-inner">
        <span className="drag-handle" {...listeners}>⋮⋮</span>
        <TaskRow task={task} />
      </div>
    </div>
  );
}
