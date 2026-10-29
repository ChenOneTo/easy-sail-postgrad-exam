import { useMemo, useState } from 'react';
import { Download, Copy, Check, Sparkles, CalendarDays } from 'lucide-react';
import { useTaskStore } from '../stores/task-store';
import { toDateStr } from '../lib/utils';
import { useAiTask } from '../hooks/useAiTask';
import { DatePicker } from './DatePicker';

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getQuickRange(label: string): [string, string] {
  const now = new Date();
  const today = formatDate(now);
  switch (label) {
    case '今日': return [today, today];
    case '本周': {
      const start = new Date(now);
      start.setDate(now.getDate() - now.getDay());
      return [formatDate(start), today];
    }
    case '本月': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return [formatDate(start), today];
    }
    case '本季度': {
      const q = Math.floor(now.getMonth() / 3);
      const start = new Date(now.getFullYear(), q * 3, 1);
      return [formatDate(start), today];
    }
    default: return [today, today];
  }
}

const QUICK_RANGES = ['今日', '本周', '本月', '本季度'];

function downloadAsWord(content: string, filename: string) {
  const html = `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${filename}</title><style>body{font-family:"Microsoft YaHei","SimHei",sans-serif;line-height:1.8;color:#333;max-width:800px;margin:0 auto;padding:40px;}h1{font-size:22px;color:#1a1a1a;border-bottom:2px solid #6cc788;padding-bottom:10px;}h2{font-size:18px;color:#2d2d2d;margin-top:28px;}h3{font-size:15px;color:#444;}p{font-size:14px;margin:8px 0;}ul,ol{padding-left:22px;}li{font-size:14px;margin:4px 0;}.header{text-align:center;margin-bottom:32px;.meta{font-size:13px;color:#888;margin-top:8px;}.footer{margin-top:40px;padding-top:16px;border-top:1px solid #eee;font-size:12px;color:#aaa;text-align:center;}}</style></head><body>${content}</body></html>`;
  const blob = new Blob(['﻿', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ReviewPage() {
  const { tasks } = useTaskStore();
  const ai = useAiTask();
  const [report, setReport] = useState('');
  const [copied, setCopied] = useState(false);
  const today = formatDate(new Date());
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return formatDate(d);
  });
  const [endDate, setEndDate] = useState(today);

  const startStr = startDate;
  const endStr = endDate >= today ? today : endDate;

  const periodTasks = useMemo(() =>
    tasks.filter(t => {
      const due = toDateStr(t.dueDate);
      const completed = toDateStr(t.completedAt);
      return (due && due >= startStr && due <= endStr) ||
             (completed && completed >= startStr && completed <= endStr);
    }),
    [tasks, startStr, endStr]
  );

  const handleGenerate = async () => {
    const label = startStr === endStr ? '日报' : (() => {
      const diff = Math.round((new Date(endStr).getTime() - new Date(startStr).getTime()) / 86400000) + 1;
      return diff <= 10 ? '周报' : '月报';
    })();
    const result = await ai.summarizePeriod(label as '日报' | '周报' | '月报', periodTasks);
    if (result) setReport(result);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(report);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = report;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleExportWord = () => {
    const htmlContent = report
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/^\* (.+)$/gm, '<li>$1</li>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br/>');
    downloadAsWord(`<div class="header"><h1>复盘报告</h1><div class="meta">${startStr} ~ ${endStr}</div></div><p>${htmlContent}</p>`, `复盘报告_${startStr}_${endStr}`);
  };

  const diffDays = Math.round((new Date(endStr).getTime() - new Date(startStr).getTime()) / 86400000) + 1;

  const [activeQuick, setActiveQuick] = useState<string | null>(null);

  const handleQuickRange = (label: string) => {
    const [s, e] = getQuickRange(label);
    setStartDate(s);
    setEndDate(e);
    setActiveQuick(label);
    setReport('');
  };

  return (
    <div className="review-page">
      <div className="review-header">
        <h2>复盘报告</h2>
        <div className="review-quick-ranges">
          {QUICK_RANGES.map(r => (
            <button
              key={r}
              className={`review-quick-btn${activeQuick === r ? ' active' : ''}`}
              onClick={() => handleQuickRange(r)}
            >
              <CalendarDays size={12} />
              {r}
            </button>
          ))}
        </div>
        <div className="review-date-range">
          <DatePicker
            value={startDate}
            max={endDate}
            onChange={v => { if (v) { setStartDate(v); setReport(''); } }}
            clearable={false}
            displayFormat="iso"
            className="review-date-trigger"
          />
          <span className="review-date-sep">至</span>
          <DatePicker
            value={endDate}
            min={startDate}
            max={today}
            onChange={v => { if (v) { setEndDate(v); setReport(''); } }}
            clearable={false}
            displayFormat="iso"
            className="review-date-trigger"
          />
        </div>
        <button
          className="review-generate-btn"
          disabled={ai.loading || periodTasks.length === 0}
          onClick={handleGenerate}
        >
          <Sparkles size={14} />
          {ai.loading ? '生成中...' : '生成报告'}
        </button>
      </div>

      <div className="review-info">
        统计范围：{startStr} ~ {endStr}（{diffDays}天）｜共 {periodTasks.length} 条任务
      </div>

      <div className="review-content">
        <div className="review-toolbar">
          <button className="review-tool-btn" onClick={handleCopy} disabled={!report || ai.loading}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? '已复制' : '复制'}
          </button>
          <button className="review-tool-btn primary" onClick={handleExportWord} disabled={!report || ai.loading}>
            <Download size={14} />
            导出 Word
          </button>
        </div>
        <div className="review-body">
          {ai.loading && (
            <div className="review-loading">
              <Sparkles size={20} className="review-loading-icon" />
              <span>正在生成报告，请稍候...</span>
            </div>
          )}
          {!ai.loading && !report && periodTasks.length > 0 && (
            <div className="review-placeholder">
              <Sparkles size={28} />
              <span>点击「生成报告」开始智能复盘</span>
            </div>
          )}
          {!ai.loading && periodTasks.length === 0 && (
            <div className="review-placeholder">该时间段内暂无任务，无法生成报告</div>
          )}
          {!ai.loading && report && report.split('\n').map((line, i) => {
            if (line.startsWith('### ')) return <h3 key={i}>{line.slice(4)}</h3>;
            if (line.startsWith('## ')) return <h2 key={i}>{line.slice(3)}</h2>;
            if (line.startsWith('# ')) return <h1 key={i}>{line.slice(2)}</h1>;
            if (line.startsWith('- ') || line.startsWith('* ')) return <p key={i} className="review-list-item">{line.slice(2)}</p>;
            if (/^\d+\.\s/.test(line)) return <p key={i} className="review-list-item">{line}</p>;
            if (line.trim() === '') return <br key={i} />;
            return <p key={i}>{line}</p>;
          })}
        </div>
      </div>
    </div>
  );
}
