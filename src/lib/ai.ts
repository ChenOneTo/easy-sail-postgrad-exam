/**
 * 大模型配置与调用（兼容 OpenAI 协议）
 *
 * 支持配置多个模型，配置持久化到 localStorage。
 * 支持任意兼容 OpenAI Chat Completions 协议的服务。
 */

import { isTauri } from './tauri';

const MODELS_KEY = 'easysail-exam-models';
const ACTIVE_KEY = 'easysail-exam-active';
const AI_ENABLED_KEY = 'easysail-exam-enabled';

/** 单个模型配置 */
export interface AiModelConfig {
  /** 唯一标识 */
  id: string;
  /** 用户自定义名称，如"我的 DeepSeek" */
  name: string;
  /** API Key（Bearer Token） */
  apiKey: string;
  /** 服务地址，如 https://api.openai.com/v1 */
  baseUrl: string;
  /** 模型名称，如 gpt-4o-mini */
  model: string;
}

/** 生成唯一 id */
function genId(): string {
  return `model-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 常用服务预设，便于用户一键填充（DeepSeek 优先，OpenAI 置末） */
export interface AiPreset {
  name: string;
  baseUrl: string;
  model: string;
  desc: string;
  /** 是否支持 /models 端点获取模型列表 */
  supportsModels: boolean;
}

export const AI_PRESETS: AiPreset[] = [
  { name: 'DeepSeek',    baseUrl: 'https://api.deepseek.com/v1',       model: 'deepseek-chat',   desc: '深度求索', supportsModels: true },
  { name: '智谱 GLM',    baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash',  desc: '智谱 AI，有免费额度', supportsModels: true },
  { name: 'Moonshot',    baseUrl: 'https://api.moonshot.cn/v1',        model: 'moonshot-v1-8k',  desc: '月之暗面 Kimi', supportsModels: true },
  { name: '阿里通义',    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-turbo', desc: '阿里云百炼', supportsModels: true },
  { name: '小米 MiMo',   baseUrl: 'https://api.xiaomimimo.com/v1',    model: 'mimo-v2-flash',   desc: '小米大模型', supportsModels: true },
  { name: '商汤日日新',  baseUrl: 'https://token.sensenova.cn/v1', model: 'sensenova-6.7-flash-lite', desc: '商汤 SenseNova', supportsModels: false },
  { name: 'Ollama 本地', baseUrl: 'http://localhost:11434/v1',          model: 'qwen2.5:7b',      desc: '本地部署，无需 Key', supportsModels: true },
  { name: 'OpenAI',      baseUrl: 'https://api.openai.com/v1',         model: 'gpt-4o-mini',     desc: '官方服务，需海外网络', supportsModels: true },
  { name: '自定义',       baseUrl: '',                                   model: '',                 desc: '手动填写兼容 OpenAI 协议的接口', supportsModels: true },
];

/**
 * 判断指定 Base URL 是否支持获取模型列表。
 * 匹配预设中 supportsModels 标记；未匹配到预设的地址默认支持（允许尝试）。
 */
export function baseUrlSupportsModels(baseUrl: string): boolean {
  const normalized = baseUrl.replace(/\/+$/, '');
  const preset = AI_PRESETS.find(p => p.baseUrl.replace(/\/+$/, '') === normalized);
  return preset ? preset.supportsModels : true;
}

// ========== 多模型管理 ==========

/** 获取所有已配置的模型列表 */
export function getAiModels(): AiModelConfig[] {
  try {
    const raw = localStorage.getItem(MODELS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* ignore */ }

  // 首次使用：列表为空，由用户手动添加
  localStorage.setItem(MODELS_KEY, JSON.stringify([]));
  return [];
}

/** 获取当前激活的模型 id */
export function getActiveModelId(): string | null {  // 确保有值
  const id = localStorage.getItem(ACTIVE_KEY);
  if (id) return id;
  const models = getAiModels();
  if (models.length > 0) {
    localStorage.setItem(ACTIVE_KEY, models[0].id);
    return models[0].id;
  }
  return null;
}

/** 设置当前激活的模型 */
export function setActiveModelId(id: string): void {  localStorage.setItem(ACTIVE_KEY, id);
}

/** 获取当前激活的模型配置 */
export function getActiveModel(): AiModelConfig | null {
  const models = getAiModels();
  const activeId = getActiveModelId();
  return models.find(m => m.id === activeId) ?? models[0] ?? null;
}

/** 新增模型配置，返回新建的对象 */
export function addAiModel(config?: Partial<AiModelConfig>): AiModelConfig {  const models = getAiModels();
  const newModel: AiModelConfig = {
    id: genId(),
    name: config?.name || `模型 ${models.length + 1}`,
    apiKey: config?.apiKey || '',
    baseUrl: config?.baseUrl || 'https://api.deepseek.com/v1',
    model: config?.model || 'deepseek-chat',
  };
  models.push(newModel);
  localStorage.setItem(MODELS_KEY, JSON.stringify(models));
  return newModel;
}

/** 更新指定模型配置（部分字段），返回更新后的对象 */
export function updateAiModel(id: string, patch: Partial<AiModelConfig>): AiModelConfig | null {  const models = getAiModels();
  const idx = models.findIndex(m => m.id === id);
  if (idx === -1) return null;
  models[idx] = { ...models[idx], ...patch };
  localStorage.setItem(MODELS_KEY, JSON.stringify(models));
  return models[idx];
}

/** 删除指定模型配置 */
export function removeAiModel(id: string): void {  const models = getAiModels().filter(m => m.id !== id);
  localStorage.setItem(MODELS_KEY, JSON.stringify(models));
  // 若删除的是当前激活的，自动切换
  if (getActiveModelId() === id) {
    if (models.length > 0) setActiveModelId(models[0].id);
    else localStorage.removeItem(ACTIVE_KEY);
  }
}

/** 是否已完成最小配置（至少有一个模型配置了 apiKey + baseUrl + model） */
export function isAiConfigured(): boolean {
  const model = getActiveModel();
  if (!model) return false;
  return !!model.baseUrl && !!model.model && (!!model.apiKey || model.baseUrl.includes('localhost') || model.baseUrl.includes('127.0.0.1'));
}

/** 是否允许业务功能调用 AI。模型配置可存在，但业务入口仍受此开关控制。 */
export function isAiEnabled(): boolean {  return localStorage.getItem(AI_ENABLED_KEY) === 'true';
}

/** 设置业务 AI 功能开关。 */
export function setAiEnabled(enabled: boolean): void {  localStorage.setItem(AI_ENABLED_KEY, enabled ? 'true' : 'false');
}

/** 业务 AI 功能是否同时满足开关和模型配置。 */
export function canUseAi(): boolean {
  return isAiEnabled() && isAiConfigured();
}

// ========== API 调用 ==========

/**
 * 解析可用的 fetch 实现。
 *
 * Tauri 桌面环境下走 @tauri-apps/plugin-http 的 fetch —— 请求由 Rust 后端发出，
 * 不受 WebView 同源策略/CORS 限制，可访问不返回 CORS 头的国内大模型接口（如商汤）。
 * 纯浏览器环境（npm run dev）回退到全局 fetch。
 * 导出供其他网络模块复用（图床上传等）。
 */
export async function resolveFetch(): Promise<typeof fetch> {
  if (isTauri()) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return tauriFetch as unknown as typeof fetch;
  }
  return globalThis.fetch.bind(globalThis);
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 拼接完整的 chat/completions 端点 URL */
function buildEndpoint(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  if (base.endsWith('/chat/completions')) return base;
  return `${base}/chat/completions`;
}

/** 拼接 /models 端点 URL */
function buildModelsEndpoint(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  if (base.endsWith('/models')) return base;
  return `${base}/models`;
}

export interface ModelInfo {
  id: string;
  name?: string;
}

/**
 * 获取指定配置下可用模型列表（调用 OpenAI 协议的 /models 接口）
 * @param model 可选，指定使用哪个模型配置；默认使用当前激活的
 */
export async function listModels(model?: AiModelConfig): Promise<ModelInfo[]> {
  const config = model ?? getActiveModel();
  if (!config) throw new Error('未配置模型');
  if (!config.baseUrl) throw new Error('未配置 Base URL');

  const url = buildModelsEndpoint(config.baseUrl);
  const doFetch = await resolveFetch();
  const res = await doFetch(url, {
    method: 'GET',
    headers: {
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
  });

  if (!res.ok) {
    let errMsg = `获取模型列表失败（HTTP ${res.status}）`;
    try {
      const errBody = await res.json();
      if (errBody?.error?.message) errMsg = errBody.error.message;
    } catch { /* 响应非 JSON */ }
    throw new Error(friendlyAiError(errMsg));
  }

  const data = await res.json();
  const list: unknown = data?.data ?? data?.models ?? [];
  if (!Array.isArray(list)) throw new Error('模型列表格式异常');

  const models: ModelInfo[] = list
    .map((m: Record<string, unknown>) => ({
      id: String(m?.id ?? m?.name ?? ''),
      name: m?.name ? String(m.name) : undefined,
    }))
    .filter(m => m.id);

  models.sort((a, b) => a.id.localeCompare(b.id));
  return models;
}

/**
 * 调用 OpenAI 协议的 /chat/completions 接口
 * @param model 可选，指定使用哪个模型配置；默认使用当前激活的
 * @returns 模型回复的文本内容
 */
export async function chatCompletion(
  messages: ChatMessage[],
  options?: { model?: AiModelConfig; signal?: AbortSignal; temperature?: number }
): Promise<string> {
  const config = options?.model ?? getActiveModel();
  if (!config) throw new Error('未配置模型');
  if (!config.baseUrl) throw new Error('未配置 Base URL');
  if (!config.model) throw new Error('未配置模型名称');

  const url = buildEndpoint(config.baseUrl);
  const doFetch = await resolveFetch();
  let res: Response;
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: options?.temperature ?? 0.7,
      }),
      signal: options?.signal,
    });
  } catch (err) {
    // 用户主动取消时原样抛出，由上层静默处理
    if (options?.signal?.aborted) throw err;
    console.warn('[AI] 网络请求失败:', err);
    throw new Error('网络连接失败：请检查网络，或确认 Base URL 地址是否正确', { cause: err });
  }

  if (!res.ok) {
    let errMsg = `请求失败（HTTP ${res.status}）`;
    try {
      const errBody = await res.json();
      if (errBody?.error?.message) errMsg = errBody.error.message;
    } catch { /* 响应非 JSON */ }
    throw new Error(friendlyAiError(errMsg));
  }

  const data = await res.json();
  const content: unknown = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content) {
    throw new Error('模型未返回有效内容');
  }
  return content;
}

/** 将服务商原始报错翻译为可操作的中文提示（无法识别时原样返回） */
function friendlyAiError(raw: string): string {
  const msg = raw.toLowerCase();
  if (
    msg.includes('free quota exhausted') ||
    msg.includes('quota exceeded') ||
    msg.includes('insufficient_quota') ||
    msg.includes('exceeded your current quota') ||
    msg.includes('billing')
  ) {
    return 'AI 额度已用尽：请到服务商控制台充值，或关闭「仅使用免费额度」模式，也可在设置中切换其他模型服务';
  }
  if (
    msg.includes('invalid api key') ||
    msg.includes('invalid_api_key') ||
    msg.includes('unauthorized') ||
    msg.includes('authentication') ||
    msg.includes('401')
  ) {
    return 'API Key 无效或未授权：请检查设置中的 API Key 是否正确';
  }
  if (msg.includes('rate limit') || msg.includes('too many requests')) {
    return '请求过于频繁：请稍等几秒后重试';
  }
  if (msg.includes('model_not_found') || msg.includes('does not exist')) {
    return '模型名称不存在：请检查设置中的模型名称拼写';
  }
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return '请求超时：请检查网络后重试';
  }
  return raw;
}

/** 测试连接：发送一条简单消息验证配置是否可用 */
export async function testAiConnection(model?: AiModelConfig): Promise<string> {
  return chatCompletion(
    [{ role: 'user', content: '请只回复"连接成功"四个字，不要包含任何其他内容。' }],
    { model }
  );
}
