/**
 * 打字键盘音效（Web Audio 实时合成，不引入音频资源）。
 *
 * 项目原先没有任何音频素材，这里用噪声 + 滤波合成机械键盘的「咔哒」与
 * 低沉的「咚」，避免增加资源体积；音效开关与音量由本模块自己的设置驱动。
 * AudioContext 必须由用户手势创建，因此第一次按键时才初始化。
 */

export type TypingSoundKind = 'key' | 'space' | 'error' | 'success' | 'finish';

interface SoundConfig {
  enabled: boolean;
  volume: number;
}

let _ctx: AudioContext | null = null;
let _noise: AudioBuffer | null = null;
let _config: SoundConfig = { enabled: true, volume: 0.5 };

function audioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (typeof window.AudioContext !== 'undefined') return window.AudioContext;
  const legacy = (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return legacy ?? null;
}

/** 更新音效配置（由 store 在加载设置/修改设置后调用） */
export function configureTypingSound(next: Partial<SoundConfig>): void {
  _config = { ..._config, ...next };
}

function ensureContext(): AudioContext | null {
  if (!_config.enabled || _config.volume <= 0) return null;
  if (_ctx) {
    if (_ctx.state === 'suspended') void _ctx.resume();
    return _ctx;
  }
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  try {
    _ctx = new Ctor();
  } catch {
    return null;
  }
  const length = Math.floor(_ctx.sampleRate * 0.06);
  _noise = _ctx.createBuffer(1, length, _ctx.sampleRate);
  const data = _noise.getChannelData(0);
  for (let i = 0; i < length; i++) {
    // 指数衰减的白噪声，听感接近键帽触底
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.4);
  }
  return _ctx;
}

function playNoise(ctx: AudioContext, opts: { freq: number; q: number; gain: number; duration: number; type: BiquadFilterType }): void {
  if (!_noise) return;
  const src = ctx.createBufferSource();
  src.buffer = _noise;
  const filter = ctx.createBiquadFilter();
  filter.type = opts.type;
  filter.frequency.value = opts.freq;
  filter.Q.value = opts.q;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(opts.gain, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + opts.duration);
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start(ctx.currentTime);
  src.stop(ctx.currentTime + opts.duration);
}

function playTone(ctx: AudioContext, freq: number, duration: number, gainValue: number, type: OscillatorType, delay = 0): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const start = ctx.currentTime + delay;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

/** 播放一次音效。未启用或浏览器不支持时静默返回。 */
export function playTypingSound(kind: TypingSoundKind): void {
  const ctx = ensureContext();
  if (!ctx) return;
  const v = Math.min(1, Math.max(0, _config.volume));

  switch (kind) {
    case 'key':
      playNoise(ctx, { freq: 2400, q: 1.1, gain: 0.11 * v, duration: 0.035, type: 'bandpass' });
      playTone(ctx, 190, 0.03, 0.035 * v, 'triangle');
      break;
    case 'space':
      playNoise(ctx, { freq: 900, q: 0.7, gain: 0.13 * v, duration: 0.06, type: 'lowpass' });
      playTone(ctx, 110, 0.07, 0.06 * v, 'sine');
      break;
    case 'error':
      playTone(ctx, 196, 0.09, 0.09 * v, 'square');
      playTone(ctx, 147, 0.12, 0.07 * v, 'square', 0.07);
      break;
    case 'success':
      playTone(ctx, 880, 0.08, 0.06 * v, 'sine');
      playTone(ctx, 1318, 0.12, 0.05 * v, 'sine', 0.07);
      break;
    case 'finish':
      playTone(ctx, 523, 0.12, 0.06 * v, 'sine');
      playTone(ctx, 659, 0.12, 0.06 * v, 'sine', 0.1);
      playTone(ctx, 784, 0.18, 0.07 * v, 'sine', 0.2);
      break;
  }
}

/** 卸载时释放 AudioContext */
export function disposeTypingSound(): void {
  try {
    void _ctx?.close();
  } catch {
    /* ignore */
  }
  _ctx = null;
  _noise = null;
}
