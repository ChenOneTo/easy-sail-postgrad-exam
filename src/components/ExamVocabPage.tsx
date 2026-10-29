/**
 * 考研背单词页面
 *
 * 独立模块：exam_vocab_words/cards/reviews/hardwords/profile（migration v9），与 tasks/exam 零耦合。
 * 四个标签：今日背诵（卡片流）/ 单元进度 / 难词本 / 统计，外加设置面板。
 * 调度由 ts-fsrs (FSRS-4.5) 驱动，新词配额按三阶段日期自动切换。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen, Settings, Flame, AlertTriangle, Clock, RotateCw,
} from 'lucide-react';
import { useExamVocabStore } from '../stores/exam-vocab-store';
import type { VocabProfile, VocabQueueItem, TodayStats } from '../lib/exam-vocab-db';
import { VocabCardFlow } from './VocabCardFlow';
import { VocabUnitGrid } from './VocabUnitGrid';
import { VocabHardwords } from './VocabHardwords';
import { VocabStats } from './VocabStats';
import { VocabSettings } from './VocabSettings';
import { warmupTts } from '../lib/vocab-tts';
import { localDateStr } from '../lib/utils';

type Tab = 'today' | 'units' | 'hardwords' | 'stats';

const TABS: { id: Tab; label: string }[] = [
  { id: 'today', label: '今日背诵' },
  { id: 'units', label: '单元进度' },
  { id: 'hardwords', label: '难词本' },
  { id: 'stats', label: '统计' },
];

/** 按今天落在哪个阶段返回新词配额；都不在则取 0（停新词只复习） */
function newQuotaForToday(p: VocabProfile, today: string): { quota: number; phase: string } {
  if (today >= p.phase1Start && today <= p.phase1End) return { quota: p.phase1NewPerDay, phase: '阶段一' };
  if (today >= p.phase2Start && today <= p.phase2End) return { quota: p.phase2NewPerDay, phase: '阶段二' };
  if (today >= p.phase3Start && today <= p.phase3End) return { quota: p.phase3NewPerDay, phase: '阶段三' };
  return { quota: 0, phase: '计划外' };
}

/** 距考研天数（阶段三结束日视作考试日） */
function daysUntil(dateStr: string, today: string): number {
  const a = new Date(`${dateStr}T00:00:00`);
  const b = new Date(`${today}T00:00:00`);
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

function fmtMinutes(ms: number): string {
  const min = Math.round(ms / 60000);
  return min < 60 ? `${min}min` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}

export function ExamVocabPage() {
  const loaded = useExamVocabStore((s) => s.loaded);
  const loading = useExamVocabStore((s) => s.loading);
  const lastError = useExamVocabStore((s) => s.lastError);
  const profile = useExamVocabStore((s) => s.profile);
  const wordCount = useExamVocabStore((s) => s.wordCount);
  const hardwordCount = useExamVocabStore((s) => s.hardwords.filter((h) => h.status === 'new').length);
  const loadFromDb = useExamVocabStore((s) => s.loadFromDb);
  const clearError = useExamVocabStore((s) => s.clearError);
  const buildTodayQueue = useExamVocabStore((s) => s.buildTodayQueue);
  const buildUnitDrillQueue = useExamVocabStore((s) => s.buildUnitDrillQueue);
  const buildHardwordDrillQueue = useExamVocabStore((s) => s.buildHardwordDrillQueue);
  const dueReviewCount = useExamVocabStore((s) => s.dueReviewCount);
  const fetchTodayStats = useExamVocabStore((s) => s.fetchTodayStats);
  const studyTick = useExamVocabStore((s) => s.studyTick);
  const backupToCloud = useExamVocabStore((s) => s.backupToCloud);
  const restoreFromCloud = useExamVocabStore((s) => s.restoreFromCloud);

  const [tab, setTab] = useState<Tab>('today');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [queue, setQueue] = useState<VocabQueueItem[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  /** 队列换批时自增，作为卡片流的 remount key（重置翻面/计时/序号） */
  const [queueKey, setQueueKey] = useState(0);
  /** 当前卡片序号：由本页持有（而非卡片流内部），切到「单元进度」等标签再切回不丢进度 */
  const [cardIndex, setCardIndex] = useState(0);
  const [drillLabel, setDrillLabel] = useState('');
  const [dueTotal, setDueTotal] = useState(0);
  const [today, setTodayStats] = useState<TodayStats | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudMsg, setCloudMsg] = useState('');

  const todayStr = localDateStr();
  const { quota, phase } = useMemo(() => newQuotaForToday(profile, todayStr), [profile, todayStr]);
  const examDays = daysUntil(profile.phase3End, todayStr);
  /** 双向模式每词出两张卡（正反），新词配额按方向数放大，与 buildTodayQueue 的取卡量对齐 */
  const dirCount = profile.cardDirection === 'both' ? 2 : 1;

  useEffect(() => { void loadFromDb(); warmupTts(); }, [loadFromDb]);

  /** 刷新今日概览（到期总数 + 今日统计） */
  const refreshOverview = useCallback(async () => {
    const nowIso = new Date().toISOString();
    try {
      const [due, stats] = await Promise.all([
        dueReviewCount(nowIso),
        fetchTodayStats(todayStr),
      ]);
      setDueTotal(due);
      setTodayStats(stats);
    } catch { /* 概览失败不阻塞背诵 */ }
  }, [dueReviewCount, fetchTodayStats, todayStr]);

  /** 统一装载队列：成功即换批并重挂载卡片流；失败清空为空态 */
  const applyQueue = useCallback(async (build: () => Promise<VocabQueueItem[]>, label: string) => {
    setQueueLoading(true);
    try {
      const q = await build();
      setQueue(q);
      setCardIndex(0);
      setDrillLabel(label);
      setQueueKey((k) => k + 1);
    } catch (err) {
      console.error('[ExamVocabPage] 队列装载失败:', err);
      setQueue([]);
      setCardIndex(0);
    } finally {
      setQueueLoading(false);
    }
  }, []);

  /** 装载今日队列（学习中 > 到期复习 > 新词） */
  const loadTodayQueue = useCallback(async () => {
    setQueueLoading(true);
    setDrillLabel('');
    await applyQueue(() => buildTodayQueue(new Date().toISOString(), quota), '');
    void refreshOverview();
  }, [applyQueue, buildTodayQueue, quota, refreshOverview]);

  // 首次加载完成后装载队列（设置里改新词配额也会重建）；setState 只发生在 await 之后的回调里
  useEffect(() => {
    if (!loaded || loading) return;
    let alive = true;
    buildTodayQueue(new Date().toISOString(), quota)
      .then((q) => { if (alive) { setQueue(q); setCardIndex(0); setDrillLabel(''); setQueueKey((k) => k + 1); } })
      .catch((err) => { console.error('[ExamVocabPage] 队列装载失败:', err); if (alive) { setQueue([]); setCardIndex(0); } })
      .finally(() => {
        if (!alive) return;
        setQueueLoading(false);
        void refreshOverview();
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, loading, quota]);

  // 每评一张卡刷新今日概览（今日新学/复习/耗时来自评分日志，写成功后 store 自增 studyTick）
  useEffect(() => {
    if (!loaded || studyTick === 0) return;
    // refreshOverview 的 setState 全在 await 之后（异步），不会同步级联渲染；规则静态误报
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshOverview();
  }, [studyTick, loaded, refreshOverview]);

  const startUnitDrill = async (unit: string) => {
    setTab('today');
    await applyQueue(() => buildUnitDrillQueue(unit), `${unit} 专项`);
  };

  const startHardwordDrill = async () => {
    setTab('today');
    await applyQueue(() => buildHardwordDrillQueue(), '难词专项');
  };

  const onBackup = async () => {
    setCloudBusy(true); setCloudMsg('');
    try {
      const r = await backupToCloud();
      setCloudMsg(`已备份 ${r.count} 条到 ${r.path}`);
    } catch (err) {
      setCloudMsg(`备份失败：${err instanceof Error ? err.message : String(err)}`);
    } finally { setCloudBusy(false); }
  };

  const onRestore = async () => {
    setCloudBusy(true); setCloudMsg('');
    try {
      const msg = await restoreFromCloud();
      setCloudMsg(msg);
      await loadTodayQueue();
    } catch (err) {
      setCloudMsg(`恢复失败：${err instanceof Error ? err.message : String(err)}`);
    } finally { setCloudBusy(false); }
  };

  if (!loaded || loading) {
    return (
      <div className="exam-vocab-page">
        <p className="placeholder-text">加载中…</p>
      </div>
    );
  }

  const overloaded = dueTotal > profile.maxReviewsPerDay * dirCount;

  return (
    <div className="exam-vocab-page">
      {lastError && (
        <div className="exam-vocab-error">
          <span>{lastError}</span>
          <button className="exam-vocab-error-close" onClick={clearError}>×</button>
        </div>
      )}

      <header className="exam-vocab-header">
        <div>
          <h2><BookOpen size={18} /> 英语背单词</h2>
          <p className="exam-vocab-sub">
            词库 {wordCount} 词 · {phase} 新词 {quota}/天 · 目标保留率 {Math.round(profile.targetRetention * 100)}%
            {examDays >= 0 && <> · 距考试 {examDays} 天</>}
          </p>
        </div>
        <div className="exam-vocab-head-ops">
          <span className="exam-vocab-streak"><Flame size={14} /> 连续 {profile.streak} 天</span>
          <button className="exam-ghost-btn" onClick={() => setSettingsOpen((v) => !v)}>
            <Settings size={13} /> 设置
          </button>
        </div>
      </header>

      <div className="exam-vocab-overview">
        <OverviewStat label="今日新学" value={`${today?.newLearned ?? 0}/${quota * dirCount}`} />
        <OverviewStat label="今日复习" value={dueTotal > 0 ? `${today?.reviewed ?? 0}/${Math.min(dueTotal, profile.maxReviewsPerDay * dirCount)}` : `${today?.reviewed ?? 0}`} />
        <OverviewStat label="今日耗时" value={fmtMinutes(today?.durationMs ?? 0)} icon={<Clock size={13} />} />
        <OverviewStat label="待攻坚难词" value={String(hardwordCount)} icon={<Flame size={13} />} />
      </div>

      {overloaded && (
        <div className="exam-vocab-overload">
          <AlertTriangle size={14} />
          到期复习 {dueTotal} 张，超过每日上限 {profile.maxReviewsPerDay * dirCount} 张。今日只出上限内的卡，其余顺延；可在设置中调高上限或暂停新词。
        </div>
      )}

      <div className="exam-vocab-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`exam-vocab-tab${tab === t.id ? ' active' : ''}${t.id === 'today' && overloaded ? ' warn' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'hardwords' && hardwordCount > 0 && <span className="exam-vocab-tab-badge">{hardwordCount}</span>}
          </button>
        ))}
        {tab === 'today' && (
          <button className="exam-ghost-btn exam-vocab-reload" onClick={() => void loadTodayQueue()} title="重新装载今日队列">
            <RotateCw size={13} /> {drillLabel ? '回到今日队列' : '刷新队列'}
          </button>
        )}
      </div>

      {settingsOpen && (
        <VocabSettings busy={cloudBusy} msg={cloudMsg} onBackup={() => void onBackup()} onRestore={() => void onRestore()} />
      )}

      <div className="exam-vocab-body">
        {tab === 'today' && (
          queueLoading
            ? <p className="placeholder-text">装载队列…</p>
            : <>
                {drillLabel && <div className="exam-vocab-drill-tag">{drillLabel}（{queue.length} 张）</div>}
                <VocabCardFlow key={queueKey} queue={queue} index={cardIndex} onIndexChange={setCardIndex} onDone={() => void loadTodayQueue()} />
              </>
        )}
        {tab === 'units' && <VocabUnitGrid onDrill={(u) => void startUnitDrill(u)} />}
        {tab === 'hardwords' && <VocabHardwords onDrill={() => void startHardwordDrill()} />}
        {tab === 'stats' && <VocabStats />}
      </div>
    </div>
  );
}

function OverviewStat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="exam-vocab-overview-stat">
      <span className="exam-vocab-overview-label">{icon}{label}</span>
      <b>{value}</b>
    </div>
  );
}
