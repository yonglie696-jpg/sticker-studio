import sharp from 'sharp';
import { PROVIDER_INFO } from '../providerInfo';
import type { ProviderId, ProviderSettings } from '../types';

/**
 * 国内模型平台生成源。Key 由用户自己在本机填写，请求从用户电脑直接发给平台，不经过我们的任何服务器。
 * - 阿里云百炼：千问图像 multimodal-generation 同步接口，参考图用 base64 data URI，最多 3 张
 * - 火山方舟：/api/v3/images/generations（Seedream），参考图用 base64 data URI
 * - 自定义：通用兼容格式的 /images/generations，参考图放在 image 字段
 */

export interface ProviderCall {
  provider: ProviderId;
  cfg: ProviderSettings;
  key: string;
  /** 测试时注入 */
  fetchImpl?: typeof fetch;
}

export interface ProviderImageReq {
  prompt: string;
  refImages: Buffer[];
  width: number;
  height: number;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string,
  ) {
    super(message);
  }
  /** 欠费、额度用完、Key 无效：继续排队也只会接着失败，队列应该停下等用户处理 */
  get blocking() {
    return this.status === 401 || this.status === 403 || /Arrearage|Overdue|FreeTierOnly|InvalidApiKey|Authentication|Unauthorized|QuotaExceeded/i.test(this.code ?? '');
  }
}

const TIMEOUT = 240_000;
const NEGATIVE = '文字，字母，数字，水印，logo，网格线，边框，分隔线，真人照片，模糊，畸形';

const BAILIAN_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
const ARK_URL = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';

const HINTS: [RegExp, string][] = [
  [/InvalidApiKey|Authentication|Unauthorized|invalid.*key/i, 'Key 不对或已经失效，请在设置里重新粘贴'],
  [/FreeTierOnly/i, '免费额度用完了（打开了“用完即停”）。要继续用需要在控制台充值，或者关掉“用完即停”'],
  [/Arrearage|Overdue/i, '账户欠费或余额不足，去平台控制台看看'],
  [/ModelNotOpen|NotOpen|InvalidEndpointOrModel|model.*not.*(exist|found)|ModelNotFound/i, '这个模型还没开通，或者模型名填错了（设置里改）'],
  [/DataInspection|Sensitive|RiskControl|ContentFilter/i, '内容被平台的安全审核拦下了，换个说法再试'],
  [/Throttling|RateLimit|TooManyRequests/i, '请求太频繁被限流了，等一会儿再点重试'],
];
function explain(code: string, msg: string) {
  const hint = HINTS.find(([re]) => re.test(`${code} ${msg}`))?.[1];
  return hint ? `${hint}（${code || ''} ${msg}）`.replace('（ ', '（') : msg;
}

/** 请求头。Key 里有中文等字符时 fetch 会报看不懂的 ByteString 错误，这里先拦下来说人话 */
function headers(call: ProviderCall) {
  if (/[^!-~]/.test(call.key)) {
    throw new ProviderError(`${PROVIDER_INFO[call.provider].label}：Key 里混进了中文、空格或其他特殊字符，请在设置里只粘贴 Key 本身`, 401, 'InvalidApiKey');
  }
  return { Authorization: `Bearer ${call.key}`, 'Content-Type': 'application/json' };
}

async function readJson(res: Response, label: string): Promise<any> {
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ProviderError(`${label} 返回了非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`, res.status);
  }
  const failed = !res.ok || json?.error || (json?.code && !json?.output && !json?.data && !json?.choices);
  if (failed) {
    const code = String(json?.error?.code ?? json?.code ?? '');
    const msg = String(json?.error?.message ?? json?.message ?? text.slice(0, 300));
    throw new ProviderError(`${label}：${explain(code, msg)}`, res.status, code);
  }
  return json;
}

/** 透明参考图先铺白底：国内模型大多不认透明通道，透明区域可能被当成黑色 */
export async function toDataUri(buf: Buffer): Promise<string> {
  const png = await sharp(buf).flatten({ background: '#FFFFFF' }).png().toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

async function download(url: string, f: typeof fetch, label: string): Promise<Buffer> {
  const res = await f(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new ProviderError(`${label}：图片下载失败（HTTP ${res.status}）`, res.status);
  return Buffer.from(await res.arrayBuffer());
}

/** 把宽高按比例缩放到总像素区间内，并取 16 的倍数 */
export function fitPixels(w: number, h: number, minPx: number, maxPx: number) {
  const px = w * h;
  const k = px < minPx ? Math.sqrt(minPx / px) : px > maxPx ? Math.sqrt(maxPx / px) : 1;
  const r16 = (v: number, up: boolean) => (up ? Math.ceil(v / 16) : Math.floor(v / 16)) * 16;
  const up = k >= 1;
  return { w: r16(w * k, up), h: r16(h * k, up) };
}

/** 方舟各版本对总像素的要求不同：4.5、5.0 lite 至少约 369 万像素；5.0 pro 超过 261 万像素按高价计费 */
export function arkSize(model: string, w: number, h: number) {
  if (/seedream-(4-5|5-0-lite)/i.test(model)) return fitPixels(w, h, 3_686_400, 4_600_000);
  return fitPixels(w, h, 921_600, 2_600_000);
}

export async function providerImage(call: ProviderCall, req: ProviderImageReq): Promise<{ buf: Buffer }> {
  if (!call.cfg.imageModel) throw new ProviderError(`${PROVIDER_INFO[call.provider].label}：还没有填生图模型名（设置里填）`);
  if (call.provider === 'bailian') return bailianImage(call, req);
  if (call.provider === 'ark') return arkImage(call, req);
  return customImage(call, req);
}

async function bailianImage(call: ProviderCall, req: ProviderImageReq) {
  const f = call.fetchImpl ?? fetch;
  const label = '阿里云百炼';
  const content: any[] = [];
  for (const r of req.refImages.slice(0, 3)) content.push({ image: await toDataUri(r) });
  content.push({ text: req.prompt });
  const { w, h } = fitPixels(req.width, req.height, 512 * 512, 2048 * 2048);
  const res = await f(BAILIAN_URL, {
    method: 'POST',
    headers: headers(call),
    body: JSON.stringify({
      model: call.cfg.imageModel,
      input: { messages: [{ role: 'user', content }] },
      // prompt_extend 关掉：自动改写会破坏“3×3 网格、纯色背景”这类排版要求
      parameters: { n: 1, size: `${w}*${h}`, watermark: call.cfg.watermark, prompt_extend: false, negative_prompt: NEGATIVE },
    }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const json = await readJson(res, label);
  const parts: any[] = json?.output?.choices?.[0]?.message?.content ?? [];
  const url = parts.find((p) => p?.image)?.image;
  if (!url) throw new ProviderError(`${label}：响应里没有图片`);
  return { buf: await download(url, f, label) };
}

/**
 * 组图、流式参数只有 Seedream 4.0、4.5、5.0 lite 认；
 * 5.0 pro / flash 官方写明「暂不支持组图生成、流式输出」，3.0、SeedEdit 也不认，带上会直接报错
 */
export function arkSupportsSequential(model: string) {
  return !/seedream-3|seededit|seedream-5-0-(pro|flash)/i.test(model);
}

/** 这些是可有可无的参数，模型不认时可以去掉重发；model、prompt、image、size 不在其中，去掉会改变出图结果 */
const ARK_OPTIONAL = new Set(['sequential_image_generation', 'stream', 'watermark', 'response_format']);

/** 从“The parameter `xxx` ... is not supported by the current model”里取出参数名 */
export function unsupportedParam(msg: string): string | undefined {
  const m = /parameter `([\w.]+)`[^]*?not (?:supported|valid)/i.exec(msg);
  return m?.[1];
}

async function arkImage(call: ProviderCall, req: ProviderImageReq) {
  const f = call.fetchImpl ?? fetch;
  const label = '火山方舟';
  const refs = await Promise.all(req.refImages.slice(0, 10).map(toDataUri));
  const { w, h } = arkSize(call.cfg.imageModel, req.width, req.height);
  const body: Record<string, unknown> = {
    model: call.cfg.imageModel,
    prompt: req.prompt,
    size: `${w}x${h}`,
    response_format: 'b64_json',
    watermark: call.cfg.watermark,
  };
  if (arkSupportsSequential(call.cfg.imageModel)) Object.assign(body, { sequential_image_generation: 'disabled', stream: false });
  if (refs.length) body.image = refs.length === 1 ? refs[0] : refs;
  let json: any;
  for (;;) {
    const res = await f(ARK_URL, {
      method: 'POST',
      headers: headers(call),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    try {
      json = await readJson(res, label);
      break;
    } catch (e) {
      // 模型名是接入点 ID（ep-xxx）时没法预先判断版本：哪个可选参数不认就去掉它重发一次
      const p = e instanceof ProviderError && res.status === 400 ? unsupportedParam(e.message) : undefined;
      if (!p || !ARK_OPTIONAL.has(p) || !(p in body)) throw e;
      delete body[p];
    }
  }
  const item = json?.data?.[0];
  if (item?.error) throw new ProviderError(`${label}：${explain(String(item.error.code ?? ''), String(item.error.message ?? ''))}`, undefined, item.error.code);
  if (item?.b64_json) return { buf: Buffer.from(item.b64_json, 'base64') };
  if (item?.url) return { buf: await download(item.url, f, label) };
  throw new ProviderError(`${label}：响应里没有图片`);
}

async function customImage(call: ProviderCall, req: ProviderImageReq) {
  const f = call.fetchImpl ?? fetch;
  const label = '自定义接口';
  const base = (call.cfg.baseUrl ?? '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) throw new ProviderError(`${label}：接口地址要以 http:// 或 https:// 开头（设置里填）`);
  const refs = await Promise.all(req.refImages.map(toDataUri));
  const body: Record<string, unknown> = { model: call.cfg.imageModel, prompt: req.prompt, n: 1, size: `${req.width}x${req.height}`, response_format: 'b64_json' };
  if (refs.length) body.image = refs;
  const res = await f(`${base}/images/generations`, {
    method: 'POST',
    headers: headers(call),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const json = await readJson(res, label);
  const item = json?.data?.[0];
  if (item?.b64_json) return { buf: Buffer.from(item.b64_json, 'base64') };
  if (item?.url) return { buf: await download(item.url, f, label) };
  throw new ProviderError(`${label}：响应里没有图片`);
}

// ---------------- 文字模型（通用兼容格式 chat/completions） ----------------

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function providerChat(call: ProviderCall, messages: ChatMessage[], opts: { maxTokens?: number; temperature?: number } = {}): Promise<string> {
  const f = call.fetchImpl ?? fetch;
  const info = PROVIDER_INFO[call.provider];
  const base = (call.provider === 'custom' ? call.cfg.baseUrl : info.chatBase)?.trim().replace(/\/+$/, '');
  if (!base) throw new ProviderError(`${info.label}：还没有填接口地址`);
  if (!call.cfg.chatModel) throw new ProviderError(`${info.label}：还没有填文字模型名（设置里填），所以用不了 AI 帮我想`);
  const body: Record<string, unknown> = {
    model: call.cfg.chatModel,
    messages,
    temperature: opts.temperature ?? 0.8,
    max_tokens: opts.maxTokens ?? 1500,
  };
  // 关掉“深度思考”：这里只需要快速给几个点子，思考模式又慢又贵
  if (call.provider === 'bailian') body.enable_thinking = false;
  if (call.provider === 'ark') body.thinking = { type: 'disabled' };
  const res = await f(`${base}/chat/completions`, {
    method: 'POST',
    headers: headers(call),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const json = await readJson(res, info.label);
  const text = json?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new ProviderError(`${info.label}：文字模型没有返回内容`);
  return text;
}

/** 从模型回复里抠出第一个 JSON 对象或数组（模型常在前后加说明或 ``` 包裹） */
export function extractJson<T = any>(text: string): T {
  const start = text.search(/[[{]/);
  if (start < 0) throw new Error('模型回复里没有 JSON');
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  const end = text.lastIndexOf(close);
  if (end <= start) throw new Error('模型回复里的 JSON 不完整');
  return JSON.parse(text.slice(start, end + 1)) as T;
}

/** 测试连接：有文字模型就发一句最短的对话（几乎不花钱）；没有就只能提示用户用一次真实生成来验证 */
export async function testProvider(call: ProviderCall): Promise<{ ok: boolean; detail: string }> {
  const info = PROVIDER_INFO[call.provider];
  if (!call.key) return { ok: false, detail: '还没有填 Key' };
  if (!call.cfg.chatModel) return { ok: true, detail: `Key 已保存。没填文字模型，没法免费测试；去「角色工坊」出一张概念图就能验证（约 ¥${call.cfg.pricePerImage}）` };
  try {
    const t = await providerChat(call, [{ role: 'user', content: '只回复两个字母：OK' }], { maxTokens: 8, temperature: 0 });
    return { ok: true, detail: `${info.label} 连接成功（文字模型 ${call.cfg.chatModel} 回复：${t.trim().slice(0, 20)}）` };
  } catch (e: any) {
    return { ok: false, detail: e.message };
  }
}
