import { useEffect, useState } from 'react';
import { useExamVocabStore } from '../stores/exam-vocab-store';
import type { UnitProgress } from '../lib/exam-vocab-db';

/**
 * 单元进度网格：26 单元，每格「已掌握/总数」；核心区(蓝)/基础区(灰)分色。
 * 进度按 en2zh（识认方向）统计；点单元进入该单元未掌握词专项刷。
 */
export function VocabUnitGrid({ onDrill }: { onDrill: (unit: string) => void }) {
  const fetchUnitProgress = useExamVocabStore((s) => s.fetchUnitProgress);
  const [rows, setRows] = useState<UnitProgress[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchUnitProgress('en2zh')
      .then((r) => { if (alive) setRows(r); })
      .catch(() => { if (alive) setRows([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [fetchUnitProgress]);

  if (loading) return <p className="placeholder-text">加载单元进度…</p>;
  if (rows.length === 0) return <p className="placeholder-text">暂无单元数据</p>;

  const coreTotal = rows.filter(r => r.coreZone).reduce((a, r) => a + r.total, 0);
  const coreMastered = rows.filter(r => r.coreZone).reduce((a, r) => a + r.mastered, 0);
  const baseTotal = rows.filter(r => !r.coreZone).reduce((a, r) => a + r.total, 0);
  const baseMastered = rows.filter(r => !r.coreZone).reduce((a, r) => a + r.mastered, 0);

  return (
    <div className="vocab-unit-section">
      <div className="vocab-zone-bars">
        <ZoneBar label="核心区 U01–U13" mastered={coreMastered} total={coreTotal} tone="core" />
        <ZoneBar label="基础区 U14–U26" mastered={baseMastered} total={baseTotal} tone="base" />
      </div>
      <div className="vocab-unit-grid">
        {rows.map((r) => {
          const pct = r.total > 0 ? Math.round((r.mastered / r.total) * 100) : 0;
          return (
            <button
              key={r.unit}
              className={`vocab-unit-cell${r.coreZone ? ' core' : ' base'}`}
              onClick={() => onDrill(r.unit)}
              title={`${r.unit}：${r.mastered}/${r.total} 已掌握，点击专项刷未掌握词`}
            >
              <span className="vocab-unit-name">{r.unit}</span>
              <span className="vocab-unit-count">{r.mastered}/{r.total}</span>
              <span className="vocab-unit-pct">{pct}%</span>
              <span className="vocab-unit-bar" style={{ width: `${pct}%` }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ZoneBar({ label, mastered, total, tone }: { label: string; mastered: number; total: number; tone: 'core' | 'base' }) {
  const pct = total > 0 ? Math.round((mastered / total) * 100) : 0;
  return (
    <div className={`vocab-zone-bar ${tone}`}>
      <span className="vocab-zone-label">{label}</span>
      <span className="vocab-zone-nums">{mastered}/{total} · {pct}%</span>
      <span className="vocab-zone-track"><span className="vocab-zone-fill" style={{ width: `${pct}%` }} /></span>
    </div>
  );
}
