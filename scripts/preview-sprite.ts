// 调试工具：把一张精灵图走一遍后期流水线，输出逐帧对比图（上排浅色背景、下排深色背景），并打印处理记录。不花钱。
// 用法：npx tsx scripts/preview-sprite.ts <精灵图.png> <输出.png> [--sel 5,6,7]
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { decodeAnimation } from '../server/pipeline/frames';
import { processSticker } from '../server/pipeline/process';
import { DEFAULT_PROCESS, DEFAULT_SETTINGS } from '../server/store';

const { positionals, values } = parseArgs({ allowPositionals: true, options: { sel: { type: 'string' }, caption: { type: 'string', default: '测试' } } });
const [input, output] = positionals;
if (!input || !output) throw new Error('用法：npx tsx scripts/preview-sprite.ts <精灵图.png> <输出.png> [--sel 5,6,7]');
const grid = DEFAULT_SETTINGS.spriteGrid;
const { gif, report } = await processSticker(
  fs.readFileSync(input),
  { ...DEFAULT_PROCESS, caption: values.caption!, spriteGrid: grid, frameSel: values.sel?.split(',').map(Number) },
  { mode: 'sprite', grid, spriteFrameMs: DEFAULT_SETTINGS.spriteFrameMs, targetBytes: DEFAULT_SETTINGS.targetBytes },
);
const a = await decodeAnimation(Buffer.from(gif));
const tiles = (top: number) => a.frames.map((f, i) => ({ input: Buffer.from(f.buffer, f.byteOffset, f.byteLength), raw: { width: a.width, height: a.height, channels: 4 as const }, left: i * a.width, top }));
const sheet = await sharp({ create: { width: a.frames.length * a.width, height: a.height * 2, channels: 4, background: '#ededed' } })
  .composite([{ input: { create: { width: a.frames.length * a.width, height: a.height, channels: 4, background: '#111111' } }, left: 0, top: a.height }, ...tiles(0), ...tiles(a.height)])
  .png()
  .toBuffer();
fs.writeFileSync(output, sheet);
console.log(`${report.frames} 帧，${Math.round(report.bytes / 1024)}KB`);
for (const s of report.steps) console.log(' ', s);
