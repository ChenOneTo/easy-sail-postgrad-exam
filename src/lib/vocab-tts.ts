/**
 * 背单词发音封装（无新增依赖、无 Rust 改动）。
 *
 * - 系统 TTS：WebView2（Edge Chromium）/ WKWebView 原生支持 window.speechSynthesis，离线可用。
 * - 在线单词：有道词典 dictvoice（type=2 美音 / type=1 英音）；但它只对词库词条有音频，
 *   整句一律回 500，因此例句改走百度翻译 TTS（gettts），同样无需密钥。
 * - 在线音频必须由 Rust 侧取字节（tauri-plugin-http）：WebView 里 `<audio src>` 会把
 *   `tauri://localhost` 当 Referer 发出去，百度据此返回 200 + 0 字节，表现为
 *   「设了在线真人却仍是离线读音」。
 * - 在线播放失败（限流/断网/超时）按音源顺序换源，全部失败再回退系统 TTS，不抛错。
 *
 * 发音运行时合成，不落库；设置项按设备存于 localStorage（发音源/语速/翻面自动播）。
 * 播放态通过 subscribeSpeakPlayback 暴露：按钮据此显示播放动效，播放期间禁止重复点击。
 */

import { isTauri } from './tauri';
import { createSpeechPlayback, watchSpeechSynthesisEnd } from './speech-playback';
import type { SpeechPlayback } from './speech-playback';

export type TtsSource = 'system' | 'online' | 'off';

export interface VocabTtsConfig {
  source: TtsSource;
  rate: number;            // 0.7–1.2
  autoPlayOnFlip: boolean;
  accent: 1 | 2;           // 在线接口 type：1=英音 2=美音
}

const STORAGE_KEY = 'easysail-exam-vocab-tts';
const DEFAULT_CONFIG: VocabTtsConfig = {
  source: 'system',
  rate: 0.9,
  autoPlayOnFlip: true,
  accent: 2,
};

let _config: VocabTtsConfig | null = null;

function readConfig(): VocabTtsConfig {
  if (_config) return _config;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<VocabTtsConfig>;
      _config = { ...DEFAULT_CONFIG, ...parsed };
    } else {
      _config = { ...DEFAULT_CONFIG };
    }
  } catch {
    _config = { ...DEFAULT_CONFIG };
  }
  return _config;
}

export function getTtsConfig(): VocabTtsConfig {
  return { ...readConfig() };
}

export function saveTtsConfig(updates: Partial<VocabTtsConfig>): VocabTtsConfig {
  const next = { ...readConfig(), ...updates };
  _config = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch { /* 忽略隐私模式写入失败 */ }
  return { ...next };
}

// —— 播放态 ——

/** 播放态：按钮据此显示播放动效，播放期间禁止重复点击 */
const _playback = createSpeechPlayback();
/** 系统 TTS 收尾兜底的清理函数 */
let _sysWatch: (() => void) | null = null;

export function getSpeakPlayback(): SpeechPlayback {
  return _playback.get();
}

export function subscribeSpeakPlayback(listener: (state: SpeechPlayback) => void): () => void {
  return _playback.subscribe(listener);
}

/** 结束一次播放：代次已过期（有更新的播放）时什么都不做 */
function finishSpeak(seq: number): void {
  if (seq !== _playback.seq()) return;
  if (_sysWatch) {
    _sysWatch();
    _sysWatch = null;
  }
  _playback.finish(seq);
}

// —— 系统 TTS ——

export type SpeakAccent = 'uk' | 'us';

const ACCENT_LANG: Record<SpeakAccent, string> = { uk: 'en-GB', us: 'en-US' };

/** 挑一个指定口音的英文语音；没有精确匹配时退回任意英文语音 */
function pickEnglishVoice(lang: string): SpeechSynthesisVoice | undefined {
  if (typeof speechSynthesis === 'undefined') return undefined;
  const voices = speechSynthesis.getVoices();
  const prefix = lang.slice(0, 2);
  return voices.find(v => v.lang.replace('_', '-').toLowerCase().startsWith(lang.toLowerCase()))
    ?? voices.find(v => v.lang.toLowerCase().startsWith(prefix))
    ?? voices.find(v => /^en/i.test(v.lang));
}

function speakSystem(word: string, rate: number, lang: string, seq: number): void {
  if (typeof speechSynthesis === 'undefined') { finishSpeak(seq); return; }
  let started = false;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(word);
    u.lang = lang;
    u.rate = Math.min(1.2, Math.max(0.7, rate));
    const v = pickEnglishVoice(lang);
    if (v) u.voice = v;
    u.onstart = () => { started = true; };
    u.onend = () => finishSpeak(seq);
    u.onerror = () => finishSpeak(seq);
    speechSynthesis.speak(u);
    // onend 不派发的 WebView 由轮询兜底收尾
    if (_sysWatch) _sysWatch();
    _sysWatch = watchSpeechSynthesisEnd(_playback, seq, () => started);
  } catch {
    /* 静默：合成不可用时直接放弃 */
    finishSpeak(seq);
  }
}

// —— 在线发音 ——

let _audio: HTMLAudioElement | null = null;
/** 自建的 blob URL，切换/结束时回收 */
let _audioUrl: string | null = null;
let _audioTimer = 0;

/** 单次在线音频的超时：取不回、或 8 秒没出声就换下一个音源 */
const AUDIO_TIMEOUT_MS = 8000;
/** 低于该字节数按空响应处理（被 Referer 拦时百度回 200 + 0 字节） */
const MIN_AUDIO_BYTES = 1024;
/** 音频字节缓存条数上限：同一句反复播放不必重新下载 */
const BUFFER_CACHE_MAX = 40;
const _bufferCache = new Map<string, { buf: ArrayBuffer; mime: string }>();

function cacheBuffer(url: string, value: { buf: ArrayBuffer; mime: string }): void {
  if (_bufferCache.size >= BUFFER_CACHE_MAX) {
    const oldest = _bufferCache.keys().next().value;
    if (oldest) _bufferCache.delete(oldest);
  }
  _bufferCache.set(url, value);
}

/** 停掉当前在线音频、超时计时器与自建的 blob URL */
function clearAudio(): void {
  if (_audioTimer) { window.clearTimeout(_audioTimer); _audioTimer = 0; }
  if (_audio) {
    try { _audio.pause(); } catch { /* ignore */ }
    _audio = null;
  }
  if (_audioUrl) {
    try { URL.revokeObjectURL(_audioUrl); } catch { /* ignore */ }
    _audioUrl = null;
  }
}

/** 含空白即按整句处理；单词 / 连字符词走词典音源 */
function isSentence(text: string): boolean {
  return /\s/.test(text.trim());
}

/** 单词真人发音（有道词典，type 1=英音 2=美音，可区分英/美） */
function wordAudioUrl(text: string, accent: 1 | 2): string {
  return `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&type=${accent}`;
}

/**
 * 整句朗读（百度翻译 TTS）。
 *
 * 有道 dictvoice 只对其词库里的词条返回音频，任意整句都回 500
 * `returned null audio`，所以例句以前必然回退系统 TTS——表现为「例句读音
 * 不跟随联网读音设置」。百度 gettts 支持任意整句，同样无需密钥。
 * spd 取值 1–5（3≈常速），按设置的语速折算；该音源不区分英/美口音。
 */
function sentenceAudioUrl(text: string, rate: number): string {
  const spd = Math.min(5, Math.max(1, Math.round(rate * 3)));
  return `https://fanyi.baidu.com/gettts?lan=en&text=${encodeURIComponent(text)}&spd=${spd}&source=web`;
}

/**
 * 取音频字节。
 *
 * 必须走 Rust 侧 HTTP（tauri-plugin-http）：WebView 直接 `new Audio(url)` 会给请求
 * 带上 tauri://localhost 的 Referer，百度 gettts 对此返回 200 + 0 字节（听感就是
 * 「在线真人没生效」）。纯浏览器 dev 环境没有 Rust 侧，返回 null 交给 <audio> 直连。
 */
async function fetchAudio(url: string): Promise<{ buf: ArrayBuffer; mime: string } | null> {
  const cached = _bufferCache.get(url);
  if (cached) return cached;
  if (!isTauri()) return null;

  try {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? window.setTimeout(() => ctrl.abort(), AUDIO_TIMEOUT_MS) : 0;
    try {
      const res = await tauriFetch(url, ctrl ? { signal: ctrl.signal } : undefined);
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      if (buf.byteLength < MIN_AUDIO_BYTES) return null;
      const value = { buf, mime: res.headers.get('content-type') ?? 'audio/mpeg' };
      cacheBuffer(url, value);
      return value;
    } finally {
      if (timer) window.clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/**
 * 播放一条音频链接，resolve(true) 表示已经出声。
 * owned 为 true 时 url 是本模块创建的 blob URL，结束时回收。
 */
function playSource(url: string, owned: boolean, seq: number): Promise<boolean> {
  return new Promise((resolve) => {
    let audio: HTMLAudioElement;
    try {
      audio = new Audio(url);
    } catch {
      if (owned) URL.revokeObjectURL(url);
      resolve(false);
      return;
    }

    clearAudio();
    _audio = audio;
    if (owned) _audioUrl = url;

    let settled = false;
    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      if (_audioTimer) { window.clearTimeout(_audioTimer); _audioTimer = 0; }
      if (!ok) clearAudio();
      resolve(ok);
    };

    _audioTimer = window.setTimeout(() => settle(false), AUDIO_TIMEOUT_MS);
    // 一旦开始出声就撤掉超时，避免长句播到一半被下一个源打断
    audio.addEventListener('playing', () => settle(true), { once: true });
    audio.addEventListener('error', () => settle(false), { once: true });
    audio.addEventListener('ended', () => {
      if (_audioTimer) { window.clearTimeout(_audioTimer); _audioTimer = 0; }
      if (_audio === audio) { _audio = null; clearAudio(); }
      finishSpeak(seq);
    }, { once: true });
    void audio.play().catch(() => settle(false));
  });
}

/**
 * 依次尝试多个在线音源：取不到字节 / 播不出来（含超时）就换下一个。
 * 返回 true 表示已出声，或已被更新的播放请求取代（无需再回退系统 TTS）。
 */
async function playAudioChain(urls: string[], seq: number): Promise<boolean> {
  for (const url of urls) {
    const got = await fetchAudio(url);
    if (seq !== _playback.seq()) return true;
    if (!got) {
      // 浏览器 dev（无 Rust 侧）：退回让 <audio> 自己拉
      if (!isTauri() && await playSource(url, false, seq)) return true;
      continue;
    }
    let objectUrl: string;
    try {
      objectUrl = URL.createObjectURL(new Blob([got.buf], { type: got.mime }));
    } catch {
      continue;
    }
    if (await playSource(objectUrl, true, seq)) return true;
    if (seq !== _playback.seq()) return true;
  }
  return false;
}

async function speakOnline(
  text: string,
  accent: 1 | 2,
  rate: number,
  fallbackLang: string,
  seq: number,
): Promise<void> {
  clearAudio();
  // 整句只走百度（有道对整句必失败，多试一次只会拖慢回退）；单词优先有道
  const urls = isSentence(text)
    ? [sentenceAudioUrl(text, rate)]
    : [wordAudioUrl(text, accent), sentenceAudioUrl(text, rate)];
  if (await playAudioChain(urls, seq)) return;
  if (seq !== _playback.seq()) return;
  speakSystem(text, rate, fallbackLang, seq);
}

// —— 对外入口 ——

/** 播放发音（单词与整句通用：单词走词典音源、整句走百度 TTS；在线失败回退系统，关闭源则静默） */
export function speak(word: string): void {
  const cfg = readConfig();
  if (cfg.source === 'off' || !word) return;
  const accent: SpeakAccent = cfg.accent === 1 ? 'uk' : 'us';
  const seq = _playback.begin(word, accent);
  if (cfg.source === 'online') {
    void speakOnline(word, cfg.accent, cfg.rate, ACCENT_LANG[accent], seq);
  } else {
    speakSystem(word, cfg.rate, ACCENT_LANG[accent], seq);
  }
}

/** 指定口音播放（音标旁的「英 / 美」按钮），不受设置里的默认口音影响 */
export function speakAccent(word: string, accent: SpeakAccent): void {
  const cfg = readConfig();
  if (cfg.source === 'off' || !word) return;
  const seq = _playback.begin(word, accent);
  if (cfg.source === 'online') {
    void speakOnline(word, accent === 'uk' ? 1 : 2, cfg.rate, ACCENT_LANG[accent], seq);
  } else {
    speakSystem(word, cfg.rate, ACCENT_LANG[accent], seq);
  }
}

/** 停止当前发音（切卡/卸载时调用） */
export function stopSpeak(): void {
  if (_sysWatch) { _sysWatch(); _sysWatch = null; }
  _playback.reset();
  try {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  } catch { /* ignore */ }
  clearAudio();
}

/** 预热：部分浏览器需触发一次 getVoices 才会异步加载语音列表 */
export function warmupTts(): void {
  try {
    if (typeof speechSynthesis !== 'undefined') void speechSynthesis.getVoices();
  } catch { /* ignore */ }
}
