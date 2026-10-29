/**
 * 通知中心面板
 *
 * 展示通知历史列表，支持稍后提醒、查看任务、关闭、全部已读、清空。
 */

import { useState } from 'react';
import { BellRing, CheckCheck, ChevronRight, Clock, Trash2, X } from 'lucide-react';
import { useReminderHistoryStore } from '../stores/reminder-history-store';
import { useTaskStore } from '../stores/task-store';
import { snoozeTask } from '../lib/notification-engine';

interface NotificationCenterProps {
  open: boolean;
  onClose: () => void;
}

/** 相对时间：刚刚 / X分钟前 / 今天 HH:mm / 昨天 HH:mm / M月D日 */
function relativeTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (isSameDay(d, now)) return `今天 ${hm}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(d, yesterday)) return `昨天 ${hm}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function NotificationCenter({ open, onClose }: NotificationCenterProps) {
  const { records, dismissRecord, markRead, markAllRead, clearAll } = useReminderHistoryStore();
  const openDetail = useTaskStore((s) => s.openDetail);
  const [confirmClear, setConfirmClear] = useState(false);

  if (!open) return null;

  const activeRecords = records.filter((r) => !r.dismissed);
  const unreadCount = activeRecords.filter((r) => !r.read).length;

  const handleViewTask = (recordId: string, taskId: number) => {
    markRead(recordId);
    openDetail(taskId);
    onClose();
  };

  const handleSnooze = async (recordId: string, taskId: number, minutes: number) => {
    await snoozeTask(taskId, minutes);
    useReminderHistoryStore.getState().snoozeRecord(recordId);
  };

  const handleClearAll = () => {
    if (confirmClear) {
      clearAll();
      setConfirmClear(false);
    } else {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 3000);
    }
  };

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal notification-center-modal" onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className="notification-center-header">
          <span className="notification-center-title">
            <BellRing size={15} />
            通知中心
            {unreadCount > 0 && <span className="notification-center-badge">{unreadCount}</span>}
          </span>
          <div className="notification-center-actions">
            {unreadCount > 0 && (
              <button className="notification-center-action" onClick={markAllRead}>
                <CheckCheck size={13} /> 全部已读
              </button>
            )}
            {activeRecords.length > 0 && (
              <button
                className={`notification-center-action${confirmClear ? ' danger' : ''}`}
                onClick={handleClearAll}
              >
                <Trash2 size={13} /> {confirmClear ? '确认清空？' : '清空'}
              </button>
            )}
          </div>
          <button className="notification-center-close" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>

        {/* 列表 */}
        <div className="notification-center-body">
          {activeRecords.length === 0 ? (
            <div className="notification-center-empty">
              <div className="notification-center-empty-icon">
                <BellRing size={32} />
              </div>
              <div className="notification-center-empty-title">暂无通知</div>
              <div className="notification-center-empty-desc">任务提醒触发后会显示在这里</div>
            </div>
          ) : (
            <div className="notification-center-list">
              {activeRecords.map((record) => (
                <div
                  key={record.id}
                  className={`notification-item${record.read ? '' : ' unread'}`}
                >
                  <div className="notification-item-indicator" />
                  <div className="notification-item-content">
                    <div
                      className="notification-item-main"
                      onClick={() => record.taskId !== undefined && handleViewTask(record.id, record.taskId)}
                      title="查看任务"
                    >
                      <div className="notification-item-title">{record.taskTitle}</div>
                      <div className="notification-item-meta">
                        <span className="notification-item-time">
                          <Clock size={11} />
                          {relativeTime(record.triggeredAt)}
                        </span>
                        {record.snoozed && (
                          <span className="notification-item-snoozed">已稍后提醒</span>
                        )}
                      </div>
                    </div>
                    <div className="notification-item-actions">
                      {record.taskId !== undefined && (
                        <>
                          <button
                            className="notification-item-btn"
                            onClick={() => void handleSnooze(record.id, record.taskId!, 10)}
                            title="10分钟后再提醒"
                          >
                            10分钟后
                          </button>
                          <button
                            className="notification-item-btn"
                            onClick={() => void handleSnooze(record.id, record.taskId!, 60)}
                            title="1小时后再提醒"
                          >
                            1小时后
                          </button>
                        </>
                      )}
                      <button
                        className="notification-item-btn notification-item-btn-primary"
                        onClick={() => record.taskId !== undefined && handleViewTask(record.id, record.taskId)}
                      >
                        查看任务 <ChevronRight size={12} />
                      </button>
                    </div>
                  </div>
                  <button
                    className="notification-item-dismiss"
                    onClick={() => dismissRecord(record.id)}
                    title="移除通知"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
