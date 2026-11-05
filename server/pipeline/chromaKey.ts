import type { KeyMode } from '../types';
import type { Anim } from './frames';

export type RGB = [number, number, number];

/** 读所有帧的边缘像素：判断是否本来就是透明底；不是的话取边缘颜色中位数作为背景色 */
export function detectBackground(anim: Anim): { bg: RGB | null; alreadyTransparent: boolean } {
  const { width: w, height: h } = anim;
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  let clear = 0;
  let total = 0;
  const step = Math.max(1, Math.floor((w + h) / 200));
  for (const f of anim.frames) {
    const visit = (x: number, y: number) => {
      const i = (y * w + x) * 4;
      total++;
      if (f[i + 3] < 128) {
        clear++;
        return;
      }
      rs.push(f[i]);
      gs.push(f[i + 1]);
      bs.push(f[i + 2]);
    };
    for (let x = 0; x < w; x += step) {
      visit(x, 0);
      visit(x, h - 1);
    }
    for (let y = 0; y < h; y += step) {
      visit(0, y);
      visit(w - 1, y);
    }
  }
  if (clear / total > 0.5) return { bg: null, alreadyTransparent: true };
  const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1] ?? 255;
  return { bg: [med(rs), med(gs), med(bs)], alreadyTransparent: false };
}

/** 把背景抠成透明（原地修改）。返回是否产生了透明像素 */
export function keyBackground(anim: Anim, mode: KeyMode, threshold: number): { transparent: boolean; bg: RGB | null } {
  const det = detectBackground(anim);
  if (det.alreadyTransparent) return { transparent: true, bg: null };
  if (mode === 'none' || !det.bg) return { transparent: false, bg: det.bg };
  const bg = det.bg;
  for (const f of anim.frames) keyFrame(f, anim.width, anim.height, bg, mode, threshold);
  return { transparent: true, bg };
}

function keyFrame(f: Uint8ClampedArray, w: number, h: number, bg: RGB, mode: KeyMode, t: number) {
  const n = w * h;
  const t2 = t * t;
  const removed = new Uint8Array(n);
  const d2 = (p: number) => {
    const i = p * 4;
    const dr = f[i] - bg[0];
    const dg = f[i + 1] - bg[1];
    const db = f[i + 2] - bg[2];
    return dr * dr + dg * dg + db * db;
  };

  if (mode === 'global') {
    for (let p = 0; p < n; p++) if (d2(p) <= t2) removed[p] = 1;
  } else {
    // 从四条边开始的连通区域漫水填充：只去掉和外部连通的背景
    const queue = new Int32Array(n);
    let head = 0;
    let tail = 0;
    const push = (p: number) => {
      if (!removed[p] && d2(p) <= t2) {
        removed[p] = 1;
        queue[tail++] = p;
      }
    };
    for (let x = 0; x < w; x++) {
      push(x);
      push((h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
      push(y * w);
      push(y * w + w - 1);
    }
    while (head < tail) {
      const p = queue[head++];
      const x = p % w;
      if (x > 0) push(p - 1);
      if (x < w - 1) push(p + 1);
      if (p >= w) push(p - w);
      if (p < n - w) push(p + w);
    }
  }

  // 去白边：紧贴背景的抗锯齿像素按混合比例估 alpha，偏背景的去掉，偏主体的反推出原色
  const tEdge = t * 2.5;
  for (let p = 0; p < n; p++) {
    if (removed[p]) continue;
    const x = p % w;
    const touches =
      (x > 0 && removed[p - 1] === 1) ||
      (x < w - 1 && removed[p + 1] === 1) ||
      (p >= w && removed[p - w] === 1) ||
      (p < n - w && removed[p + w] === 1);
    if (!touches) continue;
    const d = Math.sqrt(d2(p));
    if (d >= tEdge) continue;
    const a = (d - t) / (tEdge - t);
    if (a < 0.5) {
      removed[p] = 2; // 2 = 边缘去掉（不参与后续邻接判断以免连锁）
      continue;
    }
    const i = p * 4;
    for (let c = 0; c < 3; c++) f[i + c] = Math.max(0, Math.min(255, (f[i + c] - (1 - a) * bg[c]) / a));
  }

  for (let p = 0; p < n; p++) {
    if (removed[p]) {
      const i = p * 4;
      f[i] = f[i + 1] = f[i + 2] = f[i + 3] = 0;
    }
  }
}
