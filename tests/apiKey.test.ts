import { describe, expect, it } from 'vitest';
import { checkKey, cleanKey, keyHint } from '../server/apiKey';
import { providerImage, type ProviderCall } from '../server/generators/cnProviders';

const K = 'ark-0123456789abcdef0123456789abcdef';

describe('cleanKey', () => {
  it.each([
    [K, K],
    [`  ${K}\n`, K],
    [`\ufeff${K}\u200b`, K],
    [`Bearer ${K}`, K],
    [`Authorization: Bearer ${K}`, K],
    [`ARK_API_KEY=${K}`, K],
    [`export ARK_API_KEY="${K}"`, K],
    [`$env:ARK_API_KEY="${K}"`, K],
    [`“${K}”`, K],
    [`我的key ${K}`, K],
    [`我的key：${K}。`, K],
    [`${K}\t我的 2026-11-06`, K],
    [`key:${K}`, K],
    [`my ark key ${K}`, K],
    ['0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0', '0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0'],
  ])('%j', (raw, want) => expect(cleanKey(raw)).toBe(want));

  it('洗不出来时原样留着，交给 checkKey 报错', () => {
    expect(checkKey('ark', cleanKey('我的key'))).toMatch(/中文/);
  });
});

describe('checkKey', () => {
  it('正常的 Key 通过', () => {
    expect(checkKey('ark', K)).toBeUndefined();
    expect(checkKey('ark', '0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0')).toBeUndefined();
    expect(checkKey('bailian', 'sk-0123456789abcdef0123')).toBeUndefined();
  });
  it('填错平台、填成 Access Key 会提示', () => {
    expect(checkKey('bailian', K)).toMatch(/火山方舟/);
    expect(checkKey('ark', 'sk-0123456789abcdef0123')).toMatch(/百炼/);
    expect(checkKey('ark', 'AKLTabcdef0123456789abcdef')).toMatch(/Access Key/);
  });
  it('keyHint 带前缀', () => {
    expect(keyHint(K)).toBe('ark-…cdef');
    expect(keyHint('0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0')).toBe('…e9f0');
  });
});

it('Key 里有中文时给出能看懂的错误，而不是 ByteString 报错', async () => {
  const call: ProviderCall = {
    provider: 'ark',
    cfg: { imageModel: 'doubao-seedream-5-0-flash-260915', chatModel: '', size: 1536, pricePerImage: 0.2, watermark: false },
    key: `我${K}`,
    fetchImpl: (async () => {
      throw new Error('不该发请求');
    }) as any,
  };
  await expect(providerImage(call, { prompt: 'p', refImages: [], width: 1024, height: 1024 })).rejects.toThrow(/Key 里混进了中文/);
});
