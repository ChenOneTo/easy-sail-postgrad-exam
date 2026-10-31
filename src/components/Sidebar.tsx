import { useMemo } from 'react';
import { Home, Settings, Bot, Bell, GraduationCap, BookOpen, Swords, Newspaper } from 'lucide-react';
import { useTaskStore } from '../stores/task-store';
import { TASK_TYPES } from '../lib/types';
import type { SectionId } from '../lib/types';
import { useReminderHistoryStore } from '../stores/reminder-history-store';

const KNOWN_TYPE_IDS = TASK_TYPES.map(t => t.id);

interface NavItem { id: SectionId; label: string; icon: React.ReactNode; }

interface NavGroup { title?: string; items: NavItem[]; }

const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { id: 'inbox', label: '首页', icon: <Home size={16} /> },
      { id: 'ai', label: 'AI 助手', icon: <Bot size={16} /> },
    ],
  },
  {
    title: '学习计划',
    items: [
      { id: 'exam', label: '考研计划', icon: <GraduationCap size={16} /> },
    ],
  },
  {
    title: '考研英语',
    items: [
      { id: 'exam-vocab', label: '背单词', icon: <BookOpen size={16} /> },
      { id: 'exam-vocab-game', label: '单词闯关', icon: <Swords size={16} /> },
      { id: 'exam-reading', label: '阅读刷题', icon: <Newspaper size={16} /> },
    ],
  },
];

const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap(g => g.items);

function getCount(tasks: ReturnType<typeof useTaskStore.getState>['tasks'], s: SectionId): number {
  switch (s) {
    case 'inbox': return tasks.filter(t => !t.completed).length;
    case 'project-work':
    case 'project-study':
    case 'project-life':
      return tasks.filter(t => t.projectId === s || !KNOWN_TYPE_IDS.includes(t.projectId)).length;
    default: return 0;
  }
}

export function Sidebar({ onOpenSettings, onOpenNotifications }: { onOpenSettings: () => void; onOpenNotifications?: () => void }) {
  const { tasks, currentSection, setSection } = useTaskStore();
  const unreadCount = useReminderHistoryStore((s) => s.records.filter((r) => !r.read && !r.dismissed).length);

  // 缓存各导航项的计数，避免每次渲染重复遍历
  const counts = useMemo(() => {
    const result: Partial<Record<SectionId, number>> = {};
    for (const item of ALL_NAV_ITEMS) {
      result[item.id] = getCount(tasks, item.id);
    }
    return result;
  }, [tasks]);

  const renderGroup = (group: NavGroup, index: number) => (
    <div className="nav-section" key={group.title ?? `group-${index}`}>
      {group.title && <div className="nav-section-title">{group.title}</div>}
      {group.items.map(item => {
        const count = counts[item.id] ?? 0;
        return (
          <div
            key={item.id}
            className={`nav-item${currentSection === item.id ? ' active' : ''}`}
            onClick={() => setSection(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
            {count > 0 && (
              <span className="nav-count">{count}</span>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <img className="sidebar-logo" src="/logo.svg" alt="轻舟AI考研" />
        <div className="sidebar-brand">
          <h1>轻舟AI考研</h1>
          <span>考研备考助手</span>
        </div>
      </div>
      <nav className="sidebar-nav">
        {NAV_GROUPS.map((group, index) => renderGroup(group, index))}
      </nav>
      <div className="sidebar-footer">
        {onOpenNotifications && (
          <div className="nav-item" onClick={onOpenNotifications}>
            <span className="nav-icon" style={{ position: 'relative' }}>
              <Bell size={16} />
              {unreadCount > 0 && (
                <span className="nav-badge-notification">{unreadCount > 9 ? '9+' : unreadCount}</span>
              )}
            </span>
            <span className="nav-label">通知中心</span>
          </div>
        )}
        <div className="nav-item" onClick={onOpenSettings}>
          <span className="nav-icon"><Settings size={16} /></span>
          <span className="nav-label">设置</span>
        </div>
      </div>
    </aside>
  );
}
