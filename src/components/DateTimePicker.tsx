/**
 * 主题化日期时间选择器
 *
 * 基于 Ark UI v5 DatePicker + 自定义时间选择，
 * 样式完全匹配项目 Tailwind/CSS 变量主题系统。
 *
 * 特性：
 * - 日历选择日期（Ark UI DatePicker，中文本地化）
 * - 时间选择（小时/分钟下拉）
 * - 快捷预设（5分钟后/30分钟后/1小时后/明天早上9点）
 * - 重复规则选择
 * - 完全 headless，样式由项目 CSS 控制
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Clock, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import {
  PopoverRoot,
  PopoverTrigger,
  PopoverPositioner,
  PopoverContent,
} from '@ark-ui/react/popover';
import {
  DatePickerRoot,
  DatePickerView,
  DatePickerContext,
  DatePickerViewControl,
  DatePickerPrevTrigger,
  DatePickerViewTrigger,
  DatePickerNextTrigger,
  DatePickerTable,
  DatePickerTableHead,
  DatePickerTableRow,
  DatePickerTableHeader,
  DatePickerTableBody,
  DatePickerTableCell,
  DatePickerTableCellTrigger,
  DatePickerRangeText,
} from '@ark-ui/react/date-picker';
import { CalendarDateTime, createCalendar } from '@internationalized/date';
import type { DateValue } from '@internationalized/date';
import type { IntlTranslations } from '@zag-js/date-picker';
import type { RecurrenceType } from '../lib/types';
import { offsetMinutes, tomorrowMorning9, formatDateTime } from '../lib/utils';

// —— 日期转换工具 ——

/** JS Date → CalendarDateTime（公历） */
function toCalendarDateTime(date: Date | null): CalendarDateTime | null {
  if (!date || isNaN(date.getTime())) return null;
  return new CalendarDateTime(
    createCalendar('gregory'),
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    0,
  );
}

/** CalendarDateTime → JS Date */
function toJSDate(cal: CalendarDateTime | null | undefined): Date | null {
  if (!cal) return null;
  return cal.toDate('Asia/Shanghai');
}

// —— 中文本地化 ——

export const zhTranslations = {
  dayCell: (state: { label: string }) => state.label,
  nextTrigger: () => '下一月',
  monthSelect: '月份',
  yearSelect: '年份',
  viewTrigger: () => '切换视图',
  prevTrigger: () => '上一月',
  clearTrigger: '清除',
  trigger: (open: boolean) => (open ? '关闭日历' : '选择日期'),
  content: '日期选择器',
  placeholder: () => ({ year: '年', month: '月', day: '日' }),
  presetTrigger: (value: string[]) => value.join(', '),
} as unknown as IntlTranslations;

export const WEEK_DAYS = ['日', '一', '二', '三', '四', '五', '六'];

// —— 自定义时间下拉（替代原生 select，避免选项列表过长） ——

interface TimeSelectProps {
  value: number;
  max: number;                     // 最大可选值（小时 23，分钟 59）
  onChange: (v: number) => void;
  ariaLabel: string;
}

function TimeSelect({ value, max, onChange, ariaLabel }: TimeSelectProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; width: number }>({ left: 0, width: 0 });

  useEffect(() => {
    if (!open) return;
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      const listHeight = 200;
      const upward = rect.bottom + 8 + listHeight > window.innerHeight;
      setPos(
        upward
          ? { bottom: window.innerHeight - rect.top + 4, left: rect.left, width: rect.width }
          : { top: rect.bottom + 4, left: rect.left, width: rect.width },
      );
    }
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (listRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // 打开时滚动定位到当前选中值
  useEffect(() => {
    if (open && listRef.current) {
      listRef.current
        .querySelector<HTMLElement>('[data-selected="true"]')
        ?.scrollIntoView({ block: 'center' });
    }
  }, [open]);

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        className={`dtp-select${open ? ' open' : ''}`}
        onClick={() => setOpen(!open)}
        aria-label={ariaLabel}
      >
        {String(value).padStart(2, '0')}
        <ChevronDown size={13} className="dtp-select-arrow" />
      </button>
      {open &&
        createPortal(
          <div ref={listRef} className="dtp-select-list" style={pos}>
            {Array.from({ length: max + 1 }, (_, i) => (
              <button
                key={i}
                type="button"
                data-selected={i === value}
                className="dtp-select-option"
                onClick={() => {
                  onChange(i);
                  setOpen(false);
                }}
              >
                {String(i).padStart(2, '0')}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

// —— 组件 Props ——

export interface DateTimePickerValue {
  value: Date | null;              // 选中的日期时间
  recurrence: RecurrenceType;
}

interface DateTimePickerProps {
  value: DateTimePickerValue;
  onChange: (value: DateTimePickerValue) => void;
  children?: React.ReactNode;      // 自定义触发器
  inline?: boolean;                // 内联模式：直接渲染内容，不使用 Popover
}

export function DateTimePicker({ value, onChange, children, inline = false }: DateTimePickerProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'calendar' | 'time'>('calendar');

  const calValue = value.value ? [toCalendarDateTime(value.value)!] : [];

  const handleDateChange = useCallback(
    (details: { value: DateValue[] }) => {
      const selected = details.value[0] as CalendarDateTime | undefined;
      if (!selected) return;
      const jsDate = toJSDate(selected);
      if (!jsDate) return;
      // 保留当前时间（如果已有值）
      if (value.value) {
        jsDate.setHours(value.value.getHours(), value.value.getMinutes(), 0, 0);
      } else {
        const now = new Date();
        jsDate.setHours(now.getHours(), now.getMinutes(), 0, 0);
      }
      onChange({ ...value, value: jsDate });
    },
    [value, onChange],
  );

  const handleTimeChange = useCallback(
    (field: 'hour' | 'minute', val: number) => {
      const d = value.value ? new Date(value.value) : new Date();
      if (field === 'hour') d.setHours(val);
      else d.setMinutes(val);
      d.setSeconds(0, 0);
      onChange({ ...value, value: d });
    },
    [value, onChange],
  );

  const handleRecurrenceChange = useCallback(
    (_type: RecurrenceType) => {
      onChange({ ...value, recurrence: _type });
    },
    [value, onChange],
  );

  const applyPreset = useCallback(
    (iso: string) => {
      const d = new Date(iso);
      onChange({ ...value, value: d });
      setOpen(false);
    },
    [value, onChange],
  );

  const clearValue = useCallback(() => {
    onChange({ value: null, recurrence: 'none' });
    setOpen(false);
  }, [onChange]);

  const pickerContent = (
    <>
          {/* 快捷预设 */}
          <div className="dtp-presets">
            <button className="dtp-preset" onClick={() => applyPreset(offsetMinutes(5))}>5分钟后</button>
            <button className="dtp-preset" onClick={() => applyPreset(offsetMinutes(30))}>30分钟后</button>
            <button className="dtp-preset" onClick={() => applyPreset(offsetMinutes(60))}>1小时后</button>
            <button className="dtp-preset" onClick={() => applyPreset(tomorrowMorning9())}>明天9点</button>
          </div>

          {/* 视图切换 */}
          <div className="dtp-tabs">
            <button
              className={`dtp-tab${view === 'calendar' ? ' active' : ''}`}
              onClick={() => setView('calendar')}
            >
              <CalendarDays size={13} /> 日期
            </button>
            <button
              className={`dtp-tab${view === 'time' ? ' active' : ''}`}
              onClick={() => setView('time')}
            >
              <Clock size={13} /> 时间
            </button>
          </div>

          {/* 日历视图 */}
          {view === 'calendar' && (
            <DatePickerRoot
              selectionMode="single"
              value={calValue}
              onValueChange={handleDateChange}
              locale="zh-CN"
              translations={zhTranslations}
              startOfWeek={0}
              numOfMonths={1}
              inline
            >
              <DatePickerView view="day">
                <DatePickerContext>
                  {(api) => (
                    <>
                      <DatePickerViewControl className="dtp-view-control">
                        <DatePickerPrevTrigger className="dtp-nav-btn">
                          <ChevronLeft size={16} />
                        </DatePickerPrevTrigger>
                        <DatePickerViewTrigger className="dtp-view-label">
                          <DatePickerRangeText />
                        </DatePickerViewTrigger>
                        <DatePickerNextTrigger className="dtp-nav-btn">
                          <ChevronRight size={16} />
                        </DatePickerNextTrigger>
                      </DatePickerViewControl>
                      <DatePickerTable className="dtp-table">
                        <DatePickerTableHead>
                          <DatePickerTableRow>
                            {WEEK_DAYS.map((d, i) => (
                              <DatePickerTableHeader key={i} className="dtp-week-header">
                                {d}
                              </DatePickerTableHeader>
                            ))}
                          </DatePickerTableRow>
                        </DatePickerTableHead>
                        <DatePickerTableBody>
                          {api.weeks.map((week, wi) => (
                            <DatePickerTableRow key={wi}>
                              {week.map((day, di) => (
                                <DatePickerTableCell key={di} value={day}>
                                  <DatePickerTableCellTrigger className="dtp-cell-trigger">
                                    {day.day}
                                  </DatePickerTableCellTrigger>
                                </DatePickerTableCell>
                              ))}
                            </DatePickerTableRow>
                          ))}
                        </DatePickerTableBody>
                      </DatePickerTable>
                    </>
                  )}
                </DatePickerContext>
              </DatePickerView>
            </DatePickerRoot>
          )}

          {/* 时间视图 */}
          {view === 'time' && (
            <div className="dtp-time-panel">
              <div className="dtp-time-fields">
                <div className="dtp-time-field">
                  <label>时</label>
                  <TimeSelect
                    value={value.value?.getHours() ?? new Date().getHours()}
                    max={23}
                    onChange={(v) => handleTimeChange('hour', v)}
                    ariaLabel="选择小时"
                  />
                </div>
                <span className="dtp-time-sep">:</span>
                <div className="dtp-time-field">
                  <label>分</label>
                  <TimeSelect
                    value={value.value?.getMinutes() ?? new Date().getMinutes()}
                    max={59}
                    onChange={(v) => handleTimeChange('minute', v)}
                    ariaLabel="选择分钟"
                  />
                </div>
              </div>
            </div>
          )}

          {/* 重复规则 */}
          <div className="dtp-recurrence">
            <span className="dtp-recurrence-label">重复</span>
            <div className="dtp-recurrence-options">
              {(['none', 'daily', 'weekly', 'monthly', 'yearly'] as RecurrenceType[]).map((type) => (
                <button
                  key={type}
                  className={`dtp-recurrence-btn${value.recurrence === type ? ' active' : ''}`}
                  onClick={() => handleRecurrenceChange(type)}
                >
                  {{ none: '不重复', daily: '每天', weekly: '每周', monthly: '每月', yearly: '每年' }[type]}
                </button>
              ))}
            </div>
          </div>

          {/* 底部操作（仅 Popover 模式显示） */}
          {!inline && (
            <div className="dtp-footer">
              {value.value && (
                <button className="dtp-clear" onClick={clearValue}>
                  <X size={13} /> 清除
                </button>
              )}
              <button className="dtp-confirm" onClick={() => setOpen(false)}>确定</button>
            </div>
          )}
    </>
  );

  if (inline) {
    return <div className="dtp-inline">{pickerContent}</div>;
  }

  return (
    <PopoverRoot open={open} onOpenChange={(d) => setOpen(d.open)}>
      <PopoverTrigger asChild>
        {children ?? (
          <button type="button" className="dtp-trigger">
            <CalendarDays size={14} />
            <span>{value.value ? formatDateTime(value.value.toISOString()) : '选择日期时间'}</span>
          </button>
        )}
      </PopoverTrigger>
      <PopoverPositioner>
        <PopoverContent className="dtp-content">{pickerContent}</PopoverContent>
      </PopoverPositioner>
    </PopoverRoot>
  );
}
