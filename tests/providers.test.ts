import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ProviderError, arkSize, extractJson, fitPixels, providerChat, providerImage, testProvider, type ProviderCall } from '../server/generators/cnProviders';
import { DEFAULT_SETTINGS } from '../server/store';

const png = () => sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer();

/** 记录请求、按顺序返回预设响应的假 fetch */
function fakeFetch(responses: (() => Response | Promise<Response>)[]) {
  const calls: { url: string; init?: RequestInit; body?: any }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    const next = responses.shift();
    if (!next) throw new Error('没有更多预设响应');
    return next();
  }) as unknown as typeof fetch;
  return { f, calls };
}
const json = (obj: unknown, status = 200) => () => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

const call = (provider: ProviderCall['provider'], f: typeof fetch, patch = {}): ProviderCall => ({
  provider,
  cfg: { ...DEFAULT_SETTINGS.providers[provider], ...patch },
  key: 'sk-test',
  fetchImpl: f,
});

describe('阿里云百炼', () => {
  it('参考图以 data URI 放在文字前面，关掉提示词改写，下载返回的图片', async () => {
    const img = await png();
    const { f, calls } = fakeFetch([
      json({ output: { choices: [{ message: { content: [{ image: 'https://oss.example/a.png' }] } }] }, usage: { image_count: 1 } }),
      () => new Response(new Uint8Array(img)),
    ]);
    const r = await providerImage(call('bailian', f), { prompt: '画一只小兔', refImages: [img], width: 1536, height: 1536 });
    expect(r.buf.equals(img)).toBe(true);
    const req = calls[0];
    expect(req.url).toContain('/multimodal-generation/generation');
    expect((req.init?.headers as any).Authorization).toBe('Bearer sk-test');
    expect(req.body.model).toBe(DEFAULT_SETTINGS.providers.bailian.imageModel);
    const content = req.body.input.messages[0].content;
    expect(content[0].image).toMatch(/^data:image\/png;base64,/);
    expect(content.at(-1).text).toBe('画一只小兔');
    expect(req.body.parameters).toMatchObject({ n: 1, size: '1536*1536', prompt_extend: false, watermark: false });
    expect(calls[1].url).toBe('https://oss.example/a.png');
  });

  it('Key 错误：给出中文提示，并标记为需要暂停队列', async () => {
    const { f } = fakeFetch([json({ request_id: 'x', code: 'InvalidApiKey', message: 'Invalid API-key provided.' }, 401)]);
    const err = await providerImage(call('bailian', f), { prompt: 'x', refImages: [], width: 1024, height: 1024 }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toContain('Key 不对');
    expect(err.blocking).toBe(true);
  });

  it('内容审核拦截不会暂停整个队列', async () => {
    const { f } = fakeFetch([json({ code: 'DataInspectionFailed', message: 'Output data may contain inappropriate content.' }, 400)]);
    const err = await providerImage(call('bailian', f), { prompt: 'x', refImages: [], width: 1024, height: 1024 }).catch((e) => e);
    expect(err.message).toContain('安全审核');
    expect(err.blocking).toBe(false);
  });
});

describe('火山方舟', () => {
  it('请求 b64_json、单图模式；参考图只有一张时传字符串；水印跟着设置走', async () => {
    const img = await png();
    const { f, calls } = fakeFetch([json({ data: [{ b64_json: img.toString('base64'), size: '1536x1536' }], usage: { generated_images: 1 } })]);
    const r = await providerImage(call('ark', f, { watermark: true }), { prompt: 'p', refImages: [img], width: 1536, height: 1536 });
    expect(r.buf.equals(img)).toBe(true);
    const b = calls[0].body;
    expect(calls[0].url).toBe('https://ark.cn-beijing.volces.com/api/v3/images/generations');
    expect(b).toMatchObject({ model: 'doubao-seedream-4-0-250828', size: '1536x1536', response_format: 'b64_json', sequential_image_generation: 'disabled', watermark: true });
    expect(typeof b.image).toBe('string');
  });

  it.each(['doubao-seededit-3-0-i2i-250628', 'doubao-seedream-5-0-flash-260928', 'doubao-seedream-5-0-pro-260628'])('%s 不带组图、流式参数', async (model) => {
    const img = await png();
    const { f, calls } = fakeFetch([json({ data: [{ b64_json: img.toString('base64') }] })]);
    await providerImage(call('ark', f, { imageModel: model }), { prompt: 'p', refImages: [img], width: 1536, height: 1536 });
    expect(calls[0].body).not.toHaveProperty('sequential_image_generation');
    expect(calls[0].body).not.toHaveProperty('stream');
    expect(calls[0].body.size).toBe('1536x1536');
  });

  it('接入点 ID 不认某个可选参数时，去掉它重发一次', async () => {
    const img = await png();
    const msg = 'The parameter `sequential_image_generation` specified in the request are not valid: the parameter `sequential_image_generation` is not supported by the current model.';
    const { f, calls } = fakeFetch([
      json({ error: { code: 'InvalidParameter', message: msg } }, 400),
      json({ data: [{ b64_json: img.toString('base64') }] }),
    ]);
    const r = await providerImage(call('ark', f, { imageModel: 'ep-20261105-abc' }), { prompt: 'p', refImages: [], width: 1024, height: 1024 });
    expect(r.buf.equals(img)).toBe(true);
    expect(calls[0].body.sequential_image_generation).toBe('disabled');
    expect(calls[1].body).not.toHaveProperty('sequential_image_generation');
  });

  it('不认参考图时不偷偷去掉，直接报错', async () => {
    const img = await png();
    const msg = 'The parameter `image` specified in the request are not valid: the parameter `image` is not supported by the current model.';
    const { f, calls } = fakeFetch([json({ error: { code: 'InvalidParameter', message: msg } }, 400)]);
    await expect(providerImage(call('ark', f), { prompt: 'p', refImages: [img], width: 1024, height: 1024 })).rejects.toThrow(/image/);
    expect(calls.length).toBe(1);
  });

  it('组图里单张失败时报出那张的错误', async () => {
    const { f } = fakeFetch([json({ data: [{ error: { code: 'OutputImageSensitiveContentDetected', message: 'blocked' } }] })]);
    await expect(providerImage(call('ark', f), { prompt: 'p', refImages: [], width: 1024, height: 1024 })).rejects.toThrow(/安全审核/);
  });

  it('按版本调整尺寸：4.5 至少约 369 万像素，4.0 保持原样', () => {
    const big = arkSize('doubao-seedream-4-5-251128', 1536, 1536);
    expect(big.w * big.h).toBeGreaterThanOrEqual(3_686_400);
    expect(big.w % 16).toBe(0);
    expect(arkSize('doubao-seedream-4-0-250828', 1536, 1536)).toEqual({ w: 1536, h: 1536 });
    const wide = arkSize('doubao-seedream-4-0-250828', 1536, 1024);
    expect(wide.w / wide.h).toBeCloseTo(1.5, 1);
  });
});

describe('自定义兼容接口', () => {
  it('地址不对时直接报错，不发请求', async () => {
    const { f, calls } = fakeFetch([]);
    await expect(providerImage(call('custom', f, { baseUrl: 'example.com', imageModel: 'm' }), { prompt: 'p', refImages: [], width: 1024, height: 1024 })).rejects.toThrow(/http/);
    expect(calls.length).toBe(0);
  });
  it('拼出 /images/generations，支持返回 url', async () => {
    const img = await png();
    const { f, calls } = fakeFetch([json({ data: [{ url: 'https://cdn.example/x.png' }] }), () => new Response(new Uint8Array(img))]);
    await providerImage(call('custom', f, { baseUrl: 'https://api.example.com/v1/', imageModel: 'm' }), { prompt: 'p', refImages: [], width: 1024, height: 1024 });
    expect(calls[0].url).toBe('https://api.example.com/v1/images/generations');
  });
});

describe('文字模型', () => {
  it('百炼走兼容接口并关掉深度思考；没填文字模型时测试连接不花钱', async () => {
    const { f, calls } = fakeFetch([json({ choices: [{ message: { content: 'OK' } }] })]);
    expect(await providerChat(call('bailian', f), [{ role: 'user', content: 'hi' }])).toBe('OK');
    expect(calls[0].url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
    expect(calls[0].body.enable_thinking).toBe(false);

    const empty = fakeFetch([]);
    const t = await testProvider(call('ark', empty.f, { chatModel: '' }));
    expect(t.ok).toBe(true);
    expect(empty.calls.length).toBe(0);
  });

  it('从带说明和代码块的回复里抠出 JSON', () => {
    expect(extractJson('好的，设定如下：\n```json\n{"name":"团团","species":"小熊"}\n```')).toEqual({ name: '团团', species: '小熊' });
    expect(extractJson('[{"meaning":"收到"}] 以上')).toEqual([{ meaning: '收到' }]);
  });

  it('像素范围换算', () => {
    expect(fitPixels(256, 256, 512 * 512, 2048 * 2048)).toEqual({ w: 512, h: 512 });
    expect(fitPixels(4096, 4096, 512 * 512, 2048 * 2048)).toEqual({ w: 2048, h: 2048 });
  });
});
