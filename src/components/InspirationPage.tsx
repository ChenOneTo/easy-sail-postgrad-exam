import { useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Lightbulb, Sparkles, Trash2, ListTodo, Check, Wand2 } from 'lucide-react';
import { useInspirationStore } from '../stores/inspiration-store';
import { useTaskStore } from '../stores/task-store';
import { useAiTask } from '../hooks/useAiTask';
import { canUseAi } from '../lib/ai';
import { formatDateTime, localDateStr } from '../lib/utils';
import type { Inspiration } from '../lib/types';

function InspirationCard({ item }: { item: Inspiration }) {
  const { update, remove } = useInspirationStore();
  const createTask = useTaskStore(s => s.createTask);
  const setSection = useTaskStore(s => s.setSection);
  const setView = useTaskStore(s => s.setView);
  const ai = useAiTask();
  const [polishing, setPolishing] = useState(false);
  const [converting, setConverting] = useState(false);
  const [converted, setConverted] = useState(false);
  const [showPolished, setShowPolished] = useState(false);

  const handlePolish = async () => {
    if (polishing) return;
    setPolishing(true);
    const result = await ai.polishInspiration(item.content);
    setPolishing(false);
    if (result) {
      await update(item.id, {
        title: result.title,
        tags: result.tags,
        polished: result.polished,
      });
      setShowPolished(true);
    }
  };

  const handleConvert = async () => {
    if (converting || converted) return;
    setConverting(true);
    let ok = false;
    if (canUseAi()) {
      const draft = await ai.parseQuickAdd(item.content, 'project-work');
      if (draft) {
        const created = await createTask({
          title: draft.title,
          notes: draft.notes || item.polished || '',
          projectId: draft.projectId ?? 'project-work',
          dueDate: draft.dueDate ?? localDateStr(),
          tags: draft.tags,
          reminderAt: draft.reminderAt,
          reminderEnabled: !!draft.reminderAt,
          recurrence: draft.recurrence,
        });
        ok = !!created;
      }
    } else {
      const created = await createTask({
        title: item.title || item.content.slice(0, 80),
        notes: item.polished || item.content,
        projectId: 'project-work',
        dueDate: localDateStr(),
      });
      ok = !!created;
    }
    setConverting(false);
    if (ok) {
      setConverted(true);
      setTimeout(() => setConverted(false), 2000);
      // 导航到「工作」项目，让用户立刻看到新建的任务
      setView('calendar');
      setSection('project-work');
    }
  };

  return (
    <div className="inspiration-card">
      <div className="inspiration-card-main">
        {item.title && <div className="inspiration-card-title">{item.title}</div>}
        <div className="inspiration-card-content">{item.content}</div>
        {item.tags.length > 0 && (
          <div className="inspiration-card-tags">
            {item.tags.map(tag => (
              <span key={tag} className="inspiration-tag">{tag}</span>
            ))}
          </div>
        )}
        {showPolished && item.polished && (
          <div className="inspiration-card-polished">{item.polished}</div>
        )}
        {item.polished && (
          <button
            type="button"
            className="inspiration-toggle-polished"
            onClick={() => setShowPolished(v => !v)}
          >
            {showPolished ? '收起润色' : '展开润色'}
          </button>
        )}
      </div>
      <div className="inspiration-card-footer">
        <span className="inspiration-card-time">{formatDateTime(item.createdAt)}</span>
        <div className="inspiration-card-actions">
          {canUseAi() && (
            <button
              type="button"
              className="inspiration-action-btn"
              title="AI 润色：提炼标题、标签并扩写"
              disabled={polishing}
              onClick={handlePolish}
            >
              <Wand2 size={13} className={polishing ? 'inspiration-spin' : undefined} />
              {polishing ? '润色中' : 'AI 润色'}
            </button>
          )}
          <button
            type="button"
            className={`inspiration-action-btn${converted ? ' success' : ''}`}
            title="转为任务"
            disabled={converting || converted}
            onClick={handleConvert}
          >
            {converted ? <Check size={13} /> : <ListTodo size={13} />}
            {converted ? '已转任务' : converting ? '转换中' : '转任务'}
          </button>
          <button
            type="button"
            className="inspiration-action-btn danger"
            title="删除"
            onClick={() => remove(item.id)}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      {ai.error && <div className="inspiration-card-error">{ai.error}</div>}
    </div>
  );
}

export function InspirationPage() {
  const { inspirations, loaded, load, add } = useInspirationStore();
  const ai = useAiTask();
  const [value, setValue] = useState('');
  const [ideas, setIdeas] = useState<string[]>([]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (text?: string) => {
    const content = (text ?? value).trim();
    if (!content) return;
    await add(content);
    if (!text) setValue('');
    setIdeas([]);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
  };

  const handleBrainstorm = async () => {
    const input = value.trim();
    if (!input || ai.loading) return;
    const result = await ai.brainstormInspiration(input);
    if (result) setIdeas(result.ideas);
  };

  return (
    <div className="inspiration-page">
      <div className="inspiration-header">
        <h2>
          <Lightbulb size={18} />
          灵感
        </h2>
        <span className="inspiration-count">{inspirations.length} 条</span>
      </div>

      <div className="inspiration-composer">
        <textarea
          className="inspiration-input"
          placeholder="用一句话记录此刻的灵感...（Enter 保存，Shift+Enter 换行）"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
        />
        <div className="inspiration-composer-bar">
          <span className="inspiration-composer-hint">
            {canUseAi() ? '输入后可点击「AI 联想」发散更多想法' : '在设置中开启 AI 后，可使用联想与润色'}
          </span>
          {canUseAi() && (
            <button
              type="button"
              className="inspiration-ai-btn"
              disabled={!value.trim() || ai.loading}
              onClick={handleBrainstorm}
            >
              <Sparkles size={13} className={ai.loading ? 'inspiration-spin' : undefined} />
              {ai.loading ? '联想中...' : 'AI 联想'}
            </button>
          )}
          <button
            type="button"
            className="inspiration-save-btn"
            disabled={!value.trim()}
            onClick={() => handleSave()}
          >
            记录
          </button>
        </div>
        {ai.error && <div className="inspiration-error">{ai.error}</div>}
        {ideas.length > 0 && (
          <div className="inspiration-ideas">
            {ideas.map((idea, i) => (
              <button
                key={i}
                type="button"
                className="inspiration-idea-chip"
                title="点击保存为灵感"
                onClick={() => handleSave(idea)}
              >
                <Sparkles size={12} />
                {idea}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="inspiration-list">
        {!loaded && <div className="inspiration-empty">加载中...</div>}
        {loaded && inspirations.length === 0 && (
          <div className="inspiration-empty">
            <Lightbulb size={32} />
            <p>还没有灵感</p>
            <span>灵光一现的想法，用一句话记下来</span>
          </div>
        )}
        {inspirations.map(item => (
          <InspirationCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}
