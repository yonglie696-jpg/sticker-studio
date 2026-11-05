import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { labelImage, labelGif, readAigc } from '../server/pipeline/aigcLabel';
import { decodeAnimation } from '../server/pipeline/frames';
import { gifenc } from '../server/pipeline/encode';
import { processSticker } from '../server/pipeline/process';
import { DEFAULT_PROCESS, DEFAULT_SETTINGS } from '../server/store';
import { checkStickerFile } from '../server/validate/wechatRules';

const { GIFEncoder, quantize, applyPalette } = gifenc;

function tinyGif() {
  const gif = GIFEncoder();
  for (let f = 0; f < 6; f++) {
    const size = 120;
    const rgba = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      const x = i % size;
      const y = Math.floor(i / size);
      const inside = Math.hypot(x - 60, y - 60 - f * 2) < 30;
      rgba.set(inside ? [255, 180, 190, 255] : [255, 255, 255, 255], i * 4);
    }
    const pal = quantize(rgba, 64);
    gif.writeFrame(applyPalette(rgba, pal), size, size, { palette: pal, delay: 100, repeat: 0 });
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}

const info = { producer: '阿里云百炼 qwen-image-2.0', produceId: 'abc123' };

describe('AIGC 隐式标识', () => {
  it('GIF：写入注释块后仍是合规的微信表情，能读回标识', async () => {
    const { gif } = await processSticker(tinyGif(), { ...DEFAULT_PROCESS, caption: '好哒' }, {
      mode: 'gif',
      grid: DEFAULT_SETTINGS.spriteGrid,
      spriteFrameMs: 110,
      targetBytes: DEFAULT_SETTINGS.targetBytes,
    });
    const labeled = labelGif(Buffer.from(gif), info);
    expect(labeled.length).toBeGreaterThan(gif.length);
    expect(readAigc(labeled)).toMatchObject({ Label: '1', ContentProducer: info.producer, ProduceID: 'abc123', ContentPropagator: '表情包工坊' });
    expect(await checkStickerFile(labeled)).toEqual([]);
    const a = await decodeAnimation(labeled);
    const b = await decodeAnimation(Buffer.from(gif));
    expect(a.frames.length).toBe(b.frames.length);
    expect(Buffer.from(a.frames[0]).equals(Buffer.from(b.frames[0]))).toBe(true);
    // 重复写入不会叠加
    expect(labelGif(labeled, info).length).toBe(labeled.length);
  });

  it('PNG：写入 iTXt 后图片不变，能读回标识', async () => {
    const src = await sharp({ create: { width: 50, height: 50, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const labeled = labelImage(src, info);
    expect(readAigc(src)).toBeNull();
    expect(readAigc(labeled)?.Label).toBe('1');
    const m = await sharp(labeled).metadata();
    expect([m.width, m.height, m.hasAlpha]).toEqual([50, 50, true]);
    const raw1 = await sharp(src).raw().toBuffer();
    const raw2 = await sharp(labeled).raw().toBuffer();
    expect(raw1.equals(raw2)).toBe(true);
  });

  it('JPEG：写入 XMP 后还能正常解码', async () => {
    const src = await sharp({ create: { width: 750, height: 400, channels: 3, background: '#FFE3EC' } }).jpeg().toBuffer();
    const labeled = labelImage(src, info);
    expect(readAigc(labeled)?.ProduceID).toBe('abc123');
    const m = await sharp(labeled).metadata();
    expect([m.width, m.height, m.format]).toEqual([750, 400, 'jpeg']);
  });
});
