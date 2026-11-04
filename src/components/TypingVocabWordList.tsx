/**
 * 打字背单词——单词列表（生词本 / 收藏 / 已掌握共用）。
 */
import { useMemo, useState } from 'react';
import {
  Check, Eraser, Play, RotateCcw, Search, Star, StarOff, Volume2,
} from 'lucide-react';
import type { TypingQueueItem } from '../lib/typing-vocab-db';
import { speakTypingWord } from '../lib/typing-vocab-speech';

type ListKind = 'wrong' | 'favorite' | 'mastered';

interface Props {
  kind: ListKind;
  title: string;
  subtitle: string;
  emptyText: string;
  items: TypingQueueItem[];
  onDrill?: () => void;
  onToggleFavorite: (item: TypingQueueItem) => void;
  onSetMastered: (item: TypingQueueItem, mastered: boolean) => void;
  onReset: (item: TypingQueueItem) => void;
}

export function TypingVocabWordList({
  kind, title, subtitle, emptyText, items, onDrill,
  onToggleFavorite, onSetMastered, onReset,
}: Props) {
  const [keyword, setKeyword] = useState('');

  const visible = useMemo(() => {
    const key = keyword.trim().toLowerCase();
    if (!key) return items;
    return items.filter((item) => item.word.toLowerCase().includes(key) || item.meaning.toLowerCase().includes(key));
  }, [items, keyword]);

  return (
    <section className="typing-list-panel">
      <header className="typing-panel-head">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <div className="typing-panel-ops">
          <div className="typing-search">
            <Search size={13} />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索单词或释义"
            />
          </div>
          {onDrill && (
            <button className="typing-btn typing-btn-sm" onClick={onDrill} disabled={items.length === 0}>
              <Play size={13} /> 专项练习
            </button>
          )}
        </div>
      </header>

      {visible.length === 0 ? (
        <p className="placeholder-text">{items.length === 0 ? emptyText : '没有匹配的单词'}</p>
      ) : (
        <ul className="typing-word-list">
          {visible.map((item) => (
            <li key={item.id} className="typing-word-row">
              <div className="typing-word-main">
                <div className="typing-word-line">
                  <b>{item.word}</b>
                  {(item.phoneticUs || item.phoneticUk) && (
                    <span className="typing-word-phonetic">{item.phoneticUs || item.phoneticUk}</span>
                  )}
                  {item.unit && <span className="typing-word-unit">{item.unit}</span>}
                </div>
                <p className="typing-word-meaning">{item.meaning}</p>
                <div className="typing-word-tags">
                  {item.isNew && <span className="typing-mini-tag">未学</span>}
                  {item.wrongCount > 0 && <span className="typing-mini-tag danger">错 {item.wrongCount} 次</span>}
                  {item.correctCount > 0 && <span className="typing-mini-tag ok">对 {item.correctCount} 次</span>}
                  {item.stage > 0 && <span className="typing-mini-tag">阶段 {item.stage}</span>}
                  {item.favorited && <span className="typing-mini-tag star">已收藏</span>}
                  {item.mastered && <span className="typing-mini-tag ok">已掌握</span>}
                </div>
              </div>
              <div className="typing-word-actions">
                <button className="typing-icon-btn" title="朗读" onClick={() => speakTypingWord(item.word)}>
                  <Volume2 size={15} />
                </button>
                {kind !== 'favorite' && (
                  <button
                    className="typing-icon-btn"
                    title={item.favorited ? '取消收藏' : '收藏'}
                    onClick={() => onToggleFavorite(item)}
                  >
                    {item.favorited ? <Star size={15} /> : <StarOff size={15} />}
                  </button>
                )}
                {!item.mastered ? (
                  <button className="typing-icon-btn" title="标记已掌握" onClick={() => onSetMastered(item, true)}>
                    <Check size={15} />
                  </button>
                ) : (
                  <button className="typing-icon-btn" title="取消已掌握" onClick={() => onSetMastered(item, false)}>
                    <RotateCcw size={15} />
                  </button>
                )}
                <button className="typing-icon-btn" title="重置记忆进度" onClick={() => onReset(item)}>
                  <Eraser size={15} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
