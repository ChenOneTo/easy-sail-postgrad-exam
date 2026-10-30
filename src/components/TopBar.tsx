import { useEffect, useRef, useState } from 'react';
import { Search, Moon, Sun, Calendar, X, GripVertical, Bot, Columns3, Bell } from 'lucide-react';
import { useTaskStore } from '../stores/task-store';
import { useReminderHistoryStore } from '../stores/reminder-history-store';
import { DailyQuote } from './DailyQuote';
import type { ViewMode, SectionId } from '../lib/types';

const TITLES: Record<SectionId, string> = {
  inbox: '首页', today: '今天', ai: 'AI 助手', review: '复盘',
  'project-work': '工作', 'project-study': '学习', 'project-life': '生活',
  'tag-urgent': '紧急', 'tag-important': '重要',
  exam: '考研计划', 'exam-vocab': '背单词', 'exam-vocab-game': '单词闯关',
};

const VIEW_MAP: Record<ViewMode, { label: string; icon: React.ReactNode }> = {
  calendar: { label: '日历', icon: <Calendar size={14} /> },
  kanban: { label: '看板', icon: <Columns3 size={14} /> },
  ai: { label: 'AI', icon: <Bot size={14} /> },
};

export function TopBar({ onOpenNotifications }: { onOpenNotifications?: () => void }) {
  const { currentSection, currentView, setView, theme, setTheme, searchQuery, setSearchQuery, viewOrder, setViewOrder } = useTaskStore();
  const unreadCount = useReminderHistoryStore((s) => s.records.filter((r) => !r.read && !r.dismissed).length);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  // ⌘K / Ctrl+K 快捷键聚焦搜索框
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
      // Escape 清空搜索
      if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        setSearchQuery('');
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setSearchQuery]);

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    // Tauri WebView2 要求必须设置 dataTransfer 数据，否则拖拽不启动
    e.dataTransfer.setData('text/plain', String(idx));
    e.dataTransfer.effectAllowed = 'move';
    setDragIdx(idx);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setOverIdx(idx);
  };

  const handleDrop = (idx: number) => {
    if (dragIdx !== null && dragIdx !== idx) {
      const newOrder = [...viewOrder];
      const [moved] = newOrder.splice(dragIdx, 1);
      newOrder.splice(idx, 0, moved);
      setViewOrder(newOrder);
    }
    setDragIdx(null);
    setOverIdx(null);
  };

  const handleDragEnd = () => {
    setDragIdx(null);
    setOverIdx(null);
  };

  const hideChrome = currentView === 'ai' || currentSection === 'review' || currentSection === 'exam' || currentSection === 'exam-vocab' || currentSection === 'exam-vocab-game';

  return (
    <header className="topbar">
      <div className="topbar-left">
        <h2 className="topbar-title">{TITLES[currentSection]}</h2>
        {!hideChrome && (
          <div className="view-switcher">
            {viewOrder.map((viewId, idx) => {
              const v = VIEW_MAP[viewId];
              if (!v) return null;
              return (
                <div
                  key={viewId}
                  className={`view-btn-wrap${dragIdx === idx ? ' dragging' : ''}${overIdx === idx && dragIdx !== idx ? ' drag-over' : ''}`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDrop={() => handleDrop(idx)}
                  onDragEnd={handleDragEnd}
                >
                  <span className="view-drag-handle"><GripVertical size={12} /></span>
                  <button
                    className={`view-btn${currentView === viewId ? ' active' : ''}`}
                    onClick={() => setView(viewId)}
                  >
                    {v.icon} {v.label}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <DailyQuote />
      </div>
      <div className="topbar-right">
        {!hideChrome && (
          <div className="search-box">
            <span className="search-icon"><Search size={14} /></span>
            <input
              ref={inputRef}
              type="text"
              placeholder="搜索任务..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                className="search-clear"
                onClick={() => { setSearchQuery(''); inputRef.current?.focus(); }}
                title="清除搜索"
              >
                <X size={14} />
              </button>
            )}
            {!searchQuery && <span className="search-shortcut">⌘K</span>}
          </div>
        )}
        {onOpenNotifications && (
          <button
            className="icon-btn notification-bell-btn"
            onClick={onOpenNotifications}
            title="通知中心"
            style={{ position: 'relative' }}
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className="notification-bell-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
            )}
          </button>
        )}
        <button className="icon-btn" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </header>
  );
}
