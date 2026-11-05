import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { processSticker } from '../server/pipeline/process';
import { DEFAULT_PROCESS, DEFAULT_SETTINGS } from '../server/store';

/** 3×3 精灵图：每格一个圆，位置各不相同（保证 9 帧互不重复） */
async function sprite() {
  const S = 600;
  const c = S / 3;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}"><rect width="100%" height="100%" fill="#FFFFFF"/>`;
  for (let i = 0; i < 9; i++) {
    const cx = (i % 3) * c + c / 2 + (i - 4) * 4;
    const cy = Math.floor(i / 3) * c + c / 2 - 20 + i * 3;
    svg += `<circle cx="${cx}" cy="${cy}" r="${50 + i}" fill="#F8C8D8" stroke="#5A3A2E" stroke-width="6"/>`;
  }
  return sharp(Buffer.from(`${svg}</svg>`)).png().toBuffer();
}

const opts = { mode: 'sprite' as const, grid: DEFAULT_SETTINGS.spriteGrid, spriteFrameMs: 110, targetBytes: DEFAULT_SETTINGS.targetBytes };

describe('选帧', () => {
  it('不选时用全部 9 帧；选了就只用选中的几帧', async () => {
    const raw = await sprite();
    const all = await processSticker(raw, { ...DEFAULT_PROCESS, caption: '' }, opts);
    expect(all.report.frames).toBe(9);
    const some = await processSticker(raw, { ...DEFAULT_PROCESS, caption: '', frameSel: [5, 6, 7, 8, 9] }, opts);
    expect(some.report.frames).toBe(5);
    expect(some.report.steps.join(' ')).toContain('只用第 5、6、7、8、9 帧');
  });

  it('选帧可以和正放+倒放一起用（5 帧 → 8 帧）', async () => {
    const { report } = await processSticker(await sprite(), { ...DEFAULT_PROCESS, caption: '', frameSel: [5, 6, 7, 8, 9], pingpong: true }, opts);
    expect(report.frames).toBe(8);
  });

  it('格子画歪了（上排的脚、下排的头越过三等分线）也不会串格；空格子自动跳过', async () => {
    // 600×600，名义格子 200。左右两列：上排圆盖到 y≈212，下排圆从 y≈345 开始；中间一排左右两格是空的
    const S = 600;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}"><rect width="100%" height="100%" fill="#FFFFFF"/>`;
    const blob = (cx: number, cy: number, r: number) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#F8C8D8" stroke="#5A3A2E" stroke-width="6"/>`;
    // 每个圆大小不同，免得相同帧被合并
    [100, 300, 500].forEach((cx, i) => (svg += blob(cx, 115, 95 - i * 2))); // 上排：底边越过 y=200
    svg += blob(300, 300, 55); // 中排只有中间一个
    [100, 300, 500].forEach((cx, i) => (svg += blob(cx, 430, 85 - i * 2))); // 下排：顶边越过 y=400
    const raw = await sharp(Buffer.from(`${svg}</svg>`)).png().toBuffer();
    const { report } = await processSticker(raw, { ...DEFAULT_PROCESS, caption: '' }, opts);
    expect(report.steps.join(' ')).toContain('第 4、6 格是空的，已跳过');
    expect(report.frames).toBe(7);
  });

  it('超出格子数的编号会被忽略', async () => {
    const { report } = await processSticker(await sprite(), { ...DEFAULT_PROCESS, caption: '', frameSel: [1, 2, 3, 42] }, opts);
    expect(report.frames).toBe(3);
  });
});
