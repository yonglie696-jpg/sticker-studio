import type { GenMode, ProcessReport, ProcessSettings, SpriteGrid } from '../types';
import { captionBand, drawCaption } from './caption';
import { keyBackground } from './chromaKey';
import { cropFit, stabilize } from './cropFit';
import { encodeToFit } from './encode';
import { decodeAnimation, sliceSpriteSmart, type Anim } from './frames';
import { fixLoop } from './loop';
import { inspectGif } from '../validate/wechatRules';

export const STICKER_SIZE = 240;

/**
 * 原始素材 → 符合微信规范的 240×240 循环 GIF。
 * 抠背景 → (精灵图对齐) → 按外接框裁切去留白 → 缩放 → 叠字幕 → 循环处理 → 压缩到目标大小
 */
export async function processSticker(
  raw: Buffer,
  s: ProcessSettings,
  opts: { mode: GenMode; grid: SpriteGrid; spriteFrameMs: number; targetBytes: number },
): Promise<{ gif: Uint8Array; report: ProcessReport }> {
  const steps: string[] = [];
  const isSprite = opts.mode === 'sprite';
  const grid = s.spriteGrid ?? opts.grid;
  const sel = (s.frameSel ?? []).filter((n) => Number.isInteger(n) && n >= 1);
  let anim: Anim;
  if (isSprite) {
    // 选了帧时把所有格子都切出来，再按选择挑
    const sl = await sliceSpriteSmart(raw, sel.length ? { ...grid, frames: grid.cols * grid.rows } : grid, opts.spriteFrameMs);
    anim = sl.anim;
    steps.push(`读取精灵图，按格子之间的空隙切成 ${anim.frames.length} 帧`);
    if (sl.cleaned.length) steps.push(`第 ${sl.cleaned.join('、')} 格边缘有邻格切进来的碎片，已抹掉`);
    // cells[i] = 第 i 帧对应的格子编号
    let cells = anim.frames.map((_, i) => i + 1);
    if (sel.length) {
      const picked = sel.filter((i) => i <= anim.frames.length);
      if (picked.length) {
        cells = picked;
        steps.push(`只用第 ${picked.join('、')} 帧`);
      }
    }
    const blank = cells.filter((i) => sl.empty.includes(i));
    if (blank.length && cells.length - blank.length >= 1) {
      cells = cells.filter((i) => !sl.empty.includes(i));
      steps.push(`第 ${blank.join('、')} 格是空的，已跳过`);
    }
    anim = { ...anim, frames: cells.map((i) => anim.frames[i - 1]), delays: cells.map((i) => anim.delays[i - 1]) };
  } else {
    anim = await decodeAnimation(raw);
    steps.push(`读取 ${anim.width}×${anim.height}，${anim.frames.length} 帧`);
  }
  if (anim.frames.length < 2) steps.push('⚠ 只有 1 帧，不是动图');

  const key = keyBackground(anim, s.keyMode, s.keyThreshold);
  steps.push(key.bg ? `背景色 rgb(${key.bg.join(',')})，${s.keyMode === 'none' ? '保留背景' : '已抠成透明'}` : '原图已是透明背景');

  if (s.stabilize) {
    stabilize(anim);
    steps.push('已对齐各帧位置');
  }

  const withText = s.textMode === 'overlay' && s.caption.trim().length > 0;
  anim = await cropFit(anim, {
    size: STICKER_SIZE,
    padding: s.padding,
    reserveBottom: withText ? captionBand(s.fontSize) : 0,
    transparent: key.transparent,
    bg: key.bg,
  });
  steps.push(`裁掉多余留白并缩放到 ${STICKER_SIZE}×${STICKER_SIZE}`);

  if (withText) {
    anim = drawCaption(anim, { text: s.caption, anim: s.textAnim, color: s.textColor, stroke: s.strokeColor, fontSize: s.fontSize });
    steps.push(`叠加字幕「${s.caption}」`);
  }

  anim = fixLoop(anim, { frameDurationMs: s.frameDurationMs, pingpong: s.pingpong });
  const fit = await encodeToFit(anim, opts.targetBytes);
  steps.push(...fit.steps);

  const info = await inspectGif(Buffer.from(fit.buf));
  return {
    gif: fit.buf,
    report: {
      width: info.width,
      height: info.height,
      bytes: fit.buf.length,
      frames: info.frames,
      loop: info.loop,
      durationMs: info.durationMs,
      colors: fit.colors,
      lossy: fit.lossy,
      steps,
    },
  };
}
