/**
 * 单词 AI 助记生成（非 Hook 版）。
 *
 * 与 VocabMnemonicSheet 复用同一套提示词/校验，但可在 store 的后台预生成里直接调用。
 * 已生成的助记由调用方写入 exam_vocab_mnemonics，后续按 word_id 直接读库。
 */
import { AiRequestError, canUseAi, chatCompletion } from './ai';
import { buildVocabMnemonicPrompt } from './prompts';
import { normalizeMnemonicDraft, parseAiJson, type AiMnemonicDraft } from './ai-json';

/** 单次生成最多尝试几次（含首次）：限流/网络抖动/JSON 不合规都能靠再要一次救回来 */
const MAX_ATTEMPTS = 3;
/**
 * 单次请求超时：超过就按可重试错误处理，避免卡片一直停在「生成中」。
 * 关闭思考后实测 5~10 秒返回；若服务商忽略该参数仍会推理（LongCat 单套约 43 秒），
 * 因此留足 90 秒，不能按「关掉思考」的耗时来卡。
 */
const REQUEST_TIMEOUT_MS = 90_000;

/** 当前环境是否允许调用 AI（开关 + 模型配置） */
export function canGenerateMnemonic(): boolean {
  return canUseAi();
}

/**
 * 哪些失败值得再要一次：
 * - 网络失败 / 超时 / 5xx / 429：默认重试；
 * - 401、额度耗尽、模型名错误等确定性失败不重试，省额度也省等待；
 * - JSON 解析失败、字段缺失（普通 Error）：模型这次没按 schema 输出，换一次通常就好。
 */
function isRetryable(err: unknown): boolean {
  return err instanceof AiRequestError ? err.retryable : true;
}

/** 可被外部取消的等待，用于重试退避 */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('已取消', 'AbortError'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('已取消', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * 生成一条 AI 助记；未开启 AI 时返回 null。
 *
 * 单次失败会按 0.7s / 1.4s 左右退避重试，全部失败才抛出，
 * 由调用方降级为「重试」按钮。外部取消（切关/退出）立即结束，不重试。
 */
export async function generateVocabMnemonic(
  word: string,
  meaning: string,
  signal?: AbortSignal,
): Promise<AiMnemonicDraft | null> {
  if (!canUseAi()) return null;

  let lastError: unknown = null;
  /**
   * 思考型模型（LongCat-2.5 / Qwen3 等）默认先输出几千 token 推理，
   * 两套助记会拖到 60 秒以上；助记不需要推理，默认请求就关掉。
   * 个别服务商不认 `thinking` 参数会返回 400，这时降级为默认模式再试。
   */
  let thinkingUnsupported = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const content = await chatCompletion([
        { role: 'system', content: '你只输出可解析 JSON。' },
        { role: 'user', content: buildVocabMnemonicPrompt(word, meaning) },
      ], {
        signal,
        temperature: 0.6,
        timeoutMs: REQUEST_TIMEOUT_MS,
        disableThinking: !thinkingUnsupported,
      });

      const draft = normalizeMnemonicDraft(parseAiJson(content));
      if (draft) return draft;
      // JSON 能解析但缺少口诀：换一次生成
      lastError = new Error('AI 未返回可用的助记内容');
    } catch (err) {
      if (signal?.aborted) throw err;
      // 400/422 大概率是服务端不认识 thinking 参数：不当作重试失败，改为默认模式重来
      if (
        !thinkingUnsupported
        && err instanceof AiRequestError
        && (err.status === 400 || err.status === 422)
      ) {
        console.warn('[AI 助记] 服务端不接受关闭思考，改用默认模式:', err.message);
        thinkingUnsupported = true;
        continue;
      }
      if (!isRetryable(err)) throw err;
      lastError = err;
    }

    if (attempt === MAX_ATTEMPTS) break;
    console.warn(`[AI 助记] ${word} 第 ${attempt} 次生成失败，重试中:`, lastError);
    await delay(700 * attempt + Math.random() * 300, signal);
  }

  throw lastError instanceof Error ? lastError : new Error('AI 助记生成失败');
}
