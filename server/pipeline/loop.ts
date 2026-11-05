import { normalizeDelay, type Anim } from './frames';

/** 循环处理：统一帧时长、可选正放+倒放、合并连续重复帧 */
export function fixLoop(anim: Anim, o: { frameDurationMs: number | null; pingpong: boolean }): Anim {
  let frames = anim.frames;
  let delays = o.frameDurationMs ? frames.map(() => normalizeDelay(o.frameDurationMs!)) : [...anim.delays];

  if (o.pingpong && frames.length > 2) {
    const back = frames.slice(1, -1).reverse();
    const backDelays = delays.slice(1, -1).reverse();
    frames = [...frames, ...back];
    delays = [...delays, ...backDelays];
  }

  const outF: Uint8ClampedArray[] = [];
  const outD: number[] = [];
  for (let i = 0; i < frames.length; i++) {
    const prev = outF[outF.length - 1];
    if (prev && sameFrame(prev, frames[i])) outD[outD.length - 1] += delays[i];
    else {
      outF.push(frames[i]);
      outD.push(delays[i]);
    }
  }
  return { ...anim, frames: outF, delays: outD };
}

function sameFrame(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 4) {
    const aa = a[i + 3] >= 128;
    if (aa !== b[i + 3] >= 128) return false;
    if (aa && (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2])) return false;
  }
  return true;
}

/** 抽掉一半帧（时长翻倍），压缩不下来时的最后手段 */
export function dropHalf(anim: Anim): Anim {
  if (anim.frames.length <= 4) return anim;
  const frames: Uint8ClampedArray[] = [];
  const delays: number[] = [];
  for (let i = 0; i < anim.frames.length; i += 2) {
    frames.push(anim.frames[i]);
    delays.push(anim.delays[i] + (anim.delays[i + 1] ?? 0));
  }
  return { ...anim, frames, delays };
}
