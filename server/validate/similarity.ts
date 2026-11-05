import sharp from 'sharp';
import { decodeAnimation } from '../pipeline/frames';

/** 取首帧/中间帧/靠后帧，铺灰底后算 64 位 dHash */
export async function animHash(buf: Buffer): Promise<bigint[]> {
  const a = await decodeAnimation(buf);
  const n = a.frames.length;
  const picks = [...new Set([0, Math.floor(n / 2), Math.floor((n * 3) / 4)])];
  const out: bigint[] = [];
  for (const i of picks) {
    const f = a.frames[i];
    const px = await sharp(Buffer.from(f.buffer, f.byteOffset, f.byteLength), { raw: { width: a.width, height: a.height, channels: 4 } })
      .flatten({ background: '#808080' })
      .grayscale()
      .resize(9, 8, { fit: 'fill' })
      .raw()
      .toBuffer();
    let h = 0n;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) h = (h << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n);
    out.push(h);
  }
  return out;
}

const popcount = (v: bigint) => {
  let c = 0;
  while (v) {
    c += Number(v & 1n);
    v >>= 1n;
  }
  return c;
};

/** 两张动图的平均汉明距离（0 = 一样，64 = 完全不同） */
export function hashDistance(a: bigint[], b: bigint[]) {
  let sum = 0;
  let k = 0;
  for (const x of a) {
    let best = 64;
    for (const y of b) best = Math.min(best, popcount(x ^ y));
    sum += best;
    k++;
  }
  return k ? sum / k : 64;
}

/** 低于这个距离就提示"差异不足"（微信会拒只改了文字的同套表情） */
export const SIMILAR_THRESHOLD = 7;
