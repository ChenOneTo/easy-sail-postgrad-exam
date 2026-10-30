import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, X, Loader2, RefreshCw, Volume2 } from 'lucide-react';
import { useAiTask } from '../hooks/useAiTask';
import { getPhonetics } from '../lib/vocab-phonetics';
import { fetchVocabMnemonic, saveVocabMnemonic } from '../lib/exam-vocab-db';
import { useExamVocabStore } from '../stores/exam-vocab-store';
import { isTauri } from '../lib/tauri';
import { speak, stopSpeak } from '../lib/vocab-tts';
import type { AiMnemonicDraft } from '../lib/ai-json';

/**
 * 单词 AI 助记浮层：词根拆解 + 联想口诀 + 一句例句。
 * 复用 useAiTask 链路；脏数据降级丢弃不抛错。
 *
 * 助记持久化：首次生成后写入 exam_vocab_mnemonics（按 word_id 唯一），
 * 之后打开同一词直接读库展示、不再调 AI，点「重新生成」才覆盖重算。
 */
export function VocabMnemonicSheet({ word, meaning, wordId, onClose }: {
  word: string;
  meaning: string;
  wordId: number;
  onClose: () => void;
}) {
  const { generateMnemonic, loading, error } = useAiTask();
  const [draft, setDraft] = useState<AiMnemonicDraft | null>(null);
  /** 首次读库阶段（查已有助记），避免读库瞬间的空白闪烁 */
  const [checking, setChecking] = useState(true);
  const startedRef = useRef(false);
  const phonetics = getPhonetics(word);

  /** 落库保存（失败不影响展示；非 Tauri 无库可存则跳过） */
  const save = useCallback(async (d: AiMnemonicDraft) => {
    if (!isTauri()) return;
    try {
      await saveVocabMnemonic(wordId, d);
      // AI 助记在云盘快照里，标记为脏才能被自动同步带上云盘
      useExamVocabStore.setState({ vocabDirty: true });
    } catch (err) {
      console.warn('[VocabMnemonicSheet] 助记保存失败:', err);
    }
  }, [wordId]);

  /** 调 AI 生成并保存 */
  const doGenerate = useCallback(async () => {
    const r = await generateMnemonic(word, meaning);
    if (r) {
      setDraft(r);
      void save(r);
    }
  }, [generateMnemonic, word, meaning, save]);

  // 首次展开：已有助记直接读库展示；没有才生成并落库。
  // ref 兜住 StrictMode 双挂载与重渲染，避免重复请求/重复落库。
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      try {
        if (isTauri()) {
          try {
            const saved = await fetchVocabMnemonic(wordId);
            // 旧版助记没有 method/scene，按未缓存处理，重新生成生动画面
            if (saved && (saved.scene || saved.method)) {
              setDraft({
                mnemonic: saved.mnemonic,
                roots: saved.roots,
                method: saved.method,
                scene: saved.scene,
                sentence: saved.sentence,
                sentenceZh: saved.sentenceZh,
              });
              return;
            }
          } catch { /* 表尚未迁移等，降级为现场生成 */ }
        }
        await doGenerate();
      } finally {
        setChecking(false);
      }
    })();
  }, [wordId, doGenerate]);

  // 关闭浮层即停例句朗读
  useEffect(() => () => stopSpeak(), []);

  const busy = loading || checking;

  return (
    <div className="vocab-mnemonic-overlay" onClick={onClose}>
      <div className="vocab-mnemonic-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="vocab-mnemonic-head">
          <span className="vocab-mnemonic-title"><Sparkles size={14} /> AI 助记 · {word}</span>
          {(phonetics.uk || phonetics.us) && (
            <span className="vocab-mnemonic-phonetic">
              {phonetics.uk && `英 ${phonetics.uk}`}
              {phonetics.uk && phonetics.us && ' · '}
              {phonetics.us && `美 ${phonetics.us}`}
            </span>
          )}
          <button className="icon-btn" onClick={onClose}><X size={14} /></button>
        </div>
        {busy && (
          <div className="vocab-mnemonic-loading">
            <Loader2 size={16} className="spin" /> {loading ? '正在生成助记…' : '正在加载助记…'}
          </div>
        )}
        {error && !busy && (
          <div className="vocab-mnemonic-error">生成失败：{error} <button className="exam-ghost-btn" onClick={() => void doGenerate()}>重试</button></div>
        )}
        {draft && !busy && !error && (
          <>
            <div className="vocab-mnemonic-body">
              {draft.method && (
                <div className="vocab-mnemonic-row"><span className="vocab-mnemonic-label">方法</span><span>{draft.method}</span></div>
              )}
              {draft.roots && (
                <div className="vocab-mnemonic-row"><span className="vocab-mnemonic-label">词根</span><span>{draft.roots}</span></div>
              )}
              <div className="vocab-mnemonic-row"><span className="vocab-mnemonic-label">助记</span><span>{draft.mnemonic}</span></div>
              {draft.scene && (
                <div className="vocab-mnemonic-row"><span className="vocab-mnemonic-label">画面</span><span>{draft.scene}</span></div>
              )}
              {draft.sentence && (
                <div className="vocab-mnemonic-row">
                  <span className="vocab-mnemonic-label">例句</span>
                  <div className="vocab-mnemonic-sentence">
                    <div className="vocab-mnemonic-sentence-en">
                      <span>{draft.sentence}</span>
                      <button
                        className="vocab-mnemonic-speak"
                        onClick={() => speak(draft.sentence)}
                        title="播放例句"
                      ><Volume2 size={13} /></button>
                    </div>
                    {draft.sentenceZh && <div className="vocab-mnemonic-sentence-zh">{draft.sentenceZh}</div>}
                  </div>
                </div>
              )}
            </div>
            <div className="vocab-mnemonic-foot">
              <button className="exam-ghost-btn" onClick={() => void doGenerate()} title="重新调用 AI 生成并覆盖当前助记">
                <RefreshCw size={13} /> 重新生成
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
