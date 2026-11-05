import path from 'node:path';
import { createCanvas, GlobalFonts, ImageData } from '@napi-rs/canvas';
import { RES } from '../store';
import type { TextAnim } from '../types';
import type { Anim } from './frames';

const FONT_FAMILY = 'ZCOOL KuaiLe';
GlobalFonts.registerFromPath(path.join(RES, 'fonts', 'ZCOOLKuaiLe-Regular.ttf'), FONT_FAMILY);

export interface CaptionOpts {
  text: string;
  anim: TextAnim;
  color: string;
  stroke: string;
  fontSize: number;
}

/** 字幕区高度（给 cropFit 预留） */
export const captionBand = (fontSize: number) => Math.round(fontSize * 0.95);

/** 每帧在底部叠加带粗描边的字幕，可带轻微动效（第一帧就完整可读） */
export function drawCaption(anim: Anim, o: CaptionOpts): Anim {
  const text = o.text.trim();
  if (!text) return anim;
  const { width: w, height: h } = anim;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const n = anim.frames.length;

  let fontSize = o.fontSize;
  ctx.font = `${fontSize}px "${FONT_FAMILY}"`;
  const maxW = w - 16;
  while (ctx.measureText(text).width + fontSize * 0.25 > maxW && fontSize > 20) {
    fontSize -= 2;
    ctx.font = `${fontSize}px "${FONT_FAMILY}"`;
  }
  const baseY = h - fontSize * 0.55 - 4;

  const frames = anim.frames.map((f, i) => {
    const t = n > 1 ? i / n : 0;
    let scale = 1;
    let dx = 0;
    let dy = 0;
    let rot = 0;
    if (o.anim === 'bounce') {
      const s = Math.sin(t * Math.PI * 2);
      scale = 1 + 0.05 * s;
      dy = -3 * Math.abs(s);
    } else if (o.anim === 'shake') {
      dx = 3 * Math.sin(t * Math.PI * 8);
      rot = 0.035 * Math.sin(t * Math.PI * 8 + 1);
    } else if (o.anim === 'pop') {
      // 前 30% 帧：0.85 → 1.12 → 1 弹出，之后静止
      const k = Math.min(1, t / 0.3);
      scale = k < 0.6 ? 0.85 + (1.12 - 0.85) * (k / 0.6) : 1.12 - 0.12 * ((k - 0.6) / 0.4);
    }

    ctx.clearRect(0, 0, w, h);
    ctx.putImageData(new ImageData(f, w, h), 0, 0);
    ctx.save();
    ctx.translate(w / 2 + dx, baseY + dy);
    ctx.rotate(rot);
    ctx.scale(scale, scale);
    ctx.font = `${fontSize}px "${FONT_FAMILY}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(4, fontSize * 0.24);
    ctx.strokeStyle = o.stroke;
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = o.color;
    ctx.fillText(text, 0, 0);
    ctx.restore();
    return new Uint8ClampedArray(ctx.getImageData(0, 0, w, h).data);
  });
  return { ...anim, frames };
}
