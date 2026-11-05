import sharp from 'sharp';
import type { SpriteGrid } from '../types';

/** 一段动画：每帧都是完整合成后的 RGBA 画面 */
export interface Anim {
  width: number;
  height: number;
  frames: Uint8ClampedArray[];
  delays: number[]; // 毫秒
}

/** 解码 GIF / 动态 WebP / 静态 PNG/JPG 为逐帧 RGBA（sharp 会处理好帧叠加和 disposal） */
export async function decodeAnimation(buf: Buffer): Promise<Anim> {
  const img = sharp(buf, { animated: true, limitInputPixels: false });
  const meta = await img.metadata();
  const pages = meta.pages ?? 1;
  const width = meta.width!;
  const height = meta.pageHeight ?? meta.height!;
  const { data } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const size = width * height * 4;
  const frames: Uint8ClampedArray[] = [];
  for (let i = 0; i < pages; i++) frames.push(new Uint8ClampedArray(data.subarray(i * size, (i + 1) * size)));
  const delays = frames.map((_, i) => normalizeDelay(meta.delay?.[i]));
  return { width, height, frames, delays };
}

/** 浏览器把 0~10ms 的帧当 100ms 播，这里统一成同样的行为，并对齐到 GIF 的 10ms 精度 */
export function normalizeDelay(d: number | undefined) {
  if (!d || d < 20) return 100;
  return Math.round(d / 10) * 10;
}

export interface SpriteSlice {
  anim: Anim;
  /** 空格子编号（从 1 开始） */
  empty: number[];
  /** 抹掉了邻格碎片的格子编号 */
  cleaned: number[];
}

/**
 * 智能切精灵图：模型画的格子常常不齐（第一排的脚伸过三等分线、下一排的头往上冒），
 * 死切三等分会把邻格的脚和头切进来。这里：
 * 1. 在每条三等分线附近 ±25% 的范围里找"墨最少"的那一行/列下刀（每一列单独找横向刀口）；
 * 2. 每格里贴着格子边缘、又不是最大块的碎片抹成背景（邻格切进来的残肢）；
 * 3. 几乎没有墨的格子标成空格，交给调用方跳过。
 * 输出的每帧画布比名义格子大 50%，按名义格子位置放，保持角色在帧里的相对位置不变（不会抖）。
 */
export async function sliceSpriteSmart(buf: Buffer, grid: SpriteGrid, frameMs: number): Promise<SpriteSlice> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;

  // 背景：四周一圈像素的中位色；四周大多透明则视为透明底
  const border: number[][] = [];
  const step = Math.max(1, Math.floor((W + H) / 400));
  for (let x = 0; x < W; x += step) border.push(px(data, W, x, 0), px(data, W, x, H - 1));
  for (let y = 0; y < H; y += step) border.push(px(data, W, 0, y), px(data, W, W - 1, y));
  const transparent = border.filter((p) => p[3] < 128).length > border.length / 2;
  const med = (k: number) => border.map((p) => p[k]).sort((a, b) => a - b)[border.length >> 1];
  const bg = [med(0), med(1), med(2)];

  // 墨（前景）掩码
  const ink = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < ink.length; i++, p += 4) {
    if (data[p + 3] < 128) continue;
    if (transparent) ink[i] = 1;
    else {
      const dr = data[p] - bg[0];
      const dg = data[p + 1] - bg[1];
      const db = data[p + 2] - bg[2];
      if (dr * dr + dg * dg + db * db > 40 * 40) ink[i] = 1;
    }
  }

  const cw = W / grid.cols;
  const ch = H / grid.rows;
  // 竖向刀口：全图统一
  const colProfile = new Float64Array(W);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) colProfile[x] += ink[y * W + x];
  const xs = [0, ...Array.from({ length: grid.cols - 1 }, (_, k) => findGutter(colProfile, (k + 1) * cw, cw * 0.25)), W];
  // 横向刀口：每一列单独找（模型常常每列的高低不一样）
  const ys: number[][] = [];
  for (let c = 0; c < grid.cols; c++) {
    const prof = new Float64Array(H);
    for (let y = 0; y < H; y++) for (let x = xs[c]; x < xs[c + 1]; x++) prof[y] += ink[y * W + x];
    ys.push([0, ...Array.from({ length: grid.rows - 1 }, (_, k) => findGutter(prof, (k + 1) * ch, ch * 0.25)), H]);
  }

  const FW = Math.round(cw * 1.5);
  const FH = Math.round(ch * 1.5);
  const total = Math.min(grid.frames, grid.cols * grid.rows);
  const frames: Uint8ClampedArray[] = [];
  const empty: number[] = [];
  const cleaned: number[] = [];
  for (let f = 0; f < total; f++) {
    const c = f % grid.cols;
    const r = Math.floor(f / grid.cols);
    const x0 = xs[c];
    const x1 = xs[c + 1];
    const y0 = ys[c][r];
    const y1 = ys[c][r + 1];
    const keep = cellKeepMask(ink, W, x0, y0, x1, y1);
    if (keep.removed) cleaned.push(f + 1);
    if (keep.largest < (x1 - x0) * (y1 - y0) * 0.004) empty.push(f + 1);

    const out = new Uint8ClampedArray(FW * FH * 4);
    if (!transparent) for (let i = 0; i < FW * FH; i++) out.set([bg[0], bg[1], bg[2], 255], i * 4);
    const ox = Math.round(c * cw - cw * 0.25);
    const oy = Math.round(r * ch - ch * 0.25);
    const cwid = x1 - x0;
    for (let y = y0; y < y1; y++) {
      const ty = y - oy;
      if (ty < 0 || ty >= FH) continue;
      for (let x = x0; x < x1; x++) {
        const tx = x - ox;
        if (tx < 0 || tx >= FW) continue;
        if (!keep.mask[(y - y0) * cwid + (x - x0)]) continue;
        const s = (y * W + x) * 4;
        out.set(data.subarray(s, s + 4), (ty * FW + tx) * 4);
      }
    }
    frames.push(out);
  }
  return { anim: { width: FW, height: FH, frames, delays: frames.map(() => normalizeDelay(frameMs)) }, empty, cleaned };
}

function px(d: Uint8Array | Buffer, W: number, x: number, y: number) {
  const i = (y * W + x) * 4;
  return [d[i], d[i + 1], d[i + 2], d[i + 3]];
}

/** 在 nominal ± win 里找墨最少的位置（用 5 像素窗口平滑），一样少时取离 nominal 最近的 */
export function findGutter(profile: Float64Array, nominal: number, win: number): number {
  const lo = Math.max(1, Math.round(nominal - win));
  const hi = Math.min(profile.length - 1, Math.round(nominal + win));
  let best = Math.round(nominal);
  let bestV = Infinity;
  for (let t = lo; t <= hi; t++) {
    let v = 0;
    for (let k = -2; k <= 2; k++) v += profile[Math.min(profile.length - 1, Math.max(0, t + k))];
    const better = v < bestV - 1e-9 || (Math.abs(v - bestV) < 1e-9 && Math.abs(t - nominal) < Math.abs(best - nominal));
    if (better) {
      bestV = v;
      best = t;
    }
  }
  return best;
}

/**
 * 格子里哪些像素要保留：墨按 8 连通分块，最大块（角色本体）和不贴边的小块（眼泪、爱心、影子）保留；
 * 贴着格子边缘、又明显小于本体的块是邻格切进来的碎片，抹掉。背景像素一律保留（后面抠图用）。
 */
function cellKeepMask(ink: Uint8Array, W: number, x0: number, y0: number, x1: number, y1: number) {
  const w = x1 - x0;
  const h = y1 - y0;
  const label = new Int32Array(w * h);
  const sizes: number[] = [0];
  const touches: boolean[] = [false];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (label[start] || !ink[(y0 + Math.floor(start / w)) * W + x0 + (start % w)]) continue;
    const id = sizes.length;
    let size = 0;
    let touch = false;
    let sp = 0;
    stack[sp++] = start;
    label[start] = id;
    while (sp) {
      const cur = stack[--sp];
      const cx = cur % w;
      const cy = (cur - cx) / w;
      size++;
      if (cx === 0 || cy === 0 || cx === w - 1 || cy === h - 1) touch = true;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (label[n] || !ink[(y0 + ny) * W + x0 + nx]) continue;
          label[n] = id;
          stack[sp++] = n;
        }
    }
    sizes.push(size);
    touches.push(touch);
  }
  let largestId = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[largestId]) largestId = i;
  const biggest = sizes[largestId] ?? 0;
  const drop = new Uint8Array(sizes.length);
  let removed = false;
  let largest = 0; // 保留下来的最大块
  for (let i = 1; i < sizes.length; i++) {
    // 贴边、并且明显比本体小（或者本身就很小，比如空格子里只伸进来一截天线）→ 邻格碎片
    const fragment = touches[i] && ((i !== largestId && sizes[i] < biggest * 0.6) || sizes[i] < w * h * 0.03);
    if (fragment) {
      drop[i] = 1;
      removed = true;
    } else largest = Math.max(largest, sizes[i]);
  }
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = drop[label[i]] ? 0 : 1;
  return { mask, largest, removed };
}

/** 把精灵图（cols×rows 网格，按行从左到右）等分切成帧 */
export async function sliceSprite(buf: Buffer, grid: SpriteGrid, frameMs: number): Promise<Anim> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const cw = Math.floor(info.width / grid.cols);
  const ch = Math.floor(info.height / grid.rows);
  const frames: Uint8ClampedArray[] = [];
  const total = Math.min(grid.frames, grid.cols * grid.rows);
  for (let f = 0; f < total; f++) {
    const gx = (f % grid.cols) * cw;
    const gy = Math.floor(f / grid.cols) * ch;
    const out = new Uint8ClampedArray(cw * ch * 4);
    for (let y = 0; y < ch; y++) {
      const src = ((gy + y) * info.width + gx) * 4;
      out.set(data.subarray(src, src + cw * 4), y * cw * 4);
    }
    frames.push(out);
  }
  return { width: cw, height: ch, frames, delays: frames.map(() => normalizeDelay(frameMs)) };
}

export function cloneAnim(a: Anim): Anim {
  return { ...a, frames: a.frames.map((f) => new Uint8ClampedArray(f)), delays: [...a.delays] };
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
