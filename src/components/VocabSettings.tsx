import { useState } from 'react';
import {
  CloudUpload, CloudDownload, ChevronDown, RefreshCw,
} from 'lucide-react';
import { useExamVocabStore } from '../stores/exam-vocab-store';
import { getTtsConfig, saveTtsConfig } from '../lib/vocab-tts';
import type { TtsSource } from '../lib/vocab-tts';

/** 设置面板：方向 / 保留率 / 最大复习 / 三阶段 / 发音 / 重导词表 / 云备份恢复 */
export function VocabSettings({ busy, msg, onBackup, onRestore }: {
  busy: boolean;
  msg: string;
  onBackup: () => void;
  onRestore: () => void;
}) {
  const profile = useExamVocabStore((s) => s.profile);
  const saveProfile = useExamVocabStore((s) => s.saveProfile);
  const switchDirection = useExamVocabStore((s) => s.switchDirection);
  const reimportWords = useExamVocabStore((s) => s.reimportWords);
  const lastError = useExamVocabStore((s) => s.lastError);

  const [tts, setTts] = useState(getTtsConfig());
  const [importMsg, setImportMsg] = useState('');
  const [reimportBusy, setReimportBusy] = useState(false);
  const [maxR, setMaxR] = useState(String(profile.maxReviewsPerDay));
  const [retention, setRetention] = useState(String(profile.targetRetention));

  const updateTts = (patch: Partial<typeof tts>) => {
    const next = saveTtsConfig(patch);
    setTts(next);
  };

  const commitNum = (raw: string, min: number, cur: number, apply: (n: number) => void, reset: (s: string) => void) => {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= min) apply(n);
    else reset(String(cur));
  };

  const doReimport = async () => {
    setReimportBusy(true);
    setImportMsg('');
    try {
      const r = await reimportWords();
      setImportMsg(`已重导：新增 ${r.imported} · 已存在 ${r.skipped}`);
    } catch (err) {
      setImportMsg(`重导失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setReimportBusy(false);
    }
  };

  return (
    <div className="vocab-settings">
      {/* 方向 */}
      <div className="vocab-settings-subtitle">卡片方向</div>
      <div className="vocab-dir-row">
        {(['en2zh', 'zh2en', 'both'] as const).map((d) => (
          <button
            key={d}
            className={`vocab-dir-btn${profile.cardDirection === d ? ' active' : ''}`}
            onClick={() => void switchDirection(d)}
          >
            {d === 'en2zh' ? '看词写义' : d === 'zh2en' ? '看义写词' : '双向（两倍量）'}
          </button>
        ))}
      </div>

      <div className="vocab-settings-grid">
        <label className="vocab-field">
          <span className="vocab-field-label">目标保留率</span>
          <input
            type="number" min={0.7} max={0.99} step={0.01} value={retention}
            onChange={(e) => setRetention(e.target.value)}
            onBlur={() => commitNum(retention, 0.7, profile.targetRetention, (n) => { void saveProfile({ targetRetention: Math.min(0.99, n) }); }, setRetention)}
          />
        </label>
        <label className="vocab-field">
          <span className="vocab-field-label">每日最大复习</span>
          <input
            type="number" min={20} value={maxR}
            onChange={(e) => setMaxR(e.target.value)}
            onBlur={() => commitNum(maxR, 20, profile.maxReviewsPerDay, (n) => { void saveProfile({ maxReviewsPerDay: Math.floor(n) }); }, setMaxR)}
          />
        </label>
      </div>

      {/* 三阶段 */}
      <div className="vocab-settings-subtitle">三阶段新词配额</div>
      <PhaseRow label="阶段一" start={profile.phase1Start} end={profile.phase1End} perDay={profile.phase1NewPerDay}
        onStart={(v) => void saveProfile({ phase1Start: v })} onEnd={(v) => void saveProfile({ phase1End: v })} onPerDay={(n) => void saveProfile({ phase1NewPerDay: n })} />
      <PhaseRow label="阶段二" start={profile.phase2Start} end={profile.phase2End} perDay={profile.phase2NewPerDay}
        onStart={(v) => void saveProfile({ phase2Start: v })} onEnd={(v) => void saveProfile({ phase2End: v })} onPerDay={(n) => void saveProfile({ phase2NewPerDay: n })} />
      <PhaseRow label="阶段三" start={profile.phase3Start} end={profile.phase3End} perDay={profile.phase3NewPerDay}
        onStart={(v) => void saveProfile({ phase3Start: v })} onEnd={(v) => void saveProfile({ phase3End: v })} onPerDay={(n) => void saveProfile({ phase3NewPerDay: n })} />

      {/* 发音 */}
      <div className="vocab-settings-subtitle">发音</div>
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
        <label className="vocab-field vocab-field-row">
          <span className="vocab-field-label">翻面自动播放</span>
          <label className="vocab-switch" title={tts.autoPlayOnFlip ? '点击关闭' : '点击开启'}>
            <input type="checkbox" checked={tts.autoPlayOnFlip} onChange={(e) => updateTts({ autoPlayOnFlip: e.target.checked })} />
            <span className="vocab-slider" />
          </label>
        </label>
      </div>

      {/* 重导 + 云 */}
      <div className="vocab-cloud-row">
        <button className="exam-ghost-btn" disabled={reimportBusy} onClick={doReimport}>
          <RefreshCw size={13} /> {reimportBusy ? '重导中…' : '重导词表'}
        </button>
        <button className="exam-ghost-btn" disabled={busy} onClick={onBackup}><CloudUpload size={13} /> 备份到云盘</button>
        <button className="exam-ghost-btn" disabled={busy} onClick={onRestore}><CloudDownload size={13} /> 从云盘恢复</button>
      </div>
      {importMsg && <div className="exam-cloud-msg">{importMsg}</div>}
      {(msg || lastError) && <div className="exam-cloud-msg">{msg || lastError}</div>}
      <div className="vocab-settings-hint">
        <ChevronDown size={11} /> 阶段三新词配额为 0 即停新词只复习；保留率越高记忆越牢但复习量越大；重导词表按 word 去重，已学词调度不丢。
      </div>
    </div>
  );
}

function PhaseRow({ label, start, end, perDay, onStart, onEnd, onPerDay }: {
  label: string;
  start: string;
  end: string;
  perDay: number;
  onStart: (v: string) => void;
  onEnd: (v: string) => void;
  onPerDay: (n: number) => void;
}) {
  const [perDayStr, setPerDayStr] = useState(String(perDay));
  return (
    <div className="vocab-phase-row">
      <span className="vocab-phase-label">{label}</span>
      <input type="date" value={start} onChange={(e) => { if (e.target.value) onStart(e.target.value); }} />
      <span>至</span>
      <input type="date" value={end} onChange={(e) => { if (e.target.value) onEnd(e.target.value); }} />
      <label className="vocab-phase-perday">
        <span>新词/天</span>
        <input
          type="number" min={0} value={perDayStr}
          onChange={(e) => setPerDayStr(e.target.value)}
          onBlur={() => {
            const n = parseInt(perDayStr, 10);
            if (Number.isFinite(n) && n >= 0) onPerDay(n);
            else setPerDayStr(String(perDay));
          }}
        />
      </label>
    </div>
  );
}
