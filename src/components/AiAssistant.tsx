import { useMemo, useRef, useState } from 'react';
import { Bot, Send, Sparkles, Search, BarChart3, HelpCircle } from 'lucide-react';
import { useTaskStore } from '../stores/task-store';
import type { CreateTaskInput } from '../stores/task-store';
import { useAiTask } from '../hooks/useAiTask';
import { canUseAi } from '../lib/ai';
import { TASK_TYPES } from '../lib/types';

interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
}

const QUICK_ACTIONS = [
  { key: 'tasks', label: '任务查询', icon: Search, prompt: '帮我查询最近的待办任务' },
  { key: 'stats', label: '数据统计', icon: BarChart3, prompt: '查看任务数据统计' },
  { key: 'help', label: '使用帮助', icon: HelpCircle, prompt: '这个应用怎么用？' },
];

export function AiAssistant() {
  const { tasks, currentSection, createTask } = useTaskStore();
  const ai = useAiTask();
  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const counterRef = useRef(0);

  const defaultProjectId = useMemo(() => {
    return TASK_TYPES.find(t => t.id === currentSection)?.id || TASK_TYPES[0].id;
  }, [currentSection]);

  const handleSend = async (text: string) => {
    if (!text.trim() || ai.loading) return;
    const userMsg: Message = { id: ++counterRef.current, role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setExpanded(true);

    const result = await ai.chatWithTasks(text, tasks, defaultProjectId);
    if (!result) return;

    let reply = result.reply;
    if (result.taskDraft) {
      const draft = result.taskDraft;
      const notes = [draft.notes, draft.dueTimeText ? `时间：${draft.dueTimeText}` : ''].filter(Boolean).join('\n');
      const task = await createTask({
        title: draft.title,
        notes,
        projectId: draft.projectId ?? defaultProjectId,
        dueDate: draft.dueDate,
        tags: draft.tags,
        reminderAt: draft.reminderAt,
        reminderEnabled: !!draft.reminderAt,
        recurrence: draft.recurrence,
      } as CreateTaskInput);
      reply = task
        ? `${reply}\n\n已自动创建任务：${draft.title}${draft.reminderAt ? '（含提醒）' : ''}`
        : `${reply}\n\n任务创建失败，请稍后重试。`;
    }

    setMessages(prev => [...prev, { id: ++counterRef.current, role: 'assistant', content: reply }]);
  };

  const newChat = () => {
    setMessages([]);
    setInput('');
    setExpanded(false);
  };

  const disabled = !canUseAi() || ai.loading;

  return (
    <div className="ai-assistant">
      <div className="ai-assistant-header">
        <div className="ai-assistant-title"><Bot size={17} /> AI 助手</div>
        {expanded && (
          <button className="ai-assistant-new" onClick={newChat}>新建对话</button>
        )}
      </div>
      {!expanded ? (
        <div className="ai-assistant-welcome">
          <div className="ai-assistant-avatar"><Sparkles size={24} /></div>
          <div className="ai-assistant-greeting">嗨！尽管吩咐</div>
          <div className="ai-assistant-subtitle">既能问答查询，也能一句话创建任务，基于本地数据快速响应。</div>
          <div className="ai-assistant-input-row">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={canUseAi() ? '提问，或直接说要创建的任务' : '在设置中开启并配置 AI'}
              disabled={disabled}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(input); } }}
            />
            <button disabled={disabled || !input.trim()} onClick={() => handleSend(input)}><Send size={15} /></button>
          </div>
          <div className="ai-assistant-quick">
            {QUICK_ACTIONS.map(a => (
              <button key={a.key} className="ai-assistant-quick-btn" disabled={disabled} onClick={() => handleSend(a.prompt)}>
                <a.icon size={14} /> {a.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="ai-assistant-chat">
          <div className="ai-assistant-messages">
            {messages.map(m => (
              <div key={m.id} className={`ai-assistant-message ${m.role}`}>{m.content}</div>
            ))}
            {ai.loading && <div className="ai-assistant-message assistant muted">正在思考...</div>}
            {ai.error && <div className="ai-assistant-error">{ai.error}</div>}
          </div>
          <div className="ai-assistant-input-row">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={canUseAi() ? '继续提问或安排任务...' : '在设置中开启并配置 AI'}
              disabled={disabled}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(input); } }}
            />
            <button disabled={disabled || !input.trim()} onClick={() => handleSend(input)}><Send size={15} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
