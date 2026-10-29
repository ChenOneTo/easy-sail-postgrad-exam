/**
 * 提醒设置弹窗
 *
 * 模态弹窗形式展示提醒选择器，用于 QuickAdd 和 DetailPanel。
 * 点击背景遮罩或关闭按钮关闭。
 */

import { BellRing, X } from 'lucide-react';
import { DateTimePicker } from './DateTimePicker';
import type { RecurrenceRule, RecurrenceType } from '../lib/types';
import { formatDateTime } from '../lib/utils';

export interface ReminderValue {
  reminderAt: string | null;
  reminderEnabled: boolean;
  reminderText: string | null;
  recurrence: RecurrenceRule | null;
}

interface ReminderDialogProps {
  open: boolean;
  value: ReminderValue;
  onChange: (value: ReminderValue) => void;
  onClose: () => void;
}

const RECURRENCE_LABELS: Record<string, string> = {
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
  yearly: '每年',
};

export function ReminderDialog({ open, value, onChange, onClose }: ReminderDialogProps) {
  if (!open) return null;

  const recurrenceType = value.recurrence?.type ?? 'none';

  const handleDateTimeChange = (newValue: { value: Date | null; recurrence: RecurrenceType }) => {
    const recurrence: RecurrenceRule | null =
      newValue.recurrence === 'none' ? null : { type: newValue.recurrence, interval: 1 };
    onChange({
      ...value,
      reminderAt: newValue.value ? newValue.value.toISOString() : null,
      reminderEnabled: !!newValue.value,
      recurrence,
    });
  };

  const clearReminder = () => {
    onChange({
      reminderAt: null,
      reminderEnabled: false,
      reminderText: null,
      recurrence: null,
    });
    onClose();
  };

  const selectedDate = value.reminderAt ? new Date(value.reminderAt) : null;
  const hasReminder = value.reminderEnabled && !!value.reminderAt;

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal reminder-dialog" onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className="reminder-dialog-header">
          <span className="reminder-dialog-title">
            <BellRing size={15} />
            设置提醒
          </span>
          <button className="reminder-dialog-close" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>

        {/* 内容：内联日期时间选择器 */}
        <div className="reminder-dialog-body">
          <DateTimePicker
            inline
            value={{ value: selectedDate, recurrence: recurrenceType }}
            onChange={handleDateTimeChange}
          />
        </div>

        {/* 底部：摘要 + 操作 */}
        <div className="reminder-dialog-footer">
          <div className="reminder-dialog-summary">
            {hasReminder ? (
              <span className="reminder-summary-time">
                {formatDateTime(value.reminderAt!)}
                {recurrenceType !== 'none' && (
                  <span className="reminder-summary-recurrence">
                    {' · '}
                    {RECURRENCE_LABELS[recurrenceType]}
                  </span>
                )}
              </span>
            ) : (
              <span className="reminder-dialog-hint">尚未设置提醒时间</span>
            )}
          </div>
          <div className="reminder-dialog-actions">
            {hasReminder && (
              <button className="reminder-clear-btn" onClick={clearReminder}>
                <X size={13} /> 清除
              </button>
            )}
            <button className="reminder-done-btn" onClick={onClose}>
              完成
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
