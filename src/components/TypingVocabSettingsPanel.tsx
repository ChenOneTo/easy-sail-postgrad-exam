/**
 * 打字背单词——设置面板（词库 / 练习 / 发音 / 音效 / 数据备份）。
 *
 * 模块内的所有设置都存在自己的 `typing_vocab_profile` 表里，不去读写
 * 背单词模块的发音设置，避免两个模块互相影响。
 */
import { useRef, useState } from 'react';
import {
  Download, FileUp, Trash2, Upload, Volume2,
} from 'lucide-react';
import { isTauri } from '../lib/tauri';
import { errText } from '../lib/error-text';
import { parseTypingWordFile } from '../lib/typing-vocab-import';
import { playTypingSound } from '../lib/typing-vocab-sound';
import { speakTypingWord } from '../lib/typing-vocab-speech';
import { isSpeaking, useTypingPlayback } from '../hooks/use-speak-playback';
import type {
  TypingAccent, TypingBackup, TypingBook, TypingMode, TypingPlan, TypingProfile, TypingWordSeed,
} from '../lib/typing-vocab-db';

interface Props {
  books: TypingBook[];
  profile: TypingProfile;
  saveProfile: (updates: Partial<TypingProfile>) => Promise<void>;
  onImportBook: (name: string, seeds: TypingWordSeed[]) => Promise<{ imported: number; bookId: number }>;
  onRemoveBook: (bookId: number) => Promise<void>;
  onExport: () => Promise<TypingBackup>;
  onRestore: (data: TypingBackup) => Promise<void>;
}

/** 试听用的示例词（与练习页试听按钮保持一致） */
const SAMPLE_WORD = 'example';

const MODES: { id: TypingMode; label: string; desc: string }[] = [
  { id: 'follow', label: '跟打', desc: '显示单词逐字母跟打' },
  { id: 'dictation', label: '听写', desc: '听发音拼写' },
  { id: 'selftest', label: '自测', desc: '看释义想英文' },
  { id: 'recall', label: '默写', desc: '看释义盲写' },
];

export function TypingVocabSettingsPanel({
  books, profile, saveProfile, onImportBook, onRemoveBook, onExport, onRestore,
}: Props) {
  const importRef = useRef<HTMLInputElement>(null);
  const backupRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  /** 发音播放态：播放期间试听按钮显示动效并禁用 */
  const playback = useTypingPlayback();
  const speaking = isSpeaking(playback, SAMPLE_WORD);

  const handleWordFile = async (file: File | undefined) => {
    if (!file) return;
    setNotice('');
    try {
      const { name, seeds } = parseTypingWordFile(await file.text(), file.name);
      const result = await onImportBook(name, seeds);
      setNotice(`已导入词库「${name}」，${result.imported} 个单词`);
    } catch (err) {
      setNotice(`导入失败：${errText(err)}`);
    }
  };

  const handleExport = async () => {
    setBusy(true);
    setNotice('');
    try {
      const data = await onExport();
      const json = JSON.stringify(data, null, 2);
      const fileName = `typing-vocab-backup-${new Date().toISOString().slice(0, 10)}.json`;
      if (isTauri()) {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const { writeTextFile } = await import('@tauri-apps/plugin-fs');
        const path = await save({
          title: '导出打字背单词数据',
          defaultPath: fileName,
          filters: [{ name: 'JSON 文件', extensions: ['json'] }],
        });
        if (!path) { setBusy(false); return; }
        await writeTextFile(path, json);
        setNotice(`已导出到 ${path}`);
      } else {
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
        setNotice('已导出备份文件');
      }
    } catch (err) {
      setNotice(`导出失败：${errText(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreFile = async (file: File | undefined) => {
    if (!file) return;
    if (!window.confirm('恢复备份会覆盖本模块现有的全部词库与练习记录，确定继续？')) return;
    setBusy(true);
    setNotice('');
    try {
      const data = JSON.parse(await file.text()) as TypingBackup;
      await onRestore(data);
      setNotice('备份已恢复');
    } catch (err) {
      setNotice(`恢复失败：${errText(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="typing-settings-panel">
      {notice && <div className="typing-notice">{notice}</div>}

      <div className="typing-panel">
        <h3>词库</h3>
        <div className="typing-settings-row">
          <label className="typing-field typing-field-grow">
            <span>当前词库</span>
            <select
              value={profile.activeBookId}
              onChange={(e) => void saveProfile({ activeBookId: Number(e.target.value) })}
            >
              {books.map((book) => (
                <option key={book.id} value={book.id}>
                  {book.name}（{book.wordCount} 词）
                </option>
              ))}
            </select>
          </label>
          <button className="typing-ghost-btn" onClick={() => importRef.current?.click()}>
            <FileUp size={14} /> 导入词库
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".json,.txt,.csv,.tsv"
            className="typing-file-input"
            onChange={(e) => { void handleWordFile(e.target.files?.[0]); e.target.value = ''; }}
          />
        </div>
        <p className="typing-hint">
          支持 JSON（{'{"name":"我的词库","words":[["word","释义"]]}'}）与纯文本（每行「单词 + Tab/逗号 + 释义」）。
        </p>
        <ul className="typing-book-list">
          {books.map((book) => (
            <li key={book.id}>
              <span>{book.name}</span>
              <span className="typing-book-count">{book.wordCount} 词</span>
              {book.builtin ? (
                <span className="typing-mini-tag">内置</span>
              ) : (
                <button
                  className="typing-icon-btn danger"
                  title="删除词库"
                  onClick={async () => {
                    if (!window.confirm(`删除词库「${book.name}」及其学习记录？`)) return;
                    try {
                      await onRemoveBook(book.id);
                      setNotice(`已删除词库「${book.name}」`);
                    } catch (err) {
                      setNotice(`删除失败：${errText(err)}`);
                    }
                  }}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="typing-panel">
        <h3>练习</h3>
        <div className="typing-settings-row">
          <label className="typing-field">
            <span>默认模式</span>
            <select value={profile.mode} onChange={(e) => void saveProfile({ mode: e.target.value as TypingMode })}>
              {MODES.map((m) => <option key={m.id} value={m.id}>{m.label} — {m.desc}</option>)}
            </select>
          </label>
          <label className="typing-field">
            <span>出题方式</span>
            <select value={profile.plan} onChange={(e) => void saveProfile({ plan: e.target.value as TypingPlan })}>
              <option value="smart">智能（按记忆曲线）</option>
              <option value="free">自由（按词库顺序）</option>
            </select>
          </label>
        </div>
        <div className="typing-settings-grid">
          <label className="typing-field">
            <span>每组词数</span>
            <input
              type="number" min={5} max={200} value={profile.sessionSize}
              onChange={(e) => void saveProfile({ sessionSize: Math.max(5, Math.min(200, Number(e.target.value) || 20)) })}
            />
          </label>
          <label className="typing-field">
            <span>每日新词上限</span>
            <input
              type="number" min={0} max={300} value={profile.dailyNew}
              onChange={(e) => void saveProfile({ dailyNew: Math.max(0, Math.min(300, Number(e.target.value) || 0)) })}
            />
          </label>
          <label className="typing-field">
            <span>每日复习上限</span>
            <input
              type="number" min={0} max={600} value={profile.dailyReview}
              onChange={(e) => void saveProfile({ dailyReview: Math.max(0, Math.min(600, Number(e.target.value) || 0)) })}
            />
          </label>
        </div>
        <div className="typing-switch-list">
          <SwitchRow
            label="自动进入下一个词"
            hint="答错的词会停下来等你看答案"
            checked={profile.autoNext}
            onChange={(v) => void saveProfile({ autoNext: v })}
          />
          <SwitchRow
            label="忽略大小写"
            checked={profile.ignoreCase}
            onChange={(v) => void saveProfile({ ignoreCase: v })}
          />
          <SwitchRow
            label="显示音标"
            checked={profile.showPhonetic}
            onChange={(v) => void saveProfile({ showPhonetic: v })}
          />
          <SwitchRow
            label="显示中文释义"
            checked={profile.showMeaning}
            onChange={(v) => void saveProfile({ showMeaning: v })}
          />
        </div>
      </div>

      <div className="typing-panel">
        <h3>发音</h3>
        <div className="typing-settings-row">
          <SwitchRow
            label="单词朗读"
            hint="使用系统语音合成，离线可用"
            checked={profile.ttsOn}
            onChange={(v) => void saveProfile({ ttsOn: v })}
          />
          <label className="typing-field">
            <span>口音</span>
            <select value={profile.accent} onChange={(e) => void saveProfile({ accent: e.target.value as TypingAccent })}>
              <option value="us">美式</option>
              <option value="uk">英式</option>
            </select>
          </label>
          <label className="typing-field">
            <span>语速 {profile.ttsRate.toFixed(1)}</span>
            <input
              type="range" min={0.6} max={1.2} step={0.1} value={profile.ttsRate}
              onChange={(e) => void saveProfile({ ttsRate: Number(e.target.value) })}
            />
          </label>
          <button
            className={`typing-ghost-btn${speaking ? ' is-speaking' : ''}`}
            onClick={() => speakTypingWord(SAMPLE_WORD)}
            aria-busy={speaking}
            disabled={playback.playing}
            title={playback.playing ? '正在播放…' : '按当前设置试听'}
          >
            <Volume2 size={14} /> 试听
          </button>
        </div>
      </div>

      <div className="typing-panel">
        <h3>键盘音效</h3>
        <div className="typing-settings-row">
          <SwitchRow
            label="按键音效"
            hint="实时合成，无需音频资源"
            checked={profile.soundOn}
            onChange={(v) => void saveProfile({ soundOn: v })}
          />
          <label className="typing-field">
            <span>音量 {Math.round(profile.soundVolume * 100)}%</span>
            <input
              type="range" min={0} max={1} step={0.05} value={profile.soundVolume}
              onChange={(e) => void saveProfile({ soundVolume: Number(e.target.value) })}
            />
          </label>
          <button className="typing-ghost-btn" onClick={() => playTypingSound('key')}>
            <Volume2 size={14} /> 试听
          </button>
        </div>
      </div>

      <div className="typing-panel">
        <h3>数据备份</h3>
        <p className="typing-hint">备份只包含本模块的词库、记忆进度与练习记录，不涉及其它模块数据。</p>
        <div className="typing-settings-row">
          <button className="typing-ghost-btn" onClick={() => void handleExport()} disabled={busy}>
            <Download size={14} /> 导出备份
          </button>
          <button className="typing-ghost-btn" onClick={() => backupRef.current?.click()} disabled={busy}>
            <Upload size={14} /> 恢复备份
          </button>
          <input
            ref={backupRef}
            type="file"
            accept=".json"
            className="typing-file-input"
            onChange={(e) => { void handleRestoreFile(e.target.files?.[0]); e.target.value = ''; }}
          />
        </div>
      </div>
    </section>
  );
}

function SwitchRow({
  label, hint, checked, onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="typing-switch-row">
      <span className="typing-switch-text">
        <b>{label}</b>
        {hint && <em>{hint}</em>}
      </span>
      <span className="typing-switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="typing-switch-slider" />
      </span>
    </label>
  );
}
