import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as gifencNs from 'gifenc';
// gifenc 在 Node 下解析成 CommonJS（只有 default），在 Vite/Vitest 下解析成 ESM（只有具名导出），两种都兼容
export const gifenc: typeof import('gifenc').default = (gifencNs as any).GIFEncoder ? (gifencNs as any) : (gifencNs as any).default;
const { GIFEncoder, applyPalette, quantize } = gifenc;
import gifsiclePath from 'gifsicle';
import type { Anim } from './frames';
import { dropHalf } from './loop';

/** 全局调色板编码 GIF：一位透明（alpha<128 视为透明）、无限循环 */
export function encodeGif(anim: Anim, colors: number): Uint8Array {
  const { width: w, height: h, frames, delays } = anim;
  const transparent = frames.some((f) => {
    for (let i = 3; i < f.length; i += 4) if (f[i] < 128) return true;
    return false;
  });

  // 采样所有帧的不透明像素做量化，保证全套帧颜色一致、不闪
  const total = frames.length * w * h;
  const stride = Math.max(1, Math.floor(total / 200_000));
  const sample: number[] = [];
  let k = 0;
  for (const f of frames) {
    for (let i = 0; i < f.length; i += 4, k++) {
      if (k % stride || f[i + 3] < 128) continue;
      sample.push(f[i], f[i + 1], f[i + 2], 255);
    }
  }
  if (!sample.length) sample.push(255, 255, 255, 255);
  const maxColors = Math.max(2, transparent ? colors - 1 : colors);
  // 量化用 rgb444 直方图（4096 桶）：颜色丰富的画面上比 rgb565 快约 100 倍，卡通画风几乎看不出差别；
  // 映射像素时仍用 rgb565 保证精度
  let palette = quantize(new Uint8Array(sample), maxColors, { format: 'rgb444' });
  const offset = transparent ? 1 : 0;
  if (transparent) palette = [[255, 255, 255], ...palette];
  let size = 2;
  while (size < palette.length) size *= 2;
  while (palette.length < size) palette.push([0, 0, 0]);

  const gif = GIFEncoder();
  frames.forEach((f, i) => {
    const opaque = new Uint8Array(f.length);
    opaque.set(f);
    const idx = applyPalette(opaque, palette.slice(offset), 'rgb565');
    if (transparent) {
      for (let p = 0; p < idx.length; p++) idx[p] = f[p * 4 + 3] < 128 ? 0 : idx[p] + 1;
    }
    gif.writeFrame(idx, w, h, {
      palette: i === 0 ? palette : undefined,
      first: i === 0,
      delay: delays[i],
      repeat: 0,
      transparent,
      transparentIndex: 0,
      dispose: transparent ? 2 : 1,
    });
  });
  gif.finish();
  return gif.bytes();
}

let gifsicleOk: boolean | null = null;
function hasGifsicle() {
  if (gifsicleOk === null) gifsicleOk = !!gifsiclePath && fs.existsSync(gifsiclePath);
  return gifsicleOk;
}

/** gifsicle 无损 -O3 优化 + 可选有损压缩 */
export async function gifsicle(buf: Uint8Array, lossy: number): Promise<Uint8Array> {
  if (!hasGifsicle()) return buf;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-'));
  const inp = path.join(dir, 'in.gif');
  const out = path.join(dir, 'out.gif');
  fs.writeFileSync(inp, buf);
  const args = ['-O3', '--no-warnings', ...(lossy > 0 ? [`--lossy=${lossy}`] : []), '-o', out, inp];
  try {
    await new Promise<void>((res, rej) => execFile(gifsiclePath, args, (e) => (e ? rej(e) : res())));
    return new Uint8Array(fs.readFileSync(out));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export interface FitResult {
  buf: Uint8Array;
  colors: number;
  lossy: number;
  frames: number;
  steps: string[];
}

const LADDER = [
  { colors: 256, lossy: 0 },
  { colors: 256, lossy: 30 },
  { colors: 192, lossy: 60 },
  { colors: 128, lossy: 90 },
  { colors: 96, lossy: 120 },
  { colors: 64, lossy: 150 },
];

/** 逐级降颜色/加有损压缩直到 ≤ targetBytes；还不行就抽帧再来一遍 */
export async function encodeToFit(anim: Anim, targetBytes: number): Promise<FitResult & { anim: Anim }> {
  const steps: string[] = [];
  let cur = anim;
  for (let round = 0; round < 3; round++) {
    for (const s of LADDER) {
      const raw = encodeGif(cur, s.colors);
      const buf = await gifsicle(raw, s.lossy);
      steps.push(`${cur.frames.length}帧 ${s.colors}色 lossy${s.lossy} → ${(buf.length / 1024).toFixed(0)}KB`);
      if (buf.length <= targetBytes) return { buf, colors: s.colors, lossy: s.lossy, frames: cur.frames.length, steps, anim: cur };
    }
    const next = dropHalf(cur);
    if (next === cur) break;
    steps.push('仍超出大小，抽掉一半帧');
    cur = next;
  }
  const buf = await gifsicle(encodeGif(cur, 48), 200);
  steps.push(`最后尝试 48色 lossy200 → ${(buf.length / 1024).toFixed(0)}KB`);
  return { buf, colors: 48, lossy: 200, frames: cur.frames.length, steps, anim: cur };
}
