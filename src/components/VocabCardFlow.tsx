import { useEffect, useRef, useState } from 'react';
import { Volume2, Star, Sparkles, ChevronLeft, ChevronRight } from 'lucide-react';
import { Rating } from 'ts-fsrs';
import type { Grade } from 'ts-fsrs';
import { useExamVocabStore } from '../stores/exam-vocab-store';
import type { VocabQueueItem } from '../lib/exam-vocab-db';
import { speak, stopSpeak } from '../lib/vocab-tts';
import { getTtsConfig } from '../lib/vocab-tts';
import { getPhonetics } from '../lib/vocab-phonetics';
import { VocabMnemonicSheet } from './VocabMnemonicSheet';

const RATING_BUTTONS: { grade: Grade; key: string; label: string; cls: string }[] = [
  { grade: Rating.Again, key: '1', label: '重来', cls: 'again' },
  { grade: Rating.Hard, key: '2', label: '困难', cls: 'hard' },
  { grade: Rating.Good, key: '3', label: '良好', cls: 'good' },
  { grade: Rating.Easy, key: '4', label: '简单', cls: 'easy' },
];

/** 预览间隔（天）→ 紧凑标签：1分 / 10分 / 5时 / 3天 */
function fmtInterval(days: number): string {
  if (days <= 0) return '现在';
  const mins = days * 1440;
  if (mins < 1) return '1分';
  if (mins < 60) return `${Math.round(mins)}分`;
  if (days < 1) return `${Math.round(days * 24)}时`;
  return `${Math.round(days)}天`;
}

/**
 * 卡片流：正面单词 → 空格/点按翻面看释义 → 1-4 评分 → ts-fsrs 写库 → 自动下一张。
 * 键盘流：空格翻面、1-4 评分、S 播放、N 跳过；全程不离开键盘。
 */
export function VocabCardFlow({ queue, index, onIndexChange, onDone }: {
  queue: VocabQueueItem[];
  /** 当前卡片序号由父级持有：本页切标签再切回时不丢进度（序号 0 随换批在父级重置） */
  index: number;
  onIndexChange: (next: number) => void;
  onDone: () => void;
}) {
  const rateCard = useExamVocabStore((s) => s.rateCard);
  const previewIntervals = useExamVocabStore((s) => s.previewIntervals);
  const addHardword = useExamVocabStore((s) => s.addHardword);
  const [flipped, setFlipped] = useState(false);
  const [mnemonicOpen, setMnemonicOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 四按钮预览间隔：翻面时算一次（渲染期不读时钟，保证纯函数） */
  const [previewMap, setPreviewMap] = useState<Record<Grade, number> | null>(null);
  /** 本卡开始时刻，用于统计单卡耗时；挂载与切卡时在事件/effect 中写入 */
  const cardStartRef = useRef<number>(0);

  // 挂载即开始计时（父级换队列时通过 key 重挂载，故此处无需依赖 queue）
  useEffect(() => {
    cardStartRef.current = Date.now();
    return () => stopSpeak();
  }, []);

  /** 切到下一/上一张：重置翻面态与计时（在事件处理中做，不放 effect） */
  const gotoIndex = (next: number) => {
    stopSpeak();
    setFlipped(false);
    setMnemonicOpen(false);
    setPreviewMap(null);
    cardStartRef.current = Date.now();
    onIndexChange(next);
  };

  // 父级持有的序号换批瞬间可能越界，钳到有效范围以免误显示空态
  const idx = Math.max(0, Math.min(index, queue.length - 1));
  const card = queue[idx];

  const advance = () => {
    if (idx + 1 >= queue.length) {
      onDone();
    } else {
      gotoIndex(idx + 1);
    }
  };

  const doRate = async (grade: Grade) => {
    if (!card || busy || !flipped) return;
    setBusy(true);
    const durationMs = Date.now() - cardStartRef.current;
    try {
      await rateCard(card, grade, durationMs);
      advance();
    } catch (err) {
      // 写库失败不翻卡：store 已置 lastError，保持当前卡让用户重评
      console.error('[VocabCardFlow] 评分失败:', err);
    } finally {
      setBusy(false);
    }
  };

  // 翻面后自动播一次，并算出四按钮预览间隔
  const handleFlip = () => {
    if (flipped) return;
    setFlipped(true);
    setPreviewMap(previewIntervals(card, new Date().toISOString()));
    if (getTtsConfig().autoPlayOnFlip) speak(card.word);
  };

  // 键盘流：派发逻辑放进 ref，每次渲染后刷新闭包捕获最新 card/flipped 等；
  // 监听器只在挂载时绑一次，避免每切一卡重绑（依赖含每次渲染新建的 handleFlip/advance/doRate，故每渲染都刷新）
  const keyDispatchRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyDispatchRef.current = (e: KeyboardEvent) => {
      if (!card || mnemonicOpen) return;
      if (e.key === ' ') { e.preventDefault(); if (!flipped) handleFlip(); return; }
      if (e.key.toLowerCase() === 's') { e.preventDefault(); speak(card.word); return; }
      if (e.key.toLowerCase() === 'n') { e.preventDefault(); advance(); return; }
      const g = RATING_BUTTONS.find(b => b.key === e.key);
      if (g && flipped) { e.preventDefault(); void doRate(g.grade); }
    };
  }, [card, flipped, mnemonicOpen, handleFlip, advance, doRate]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyDispatchRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const previews = flipped ? previewMap : null;

  if (!card) {
    return (
      <div className="vocab-empty">
        <p className="placeholder-text">今日队列已清空 🎉</p>
        <p className="vocab-empty-sub">学习中 · 到期复习 · 新词均已处理，可切换其他标签或明天再来。</p>
      </div>
    );
  }

  const total = queue.length;
  const pct = Math.round((idx / total) * 100);
  const phonetics = getPhonetics(card.word);
  const phoneticText = [
    phonetics.uk ? `英 ${phonetics.uk}` : '',
    phonetics.us ? `美 ${phonetics.us}` : '',
  ].filter(Boolean).join(' · ');

  return (
    <div className="vocab-cardflow">
      <div className="vocab-cardflow-meta">
        <span>第 {idx + 1}/{total} 张</span>
        <span className="vocab-cardflow-tag">
          <i className={`dot ${card.coreZone ? 'core' : 'base'}`} />
          {card.coreZone ? '核心区' : '基础区'} · {card.unit}
          {card.state !== 'new' && <> · {stateLabel(card.state)}</>}
        </span>
        <span className="vocab-cardflow-nav">
          <button className="icon-btn" disabled={idx === 0} onClick={() => gotoIndex(Math.max(0, idx - 1))} title="上一张"><ChevronLeft size={16} /></button>
          <button className="icon-btn" onClick={advance} title="下一张 (N)"><ChevronRight size={16} /></button>
        </span>
      </div>

      <div className={`vocab-card${flipped ? ' flipped' : ''}`} onClick={handleFlip}>
        <div className="vocab-card-front">
          <div className="vocab-card-word">{card.word}</div>
          {phoneticText && <div className="vocab-card-phonetic">{phoneticText}</div>}
          <div className="vocab-card-hint">空格 / 点按翻面</div>
          <button className="vocab-speak-btn" onClick={(e) => { e.stopPropagation(); speak(card.word); }} title="播放 (S)"><Volume2 size={18} /></button>
        </div>
        {flipped && (
          <>
            <div className="vocab-card-divider" />
            <div className="vocab-card-meaning">{card.meaning}</div>
          </>
        )}
      </div>

      <div className="vocab-card-progress">
        <div className="vocab-card-progress-bar" style={{ width: `${pct}%` }} />
      </div>

      <div className="vocab-card-actions">
        {flipped ? RATING_BUTTONS.map((b) => (
          <button
            key={b.key}
            className={`vocab-rate-btn ${b.cls}${busy ? ' disabled' : ''}`}
            disabled={busy}
            onClick={() => void doRate(b.grade)}
            title={`快捷键 ${b.key}`}
          >
            <span className="vocab-rate-key">{b.key}</span>
            <span className="vocab-rate-label">{b.label}</span>
            {previews && <span className="vocab-rate-interval">{fmtInterval(previews[b.grade])}</span>}
          </button>
        )) : (
          <div className="vocab-card-actions-idle">翻面后评分（1 重来 · 2 困难 · 3 良好 · 4 简单）</div>
        )}
      </div>

      <div className="vocab-card-foot">
        <button className="exam-ghost-btn" onClick={() => void addHardword(card.wordId, '手动收藏')} title="加入难词本"><Star size={13} /> 难词本</button>
        <button className="exam-ghost-btn" onClick={() => setMnemonicOpen(true)} title="AI 助记"><Sparkles size={13} /> AI 助记</button>
      </div>

      {mnemonicOpen && (
        <VocabMnemonicSheet word={card.word} meaning={card.meaning} wordId={card.wordId} onClose={() => setMnemonicOpen(false)} />
      )}
    </div>
  );
}

function stateLabel(s: VocabQueueItem['state']): string {
  switch (s) {
    case 'learning': return '学习中';
    case 'review': return '复习';
    case 'relearning': return '重学';
    default: return '';
  }
}
