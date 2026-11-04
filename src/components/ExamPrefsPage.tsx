/**
 * 考研英语 · 偏好设置
 *
 * 各子页面共用的偏好集中在此（当前只有发音）。发音配置按设备存于
 * localStorage（见 lib/vocab-tts.ts），不落库、不参与云备份。
 */
import { useState } from 'react';
import { SlidersHorizontal, Volume2, ChevronDown } from 'lucide-react';
import { getTtsConfig, saveTtsConfig, speak, stopSpeak } from '../lib/vocab-tts';
import type { TtsSource } from '../lib/vocab-tts';
import { isSpeaking, useVocabPlayback } from '../hooks/use-speak-playback';

/** 试听用的示例词（词库内常见词，有道/百度音源均有音频） */
const SAMPLE_WORD = 'syllabus';

export function ExamPrefsPage() {
  const [tts, setTts] = useState(getTtsConfig());
  const playback = useVocabPlayback();
  const speaking = isSpeaking(playback, SAMPLE_WORD);

  const updateTts = (patch: Partial<typeof tts>) => {
    setTts(saveTtsConfig(patch));
  };

  return (
    <div className="exam-prefs-page">
      <header className="exam-vocab-header">
        <div>
          <h2><SlidersHorizontal size={18} /> 偏好设置</h2>
          <p className="exam-vocab-sub">
            背单词、单词闯关等页面的公共偏好；按设备保存，不参与云备份
          </p>
        </div>
      </header>

      <section className="vocab-settings">
        <div className="exam-prefs-card-head">
          <span className="exam-prefs-card-title"><Volume2 size={14} /> 发音</span>
          <button
            className={`exam-ghost-btn${speaking ? ' is-speaking' : ''}`}
            disabled={tts.source === 'off' || playback.playing}
            title={tts.source === 'off' ? '发音源已关闭' : playback.playing ? '正在播放…' : '按当前设置试听'}
            onClick={() => { stopSpeak(); speak(SAMPLE_WORD); }}
          >
            试听
          </button>
        </div>

        <div className="vocab-settings-grid">
          <label className="vocab-field">
            <span className="vocab-field-label">发音源</span>
            <select value={tts.source} onChange={(e) => updateTts({ source: e.target.value as TtsSource })}>
              <option value="system">系统 TTS（离线）</option>
              <option value="online">在线真人（联网）</option>
              <option value="off">关闭</option>
            </select>
          </label>
          <label className="vocab-field">
            <span className="vocab-field-label">口音（在线）</span>
            <select value={tts.accent} onChange={(e) => updateTts({ accent: Number(e.target.value) as 1 | 2 })}>
              <option value={2}>美音</option>
              <option value={1}>英音</option>
            </select>
          </label>
          <label className="vocab-field">
            <span className="vocab-field-label">语速（0.7–1.2）</span>
            <input
              type="number" min={0.7} max={1.2} step={0.05} value={tts.rate}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) updateTts({ rate: Math.min(1.2, Math.max(0.7, n)) });
              }}
            />
          </label>
          <div className="vocab-field vocab-field-row">
            <span className="vocab-field-label">翻面自动播放</span>
            <label className="vocab-switch" title={tts.autoPlayOnFlip ? '点击关闭' : '点击开启'}>
              <input type="checkbox" checked={tts.autoPlayOnFlip} onChange={(e) => updateTts({ autoPlayOnFlip: e.target.checked })} />
              <span className="vocab-slider" />
            </label>
          </div>
        </div>
        <div className="vocab-settings-hint">
          <ChevronDown size={11} /> 口音与语速同时作用于系统 TTS 与在线音源；在线播放失败会自动回退系统 TTS。
        </div>
      </section>
    </div>
  );
}
