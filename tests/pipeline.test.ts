import { describe, expect, it } from 'vitest';
import { gifenc } from '../server/pipeline/encode';
import { processSticker } from '../server/pipeline/process';
import { decodeAnimation } from '../server/pipeline/frames';
import { DEFAULT_PROCESS, DEFAULT_SETTINGS } from '../server/store';
import { animHash, hashDistance, SIMILAR_THRESHOLD } from '../server/validate/similarity';
import {
  checkAlbumName,
  checkMeaning,
  checkRewardText,
  checkStickerFile,
  inspectGif,
  scanText,
} from '../server/validate/wechatRules';

const { GIFEncoder, quantize, applyPalette } = gifenc;

/** 合成测试 GIF：白底上一个带深色描边的形状在上下弹跳 */
function synthGif(opts: { size?: number; frames?: number; shape?: 'circle' | 'square'; noise?: boolean; loop?: boolean } = {}) {
  const { size = 480, frames = 12, shape = 'circle', noise = false, loop = true } = opts;
  const gif = GIFEncoder();
  for (let f = 0; f < frames; f++) {
    const rgba = new Uint8Array(size * size * 4);
    const cy = size / 2 + Math.round(Math.sin((f / frames) * Math.PI * 2) * size * 0.08);
    const cx = size / 2;
    const r = size * 0.22;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const d = shape === 'circle' ? Math.hypot(x - cx, y - cy) : Math.max(Math.abs(x - cx), Math.abs(y - cy));
        let c = [255, 255, 255];
        // noise=true 用多色渐变（模拟 AI 画面的丰富颜色），让无损编码超出小目标
        if (d < r) c = noise ? [(x + f * 9) % 256, (y * 2 + x) % 256, (x * y + f * 40) % 256] : [255, 200, 210];
        if (d >= r && d < r + 6) c = [90, 58, 46];
        rgba.set([c[0], c[1], c[2], 255], i);
      }
    const pal = quantize(rgba, 256, { format: 'rgb444' });
    gif.writeFrame(applyPalette(rgba, pal), size, size, { palette: pal, delay: 100, repeat: loop ? 0 : -1 });
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}

const opts = { mode: 'gif' as const, grid: DEFAULT_SETTINGS.spriteGrid, spriteFrameMs: 110, targetBytes: DEFAULT_SETTINGS.targetBytes };

describe('后期流水线', () => {
  it('输出符合微信规范：240×240、≤500KB、无限循环、多帧，背景被抠成透明', async () => {
    const { gif, report } = await processSticker(synthGif(), { ...DEFAULT_PROCESS, caption: '好哒' }, opts);
    expect(report.width).toBe(240);
    expect(report.height).toBe(240);
    expect(report.bytes).toBeLessThanOrEqual(500 * 1024);
    expect(report.loop).toBe(true);
    expect(report.frames).toBeGreaterThan(1);
    expect(await checkStickerFile(Buffer.from(gif))).toEqual([]);
    const a = await decodeAnimation(Buffer.from(gif));
    expect(a.frames[0][3]).toBe(0); // 左上角透明
  });

  it('不循环的输入也会被修成无限循环', async () => {
    const raw = synthGif({ loop: false });
    expect((await inspectGif(raw)).loop).toBe(false);
    const { report } = await processSticker(raw, { ...DEFAULT_PROCESS }, opts);
    expect(report.loop).toBe(true);
  });

  it('颜色复杂、超出目标大小的动图会被逐级压缩到目标以内', async () => {
    const raw = synthGif({ noise: true, frames: 12 });
    const loose = await processSticker(raw, { ...DEFAULT_PROCESS, keyMode: 'none', padding: 0 }, opts);
    const target = Math.floor(loose.report.bytes * 0.6);
    const { report } = await processSticker(raw, { ...DEFAULT_PROCESS, keyMode: 'none', padding: 0 }, { ...opts, targetBytes: target });
    expect(report.bytes).toBeLessThanOrEqual(target);
    expect(report.steps.length).toBeGreaterThan(loose.report.steps.length);
  });

  it('主体贴边、非正方形的图也能正确裁切（不会错位）', async () => {
    // 1230×1278、主体几乎铺满：四周留白会超出原图，需要先补边再缩放
    const w = 123;
    const h = 128;
    const px = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const edge = x < 3 || y < 3 || x >= w - 3 || y >= h - 3;
        px.set(edge ? [255, 255, 255, 255] : x < w / 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * w + x) * 4);
      }
    const sharp = (await import('sharp')).default;
    const png = await sharp(Buffer.from(px), { raw: { width: w, height: h, channels: 4 } }).resize(1230, 1278, { kernel: 'nearest' }).png().toBuffer();
    const { gif } = await processSticker(png, { ...DEFAULT_PROCESS, padding: 6, keyMode: 'none' }, opts);
    const a = await decodeAnimation(Buffer.from(gif));
    const at = (x: number, y: number) => Array.from(a.frames[0].subarray((y * 240 + x) * 4, (y * 240 + x) * 4 + 3));
    // 左半边红、右半边蓝，上下同一列颜色一致（错位时会变成斜条纹）
    expect(at(80, 40)[0]).toBeGreaterThan(200);
    expect(at(80, 200)[0]).toBeGreaterThan(200);
    expect(at(160, 40)[2]).toBeGreaterThan(200);
    expect(at(160, 200)[2]).toBeGreaterThan(200);
  });

  it('正放+倒放会增加帧数（5 帧 → 8 帧）', async () => {
    const { report } = await processSticker(synthGif({ frames: 5 }), { ...DEFAULT_PROCESS, pingpong: true }, opts);
    expect(report.frames).toBe(8);
  });
});

describe('差异度检测', () => {
  it('只改了字幕的两张被判为太像，不同动作的两张不会', async () => {
    const base = synthGif();
    const a = await processSticker(base, { ...DEFAULT_PROCESS, caption: '好哒' }, opts);
    const b = await processSticker(base, { ...DEFAULT_PROCESS, caption: '嗯嗯' }, opts);
    const c = await processSticker(synthGif({ shape: 'square' }), { ...DEFAULT_PROCESS, caption: '好哒', textMode: 'none' }, opts);
    const [ha, hb, hc] = await Promise.all([a, b, c].map((x) => animHash(Buffer.from(x.gif))));
    expect(hashDistance(ha, hb)).toBeLessThan(SIMILAR_THRESHOLD);
    expect(hashDistance(ha, hc)).toBeGreaterThanOrEqual(SIMILAR_THRESHOLD);
  });
});

describe('微信文案规则', () => {
  it('含义词：≤4 字、不重复', () => {
    expect(checkMeaning('收到', [])).toEqual([]);
    expect(checkMeaning('有点火大了', []).some((i) => i.level === 'error')).toBe(true);
    expect(checkMeaning('收到', ['收到']).some((i) => i.msg.includes('重复'))).toBe(true);
  });
  it('表情名称：≤8 字、无标点空格', () => {
    expect(checkAlbumName('团团').filter((i) => i.level === 'error')).toEqual([]);
    expect(checkAlbumName('团团！').some((i) => i.level === 'error')).toBe(true);
    expect(checkAlbumName('团团 小脾气').some((i) => i.level === 'error')).toBe(true);
    expect(checkAlbumName('团团的超级无敌小脾气').some((i) => i.level === 'error')).toBe(true);
  });
  it('赞赏引导语：5–15 字', () => {
    expect(checkRewardText('给团团买块小蛋糕嘛')).toEqual([]);
    expect(checkRewardText('谢谢').some((i) => i.level === 'error')).toBe(true);
  });
  it('拦截已有 IP、联系方式和禁用内容，但不误伤“烟花”这类词', () => {
    expect(scanText('像星黛露一样的兔子', 'x').some((i) => i.level === 'error')).toBe(true);
    expect(scanText('加我13812345678', 'x').some((i) => i.level === 'error')).toBe(true);
    expect(scanText('人民币', 'x').some((i) => i.level === 'error')).toBe(true);
    expect(scanText('新年放烟花', 'x').filter((i) => i.level === 'error')).toEqual([]);
  });
});
