import { useMemo, useRef, useState } from 'react';
import { Bot, Send, Sparkles, X } from 'lucide-react';
import { useTaskStore } from '../stores/task-store';
import { TAG_MAP, TASK_TYPES } from '../lib/types';
import { useAiTask } from '../hooks/useAiTask';
import type { AiTaskDraft, AiTaskPatchDraft } from '../lib/ai-json';
import { canUseAi } from '../lib/ai';
import { localDateStr } from '../lib/utils';
import type { Task } from '../lib/types';

const CHAT_POS_KEY = 'easysail-exam-chat-position';
const FAB_SIZE = 46;
const EDGE_PADDING = 16;
const PANEL_WIDTH = 360;
const PANEL_HEIGHT = 500;

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
}

export function AiChat() {
  const { tasks, currentSection, createTask, updateTask, detailTaskId } = useTaskStore();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 1, role: 'assistant', content: '可以问我今天要做什么；如果你直接说一件待办事项，我会自动记录成任务。' },
  ]);
  const [position, setPosition] = useState(() => readInitialPosition());
  const [dragging, setDragging] = useState(false);
  const [patchPreview, setPatchPreview] = useState<AiTaskPatchDraft | null>(null);
  const messageCounterRef = useRef(1);
  const nextMessageId = () => ++messageCounterRef.current;
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({
    pointerId: 0,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    moved: false,
  });
  const ai = useAiTask();

  const defaultProjectId = useMemo(
    () => TASK_TYPES.find(t => t.id === currentSection)?.id || TASK_TYPES[0].id,
    [currentSection]
  );
  const currentTask = useMemo(
    () => tasks.find(task => task.id === detailTaskId) ?? null,
    [tasks, detailTaskId]
  );

  const scrollToBottom = () => {
    window.setTimeout(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
    }, 0);
  };

  const clampPosition = (x: number, y: number) => {
    const maxX = Math.max(EDGE_PADDING, window.innerWidth - FAB_SIZE - EDGE_PADDING);
    const maxY = Math.max(EDGE_PADDING, window.innerHeight - FAB_SIZE - EDGE_PADDING);
    return {
      x: Math.min(Math.max(x, EDGE_PADDING), maxX),
      y: Math.min(Math.max(y, EDGE_PADDING), maxY),
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: position.x,
      originY: position.y,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!dragging || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    setPosition(clampPosition(drag.originX + dx, drag.originY + dy));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (drag.pointerId === e.pointerId) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      const finalPos = clampPosition(position.x, position.y);
      setPosition(finalPos);
      localStorage.setItem(CHAT_POS_KEY, JSON.stringify(finalPos));
    }
    window.setTimeout(() => setDragging(false), 0);
  };

  const toggleOpen = () => {
    if (dragRef.current.moved) {
      dragRef.current.moved = false;
      return;
    }
    setOpen(prev => !prev);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || ai.loading) return;
    const userMessage: ChatMessage = { id: nextMessageId(), role: 'user', content: text };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setPatchPreview(null);
    scrollToBottom();

    const result = await ai.chatWithTasks(text, tasks, defaultProjectId, currentTask);
    if (!result) {
      scrollToBottom();
      return;
    }

    let reply = result.reply;
    if (result.taskDraft) {
      const task = await createTaskFromDraft(result.taskDraft);
      reply = task
        ? `${result.reply}\n\n已自动创建任务：${result.taskDraft.title}`
        : `${result.reply}\n\n任务创建失败，请稍后重试。`;
    }
    if (result.taskPatch) {
      setPatchPreview(result.taskPatch);
    }

    setMessages(prev => [...prev, {
      id: Date.now() + 1,
      role: 'assistant',
      content: reply,
    }]);
    scrollToBottom();
  };

  const createTaskFromDraft = async (draft: AiTaskDraft) => {
    const notes = [draft.notes, draft.dueTimeText ? `时间：${draft.dueTimeText}` : '']
      .filter(Boolean)
      .join('\n');
    return createTask({
      title: draft.title,
      notes,
      projectId: draft.projectId ?? defaultProjectId,
      dueDate: draft.dueDate,
      tags: draft.tags,
      reminderAt: draft.reminderAt,
      reminderEnabled: !!draft.reminderAt,
      recurrence: draft.recurrence,
    });
  };

  const applyPatchPreview = async () => {
    if (!patchPreview) return;
    const updates = buildTaskUpdates(patchPreview);
    await updateTask(patchPreview.taskId, updates);
    const task = tasks.find(t => t.id === patchPreview.taskId);
    setMessages(prev => [...prev, {
      id: Date.now(),
      role: 'assistant',
      content: `已应用修改：${task?.title ?? `任务 ${patchPreview.taskId}`}`,
    }]);
    setPatchPreview(null);
    scrollToBottom();
  };

  const previewTask = patchPreview ? tasks.find(task => task.id === patchPreview.taskId) : null;

  const panelStyle = getPanelStyle(position);

  return (
    <div
      className={`ai-chat${open ? ' open' : ''}${dragging ? ' dragging' : ''}`}
      style={{ left: position.x, top: position.y }}
    >
      {open && (
        <div className="ai-chat-panel" style={panelStyle}>
          <div className="ai-chat-header">
            <div className="ai-chat-title"><Bot size={17} /> AI 助手</div>
            <button className="icon-btn compact" onClick={() => setOpen(false)}><X size={15} /></button>
          </div>
          {currentTask && (
            <div className="ai-chat-context">
              当前任务：{currentTask.title}
            </div>
          )}
          <div ref={listRef} className="ai-chat-messages">
            {messages.map(message => (
              <div key={message.id} className={`ai-chat-message ${message.role}`}>
                {message.content}
              </div>
            ))}
            {ai.loading && <div className="ai-chat-message assistant muted">正在思考...</div>}
            {ai.error && <div className="ai-chat-error">{ai.error}</div>}
          </div>
          {patchPreview && previewTask && (
            <div className="ai-chat-draft">
              <div className="ai-panel-title">修改预览</div>
              <div className="ai-chat-draft-title">{previewTask.title}</div>
              <div className="ai-patch-list">
                {renderPatchRows(previewTask, patchPreview)}
              </div>
              <div className="ai-chat-draft-notes">{patchPreview.reason}</div>
              <div className="ai-panel-actions">
                <button onClick={applyPatchPreview}>应用修改</button>
                <button onClick={() => setPatchPreview(null)}>取消</button>
              </div>
            </div>
          )}
          <div className="ai-chat-input-row">
            <input
              value={input}
              placeholder={canUseAi() ? '输入问题或任务...' : '在设置中开启并配置 AI'}
              disabled={!canUseAi()}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button disabled={!canUseAi() || !input.trim() || ai.loading} onClick={send}>
              <Send size={15} />
            </button>
          </div>
        </div>
      )}
      <button
        className="ai-chat-fab"
        onClick={toggleOpen}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        title="AI 助手"
      >
        {open ? <X size={20} /> : <Sparkles size={20} />}
      </button>
    </div>
  );
}

function readInitialPosition() {
  const fallback = {
    x: Math.max(EDGE_PADDING, window.innerWidth - FAB_SIZE - 22),
    y: Math.max(EDGE_PADDING, window.innerHeight - FAB_SIZE - 92),
  };

  try {
    const saved = JSON.parse(localStorage.getItem(CHAT_POS_KEY) || 'null');
    if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
      return {
        x: Math.min(Math.max(saved.x, EDGE_PADDING), Math.max(EDGE_PADDING, window.innerWidth - FAB_SIZE - EDGE_PADDING)),
        y: Math.min(Math.max(saved.y, EDGE_PADDING), Math.max(EDGE_PADDING, window.innerHeight - FAB_SIZE - EDGE_PADDING)),
      };
    }
  } catch {
    // ignore invalid saved position
  }

  return fallback;
}

function getPanelStyle(position: { x: number; y: number }): React.CSSProperties {
  const spaceRight = window.innerWidth - position.x - FAB_SIZE;
  const spaceBottom = window.innerHeight - position.y - FAB_SIZE;
  const left = spaceRight >= PANEL_WIDTH + 12
    ? FAB_SIZE + 12
    : Math.min(0, window.innerWidth - position.x - PANEL_WIDTH - EDGE_PADDING);
  const top = spaceBottom >= PANEL_HEIGHT + 12
    ? FAB_SIZE + 12
    : Math.min(0, window.innerHeight - position.y - PANEL_HEIGHT - EDGE_PADDING);

  return { left, top };
}

const KANBAN_LABELS: Record<string, string> = {
  todo: '待完成',
  doing: '进行中',
  done: '已完成',
};

function buildTaskUpdates(patch: AiTaskPatchDraft): Partial<Task> {
  const updates: Partial<Task> = {};
  if (patch.title !== undefined) updates.title = patch.title;
  if (patch.notes !== undefined) updates.notes = patch.notes;
  if ('dueDate' in patch) updates.dueDate = patch.dueDate ?? null;
  if (patch.projectId !== undefined) updates.projectId = patch.projectId;
  if (patch.tags !== undefined) updates.tags = patch.tags;
  if (patch.starred !== undefined) updates.starred = patch.starred;
  if (patch.completed !== undefined) {
    updates.completed = patch.completed;
    updates.completedAt = patch.completed ? new Date().toISOString() : null;
    updates.kanban = patch.completed ? 'done' : 'todo';
  }
  if (patch.kanban !== undefined) {
    updates.kanban = patch.kanban;
    updates.completed = patch.kanban === 'done';
    updates.completedAt = patch.kanban === 'done' ? new Date().toISOString() : null;
    if (patch.kanban === 'doing') updates.startDate = localDateStr();
  }
  return updates;
}

function renderPatchRows(task: Task, patch: AiTaskPatchDraft) {
  const rows: React.ReactNode[] = [];
  const projectName = (id: string) => TASK_TYPES.find(type => type.id === id)?.name ?? id;
  const tagNames = (tags: string[]) => tags.map(tag => TAG_MAP[tag]?.label ?? tag).join('、') || '无';

  const push = (label: string, before: string, after: string) => {
    rows.push(
      <div key={label} className="ai-patch-row">
        <span className="ai-patch-label">{label}</span>
        <span className="ai-patch-before">{before}</span>
        <span className="ai-patch-arrow">→</span>
        <span className="ai-patch-after">{after}</span>
      </div>
    );
  };

  if (patch.title !== undefined) push('标题', task.title, patch.title);
  if (patch.notes !== undefined) push('备注', task.notes || '空', patch.notes || '空');
  if ('dueDate' in patch) push('日期', task.dueDate || '无', patch.dueDate || '无');
  if (patch.projectId !== undefined) push('类型', projectName(task.projectId), projectName(patch.projectId));
  if (patch.tags !== undefined) push('标签', tagNames(task.tags), tagNames(patch.tags));
  if (patch.starred !== undefined) push('星标', task.starred ? '是' : '否', patch.starred ? '是' : '否');
  if (patch.completed !== undefined) push('完成', task.completed ? '是' : '否', patch.completed ? '是' : '否');
  if (patch.kanban !== undefined) push('看板', KANBAN_LABELS[task.kanban] ?? task.kanban, KANBAN_LABELS[patch.kanban] ?? patch.kanban);

  return rows;
}
