/**
 * 主题化日期选择器（仅日期，无时间）
 *
 * 基于 Ark UI DatePicker + Popover，样式复用 dtp-* 主题类。
 * 用于替代原生 <input type="date">，统一 QuickAdd / DetailPanel 的日期选择体验。
 *
 * 特性：
 * - 主题化日历弹层（中文本地化）
 * - 可选快捷预设（今天/明天等）
 * - 支持 min / max 限制
 * - 弹层内清除、确定操作
 */

import { useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
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
import { CalendarDate, createCalendar } from '@internationalized/date';
import type { DateValue } from '@internationalized/date';
import { zhTranslations, WEEK_DAYS } from '../lib/date-picker-locale';

// —— 'YYYY-MM-DD' 字符串与 CalendarDate 互转 ——

function strToCalendarDate(s: string): CalendarDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new CalendarDate(createCalendar('gregory'), Number(m[1]), Number(m[2]), Number(m[3]));
}

function calToStr(c: DateValue): string {
  return `${c.year}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`;
}

/** 展示文本："2026年8月12日 周三" */
function displayText(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return value;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const weekday = WEEK_DAYS[new Date(y, mo - 1, d).getDay()];
  return `${y}年${mo}月${d}日 周${weekday}`;
}

export interface DatePickerPreset {
  label: string;
  date: string; // 'YYYY-MM-DD'
}

interface DatePickerProps {
  value: string;                 // 'YYYY-MM-DD'，空字符串表示未选择
  onChange: (v: string) => void;
  placeholder?: string;
  min?: string;
  max?: string;
  presets?: DatePickerPreset[];
  className?: string;            // 触发器附加类名（用于场景化样式）
  icon?: boolean;                // 是否显示日历图标，默认 true
  clearable?: boolean;           // 弹层内是否显示清除按钮，默认 true
  displayFormat?: 'long' | 'iso'; // 触发器文本格式：'2026年8月12日 周三' 或 '2026-08-12'，默认 long
}

export function DatePicker({
  value,
  onChange,
  placeholder = '选择日期',
  min,
  max,
  presets,
  className = '',
  icon = true,
  clearable = true,
  displayFormat = 'long',
}: DatePickerProps) {
  const [open, setOpen] = useState(false);

  const parsed = value ? strToCalendarDate(value) : null;
  const calValue = parsed ? [parsed] : [];
  const minValue = min ? (strToCalendarDate(min) ?? undefined) : undefined;
  const maxValue = max ? (strToCalendarDate(max) ?? undefined) : undefined;

  const handleChange = (details: { value: DateValue[] }) => {
    const selected = details.value[0];
    if (!selected) return;
    onChange(calToStr(selected));
    setOpen(false);
  };

  const applyPreset = (date: string) => {
    onChange(date);
    setOpen(false);
  };

  const clearValue = () => {
    onChange('');
    setOpen(false);
  };

  return (
    <PopoverRoot open={open} onOpenChange={(d) => setOpen(d.open)}>
      <PopoverTrigger asChild>
        <button type="button" className={`date-picker-trigger ${className}`}>
          {icon && <CalendarDays size={14} />}
          <span className={value ? '' : 'placeholder'}>
            {value ? (displayFormat === 'iso' ? value : displayText(value)) : placeholder}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverPositioner>
        <PopoverContent className="dtp-content date-picker-panel">
          {/* 快捷预设 */}
          {presets && presets.length > 0 && (
            <div className="dtp-presets">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className={`dtp-preset${value === p.date ? ' active' : ''}`}
                  onClick={() => applyPreset(p.date)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {/* 日历 */}
          <DatePickerRoot
            selectionMode="single"
            value={calValue}
            onValueChange={handleChange}
            locale="zh-CN"
            translations={zhTranslations}
            startOfWeek={0}
            numOfMonths={1}
            min={minValue}
            max={maxValue}
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

          {/* 底部操作 */}
          <div className="dtp-footer">
            {value && clearable ? (
              <button type="button" className="dtp-clear" onClick={clearValue}>
                <X size={13} /> 清除
              </button>
            ) : (
              <span />
            )}
            <button type="button" className="dtp-confirm" onClick={() => setOpen(false)}>
              确定
            </button>
          </div>
        </PopoverContent>
      </PopoverPositioner>
    </PopoverRoot>
  );
}
