import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useTaskStore } from '../stores/task-store';
import { searchTasks, toDateStr, localDateStr } from '../lib/utils';
import { getDayMark } from '../lib/lunar';
import { TaskRow } from './TaskRow';
import { TASK_TYPES } from '../lib/types';

const MN = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
const WD = ['日', '一', '二', '三', '四', '五', '六'];

const TAG_FILTERS = [
  { id: 'tag-urgent', label: '紧急', color: 'var(--tag-red)' },
  { id: 'tag-important', label: '重要', color: 'var(--tag-orange)' },
];

/** 解析 YYYY-MM-DD，无效时回退今天 */
function parseDateStr(s: string): { y: number; m: number; d: number } {
  const now = new Date();
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!parts) return { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
  return { y: Number(parts[1]), m: Number(parts[2]) - 1, d: Number(parts[3]) };
}

export function CalendarView() {
  const { tasks, searchQuery, calendarSelectedDate, setCalendarSelectedDate } = useTaskStore(
    useShallow((s) => ({
      tasks: s.tasks,
      searchQuery: s.searchQuery,
      calendarSelectedDate: s.calendarSelectedDate,
      setCalendarSelectedDate: s.setCalendarSelectedDate,
    })),
  );

  const today = localDateStr();
  // 选中日期以全局 calendarSelectedDate 为唯一数据源
  const sel = parseDateStr(calendarSelectedDate);
  // 视图月份独立于选中日期，翻页不改变选中
  const [view, setView] = useState({ y: sel.y, m: sel.m });

  const [taskFilter, setTaskFilter] = useState<'all' | 'pending' | 'doing' | 'done'>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [tagFilter, setTagFilter] = useState<string>('all');

  // 预聚合每日任务数，避免格子渲染时 O(42N) 过滤
  const dayCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tasks) {
      const d = toDateStr(t.dueDate);
      if (d) map.set(d, (map.get(d) ?? 0) + 1);
    }
    return map;
  }, [tasks]);

  const selMark = getDayMark(sel.y, sel.m + 1, sel.d);

  const dayTasksAll = useMemo(
    () => tasks.filter((t) => toDateStr(t.dueDate) === calendarSelectedDate),
    [tasks, calendarSelectedDate],
  );
  const dayTasksSearched = useMemo(() => searchTasks(dayTasksAll, searchQuery), [dayTasksAll, searchQuery]);
  const dayTasks = useMemo(() => {
    let list = dayTasksSearched;
    if (taskFilter === 'pending') list = list.filter((t) => !t.completed && t.kanban !== 'doing');
    else if (taskFilter === 'doing') list = list.filter((t) => !t.completed && t.kanban === 'doing');
    else if (taskFilter === 'done') list = list.filter((t) => t.completed);
    if (projectFilter !== 'all') list = list.filter((t) => t.projectId === projectFilter);
    if (tagFilter !== 'all') list = list.filter((t) => t.tags.includes(tagFilter));
    return list;
  }, [dayTasksSearched, taskFilter, projectFilter, tagFilter]);
  const dayDoneCount = dayTasksAll.filter((t) => t.completed).length;
  const dayDoingCount = dayTasksAll.filter((t) => !t.completed && t.kanban === 'doing').length;
  const dayPendingCount = dayTasksAll.length - dayDoneCount - dayDoingCount;

  const prev = () =>
    setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }));
  const next = () =>
    setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }));
  const goToday = () => {
    const n = new Date();
    setView({ y: n.getFullYear(), m: n.getMonth() });
    setCalendarSelectedDate(today);
  };

  // 日期格子（memo：仅在月份/任务数/选中变化时重建）
  const cells = useMemo(() => {
    const list: React.ReactNode[] = [];
    const dim = new Date(view.y, view.m + 1, 0).getDate();
    const fd = new Date(view.y, view.m, 1).getDay();
    const pd = new Date(view.y, view.m, 0).getDate();
    const ds = (d: number) =>
      `${view.y}-${String(view.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    for (let i = fd - 1; i >= 0; i--) {
      list.push(
        <div key={`p${i}`} className="calendar-cell other-month">
          <div className="calendar-cell-num">{pd - i}</div>
        </div>,
      );
    }
    for (let d = 1; d <= dim; d++) {
      const dateStr = ds(d);
      const isToday = dateStr === today;
      const isSel = dateStr === calendarSelectedDate;
      const cnt = dayCounts.get(dateStr) ?? 0;
      const mark = getDayMark(view.y, view.m + 1, d);
      const isSpecial = !!mark.label && mark.type !== 'lunar';
      list.push(
        <div
          key={d}
          className={`calendar-cell${isToday ? ' today' : ''}${isSel ? ' selected' : ''}${isSpecial ? ` bg-${mark.type}` : ''}`}
          onClick={() => setCalendarSelectedDate(dateStr)}
        >
          <div className="calendar-cell-num">{d}</div>
          <div className="calendar-cell-meta">
            {cnt > 0 && !isSpecial ? (
              <span className="calendar-cell-count">{cnt}个</span>
            ) : isSpecial ? (
              <span className={`calendar-cell-mark ${mark.type}`}>
                {mark.label.length > 3 ? mark.label.slice(0, 3) : mark.label}
              </span>
            ) : (
              <span className="calendar-cell-lunar">{mark.label}</span>
            )}
          </div>
        </div>,
      );
    }
    const rem = 7 - ((fd + dim) % 7);
    if (rem < 7) {
      for (let i = 1; i <= rem; i++) {
        list.push(
          <div key={`n${i}`} className="calendar-cell other-month">
            <div className="calendar-cell-num">{i}</div>
          </div>,
        );
      }
    }
    return list;
  }, [view, dayCounts, today, calendarSelectedDate, setCalendarSelectedDate]);

  return (
    <div className="calendar-view compact">
      <div className="calendar-task-list">
        <div className="calendar-list-header">
          <div>
            <span className="calendar-list-date">{sel.m + 1}月{sel.d}日</span>
            {selMark.label && (
              <span className={`calendar-list-mark ${selMark.type}`}>{selMark.label}</span>
            )}
            <span className="calendar-list-count">{dayTasksAll.length} 项任务</span>
          </div>
          {dayTasksAll.length > 0 && (
            <div className="calendar-task-filter">
              <button className={`cal-filter-btn${taskFilter === 'all' ? ' active' : ''}`} onClick={() => setTaskFilter('all')}>全部 <span className="cal-filter-count">{dayTasksAll.length}</span></button>
              <button className={`cal-filter-btn${taskFilter === 'pending' ? ' active' : ''}`} onClick={() => setTaskFilter('pending')}>待完成 <span className="cal-filter-count">{dayPendingCount}</span></button>
              <button className={`cal-filter-btn${taskFilter === 'doing' ? ' active' : ''}`} onClick={() => setTaskFilter('doing')}>进行中 <span className="cal-filter-count">{dayDoingCount}</span></button>
              <button className={`cal-filter-btn${taskFilter === 'done' ? ' active' : ''}`} onClick={() => setTaskFilter('done')}>已完成 <span className="cal-filter-count">{dayDoneCount}</span></button>
              <span className="cal-filter-divider" />
              {TASK_TYPES.map(p => {
                const active = projectFilter === p.id;
                return (
                  <button
                    key={p.id}
                    className={`cal-filter-btn${active ? ' active' : ''}`}
                    style={active ? { background: p.color, borderColor: p.color, color: '#fff' } : undefined}
                    onClick={() => setProjectFilter(active ? 'all' : p.id)}
                  >
                    <span className="cal-filter-dot" style={{ background: p.color }} />{p.name}
                  </button>
                );
              })}
              <span className="cal-filter-divider" />
              {TAG_FILTERS.map(tg => {
                const active = tagFilter === tg.id;
                return (
                  <button
                    key={tg.id}
                    className={`cal-filter-btn${active ? ' active' : ''}`}
                    style={active ? { background: tg.color, borderColor: tg.color, color: '#fff' } : undefined}
                    onClick={() => setTagFilter(active ? 'all' : tg.id)}
                  >
                    <span className="cal-filter-dot" style={{ background: tg.color }} />{tg.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="calendar-list-body">
          {dayTasks.length === 0 ? (
            <div className="calendar-empty">暂无任务</div>
          ) : (
            <div className="task-list">
              {dayTasks.map(t => <TaskRow key={t.id} task={t} />)}
            </div>
          )}
        </div>
      </div>

      <div className="calendar-widget">
        <div className="calendar-widget-header">
          <button className="calendar-widget-nav" onClick={prev}><ChevronLeft size={16} /></button>
          <h2>{view.y}年{MN[view.m]}</h2>
          <button className="calendar-widget-nav" onClick={next}><ChevronRight size={16} /></button>
        </div>
        <div className="calendar-widget-grid">
          <div className="calendar-widget-weekdays">{WD.map(d => <div key={d} className="calendar-widget-weekday">{d}</div>)}</div>
          <div className="calendar-widget-days">{cells}</div>
        </div>
        <button className="calendar-back-today" onClick={goToday}>回到今天</button>
      </div>
    </div>
  );
}
