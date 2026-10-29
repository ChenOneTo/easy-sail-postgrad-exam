import { useMemo } from 'react';
import { Flame, Check, Trash2, RotateCw } from 'lucide-react';
import { useExamVocabStore } from '../stores/exam-vocab-store';
import { getPhonetics } from '../lib/vocab-phonetics';

/**
 * 难词本：自动入库（连续 Again）+ 手动收藏。列出原因与连错次数，
 * 支持标记已掌握（移出）、删除，以及「只刷难词池」专项刷。
 */
export function VocabHardwords({ onDrill }: { onDrill: () => void }) {
  const hardwords = useExamVocabStore((s) => s.hardwords);
  const markGrasped = useExamVocabStore((s) => s.markHardwordGrasped);
  const remove = useExamVocabStore((s) => s.removeHardword);

  const active = useMemo(() => hardwords.filter((h) => h.status === 'new'), [hardwords]);
  const grasped = useMemo(() => hardwords.filter((h) => h.status === 'grasped'), [hardwords]);

  return (
    <div className="vocab-hardwords">
      <div className="vocab-hardwords-top">
        <span className="vocab-hardwords-count"><Flame size={14} /> 待攻坚 {active.length} · 已掌握 {grasped.length}</span>
        <button className="exam-ghost-btn" disabled={active.length === 0} onClick={onDrill} title="只刷难词池">
          <RotateCw size={13} /> 专项刷难词
        </button>
      </div>

      {hardwords.length === 0 ? (
        <p className="placeholder-text">难词本为空。答题时连续选「重来」会自动入库，也可在卡片背面手动收藏。</p>
      ) : (
        <>
          {active.length > 0 && (
            <ul className="vocab-hardword-list">
              {active.map((h) => (
                <HardwordRow key={h.id} h={h} onGrasp={() => void markGrasped(h.wordId)} onRemove={() => void remove(h.wordId)} />
              ))}
            </ul>
          )}
          {grasped.length > 0 && (
            <div className="vocab-hardwords-group">
              <div className="vocab-hardwords-group-title">已掌握</div>
              <ul className="vocab-hardword-list grasped">
                {grasped.map((h) => (
                  <HardwordRow key={h.id} h={h} grasped onGrasp={() => void markGrasped(h.wordId)} onRemove={() => void remove(h.wordId)} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function HardwordRow({ h, grasped, onGrasp, onRemove }: {
  h: import('../lib/exam-vocab-db').VocabHardWord;
  grasped?: boolean;
  onGrasp: () => void;
  onRemove: () => void;
}) {
  const phonetics = getPhonetics(h.word ?? '');
  const phoneticText = [
    phonetics.uk ? `英 ${phonetics.uk}` : '',
    phonetics.us ? `美 ${phonetics.us}` : '',
  ].filter(Boolean).join(' · ');
  return (
    <li className="vocab-hardword-row">
      <div className="vocab-hardword-main">
        <span className="vocab-hardword-word">{h.word || `#${h.wordId}`}</span>
        {phoneticText && <span className="vocab-hardword-phonetic">{phoneticText}</span>}
        {h.unit && <span className="vocab-hardword-unit">{h.unit}</span>}
        {h.againStreak > 0 && <span className="vocab-hardword-streak">连错 {h.againStreak}</span>}
        {h.meaning && <span className="vocab-hardword-meaning">{h.meaning}</span>}
        {h.reason && <span className="vocab-hardword-reason">{h.reason}</span>}
      </div>
      <div className="vocab-hardword-ops">
        <button className="icon-btn" onClick={onGrasp} title={grasped ? '已掌握' : '标记已掌握'}>
          <Check size={14} />
        </button>
        <button className="icon-btn" onClick={onRemove} title="移出难词本">
          <Trash2 size={14} />
        </button>
      </div>
    </li>
  );
}
