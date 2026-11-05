import sharp from 'sharp';
import type { Anim } from './frames';
import type { RGB } from './chromaKey';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 所有帧主体的外接框并集（透明底看 alpha；不透明底看和背景色的差异） */
export function unionBBox(anim: Anim, transparent: boolean, bg: RGB | null, threshold = 40): Box | null {
  const { width: w, height: h } = anim;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  const t2 = threshold * threshold;
  for (const f of anim.frames) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        let solid: boolean;
        if (transparent || !bg) solid = f[i + 3] >= 128;
        else {
          const dr = f[i] - bg[0];
          const dg = f[i + 1] - bg[1];
          const db = f[i + 2] - bg[2];
          solid = dr * dr + dg * dg + db * db > t2;
        }
        if (solid) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** 精灵图去抖：把每帧主体的水平中心和底边对齐到中位数 */
export function stabilize(anim: Anim): void {
  const { width: w, height: h } = anim;
  const boxes = anim.frames.map((f) => unionBBox({ ...anim, frames: [f] }, true, null));
  const valid = boxes.filter(Boolean) as Box[];
  if (valid.length < 2) return;
  const med = (a: number[]) => [...a].sort((p, q) => p - q)[a.length >> 1];
  const cx = med(valid.map((b) => b.x + b.w / 2));
  const bottom = med(valid.map((b) => b.y + b.h));
  anim.frames = anim.frames.map((f, k) => {
    const b = boxes[k];
    if (!b) return f;
    const dx = Math.round(cx - (b.x + b.w / 2));
    const dy = Math.round(bottom - (b.y + b.h));
    if (!dx && !dy) return f;
    const out = new Uint8ClampedArray(f.length);
    for (let y = 0; y < h; y++) {
      const sy = y - dy;
      if (sy < 0 || sy >= h) continue;
      for (let x = 0; x < w; x++) {
        const sx = x - dx;
        if (sx < 0 || sx >= w) continue;
        const si = (sy * w + sx) * 4;
        out.set(f.subarray(si, si + 4), (y * w + x) * 4);
      }
    }
    return out;
  });
}

/**
 * 按全帧外接框裁切并缩放进 size×size 画布，去掉多余留白。
 * reserveBottom：给后期字幕留出的底部像素（角色放在上方区域内居中）。
 */
export async function cropFit(
  anim: Anim,
  opts: { size: number; padding: number; reserveBottom: number; transparent: boolean; bg: RGB | null },
): Promise<Anim> {
  const { size, padding, reserveBottom, transparent, bg } = opts;
  const box = unionBBox(anim, transparent, bg) ?? { x: 0, y: 0, w: anim.width, h: anim.height };
  const pad = Math.round(Math.max(box.w, box.h) * (padding / 100));
  const region = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
  const areaW = size;
  const areaH = size - reserveBottom;
  const scale = Math.min(areaW / region.w, areaH / region.h);
  const tw = Math.max(1, Math.round(region.w * scale));
  const th = Math.max(1, Math.round(region.h * scale));
  const ox = Math.round((areaW - tw) / 2);
  const oy = Math.round((areaH - th) / 2);
  const fill = transparent || !bg ? { r: 0, g: 0, b: 0, alpha: 0 } : { r: bg[0], g: bg[1], b: bg[2], alpha: 1 };

  // 区域可能超出原图，先裁交集再补边
  const ix = Math.max(0, region.x);
  const iy = Math.max(0, region.y);
  const ix2 = Math.min(anim.width, region.x + region.w);
  const iy2 = Math.min(anim.height, region.y + region.h);

  const frames: Uint8ClampedArray[] = [];
  for (const f of anim.frames) {
    // 注意：sharp 在同一条管线里会先 resize 再 extend，所以补边和缩放必须分两步做，
    // 否则主体贴边时输出宽度不等于 tw，逐行拷贝会整体错位
    const padded = await sharp(Buffer.from(f.buffer, f.byteOffset, f.byteLength), {
      raw: { width: anim.width, height: anim.height, channels: 4 },
    })
      .extract({ left: ix, top: iy, width: ix2 - ix, height: iy2 - iy })
      .extend({
        left: ix - region.x,
        top: iy - region.y,
        right: region.x + region.w - ix2,
        bottom: region.y + region.h - iy2,
        background: fill,
      })
      .raw()
      .toBuffer();
    const resized = await sharp(padded, { raw: { width: region.w, height: region.h, channels: 4 } })
      .resize(tw, th, { kernel: 'lanczos3', fit: 'fill' })
      .raw()
      .toBuffer();
    if (resized.length !== tw * th * 4) throw new Error(`缩放尺寸异常：期望 ${tw}×${th}`);
    const out = new Uint8ClampedArray(size * size * 4);
    if (!transparent && bg) {
      for (let p = 0; p < size * size; p++) out.set([bg[0], bg[1], bg[2], 255], p * 4);
    }
    for (let y = 0; y < th; y++) {
      const row = resized.subarray(y * tw * 4, (y + 1) * tw * 4);
      out.set(row, ((oy + y) * size + ox) * 4);
    }
    frames.push(out);
  }
  return { width: size, height: size, frames, delays: [...anim.delays] };
}
