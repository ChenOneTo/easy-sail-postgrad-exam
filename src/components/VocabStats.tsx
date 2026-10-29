import { useEffect, useMemo, useState } from 'react';
import { Activity, TrendingDown } from 'lucide-react';
import { useExamVocabStore } from '../stores/exam-vocab-store';
import type { OverallStats, DailyCount, LapseStats } from '../lib/exam-vocab-db';
import { localDateStr } from '../lib/utils';

const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

/** 统计：整体掌握环 + 近 30 天复习量柱状 + 遗忘率。按 en2zh（识认方向）统计。 */
export function VocabStats() {
  const fetchStats = useExamVocabStore((s) => s.fetchStats);
  const fetchReviewBars = useExamVocabStore((s) => s.fetchReviewBars);
  const fetchLapseStats = useExamVocabStore((s) => s.fetchLapseStats);
  const [stats, setStats] = useState<OverallStats | null>(null);
  const [bars, setBars] = useState<DailyCount[]>([]);
  const [lapse, setLapse] = useState<LapseStats | null>(null);
  /** 图表基准时刻：进页固定一次，避免渲染期调用 Date.now 产生不稳定结果 */
  const [nowMs] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    const since = localDateStr(new Date(nowMs - 29 * 86400000));
    Promise.all([
      fetchStats('en2zh'),
      fetchReviewBars(since),
      fetchLapseStats('en2zh'),
    ]).then(([s, b, l]) => { if (alive) { setStats(s); setBars(b); setLapse(l); } })
      .catch(() => { if (alive) { setStats(null); setBars([]); setLapse(null); } });
    return () => { alive = false; };
  }, [fetchStats, fetchReviewBars, fetchLapseStats, nowMs]);

  if (!stats) return <p className="placeholder-text">加载统计…</p>;

  const masteryPct = stats.total > 0 ? Math.round((stats.mastered / stats.total) * 100) : 0;
  const forgettingRate = lapse && lapse.totalReviews > 0
    ? Math.round((lapse.totalLapses / lapse.totalReviews) * 100)
    : 0;

  return (
    <div className="vocab-stats">
      <div className="vocab-stats-row">
        <MasteryRing mastered={stats.mastered} total={stats.total} pct={masteryPct} />
        <div className="vocab-stats-cards">
          <StatCard label="新词" value={stats.newCount} />
          <StatCard label="学习中" value={stats.learning + stats.relearning} />
          <StatCard label="复习中" value={stats.review} />
          <StatCard label="已掌握" value={stats.mastered} tone="good" />
        </div>
        <div className="vocab-stats-forget">
          <TrendingDown size={16} />
          <div>
            <b>{forgettingRate}%</b>
            <span>遗忘率</span>
          </div>
          <i>{lapse ? `${lapse.totalLapses} 次遗忘 / ${lapse.totalReviews} 次复习` : ''}</i>
        </div>
      </div>

      <ReviewBarChart bars={bars} nowMs={nowMs} />
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: 'good' }) {
  return (
    <div className={`vocab-stat-card${tone ? ` ${tone}` : ''}`}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

function MasteryRing({ mastered, total, pct }: { mastered: number; total: number; pct: number }) {
  const size = 120;
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="vocab-mastery-ring">
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border-default)" strokeWidth={10} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke="var(--brand-primary)" strokeWidth={10} strokeLinecap="round"
          strokeDasharray={`${c * (pct / 100)} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="vocab-mastery-text">
        <b>{pct}%</b>
        <span>{mastered}/{total}</span>
        <i>整体掌握</i>
      </div>
    </div>
  );
}

function ReviewBarChart({ bars, nowMs }: { bars: DailyCount[]; nowMs: number }) {
  const days = useMemo(() => {
    const map = new Map(bars.map((b) => [b.date, b.count]));
    const out: { label: string; dow: string; count: number; isToday: boolean }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(nowMs - i * 86400000);
      const ds = localDateStr(d);
      out.push({
        label: ds.slice(5).replace('-', '/'),
        dow: WEEK_LABELS[d.getDay()],
        count: map.get(ds) ?? 0,
        isToday: i === 0,
      });
    }
    return out;
  }, [bars, nowMs]);

  const max = Math.max(5, ...days.map((d) => d.count));

  return (
    <div className="vocab-chart">
      <div className="vocab-chart-header">
        <span className="vocab-chart-title"><Activity size={14} /> 近 30 天复习量</span>
        <span className="vocab-chart-legend">共 {days.reduce((a, d) => a + d.count, 0)} 次</span>
      </div>
      <div className="vocab-chart-cols">
        {days.map((d, i) => (
          <div key={i} className={`vocab-chart-col${d.isToday ? ' today' : ''}`} title={`${d.label}：${d.count} 次`}>
            <div className="vocab-chart-bars">
              <div className="bar" style={{ height: `${(d.count / max) * 100}%` }} />
            </div>
            {i % 5 === 0 && <span className="vocab-chart-label">{d.label}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
