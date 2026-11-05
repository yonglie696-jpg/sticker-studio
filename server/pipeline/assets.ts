import sharp from 'sharp';
import type { AssetKind } from '../types';
import { keyBackground } from './chromaKey';
import { cropFit, unionBBox } from './cropFit';
import { decodeAnimation, type Anim } from './frames';

/** 微信对配套图片的要求 */
export const ASSET_SPECS: Record<
  AssetKind,
  { label: string; w: number; h: number; maxBytes: number; transparent: boolean; formats: string[]; note: string }
> = {
  cover: { label: '表情封面图', w: 240, h: 240, maxBytes: 500 * 1024, transparent: true, formats: ['png'], note: '透明底 PNG，正面半身/全身，无文字、无白描边' },
  icon: { label: '聊天面板图标', w: 50, h: 50, maxBytes: 100 * 1024, transparent: true, formats: ['png'], note: '透明底 PNG，头部正面' },
  banner: { label: '详情页横幅', w: 750, h: 400, maxBytes: 500 * 1024, transparent: false, formats: ['png', 'jpg'], note: '无文字、非白底、有故事性' },
  rewardGuide: { label: '赞赏引导图', w: 750, h: 560, maxBytes: 500 * 1024, transparent: false, formats: ['png', 'gif'], note: '风格与表情一致，活泼明朗，非透明' },
  rewardThanks: { label: '赞赏致谢图', w: 750, h: 750, maxBytes: 500 * 1024, transparent: false, formats: ['png', 'gif'], note: '风格与表情一致，非透明' },
};

export interface AssetOpts {
  /** 图标用：取主体从上往下多少比例（头部） */
  headRatio?: number;
  /** 不透明类图片铺底色（原图透明时） */
  fillColor?: string;
}

/** 把任意输入图处理成对应规格；返回文件内容和扩展名 */
export async function processAsset(kind: AssetKind, input: Buffer, o: AssetOpts = {}): Promise<{ buf: Buffer; ext: string }> {
  const spec = ASSET_SPECS[kind];
  const meta = await sharp(input, { animated: true }).metadata();
  const animated = (meta.pages ?? 1) > 1;

  if (kind === 'cover' || kind === 'icon') {
    let anim: Anim = await decodeAnimation(input);
    anim = { ...anim, frames: [anim.frames[0]], delays: [anim.delays[0]] };
    const key = keyBackground(anim, 'flood', 48);
    // 默认全身（大头 Q 版角色本身就以头为主）；只取上部时会产生硬直边，微信不建议
    if (kind === 'icon' && (o.headRatio ?? 1) < 0.99) {
      const box = unionBBox(anim, key.transparent, key.bg);
      if (box) {
        // 只保留上部（头部），下面清空
        const cut = box.y + Math.round(box.h * (o.headRatio ?? 1));
        const f = anim.frames[0];
        for (let y = cut; y < anim.height; y++) f.fill(0, y * anim.width * 4, (y + 1) * anim.width * 4);
      }
    }
    const fitted = await cropFit(anim, { size: spec.w, padding: 3, reserveBottom: 0, transparent: true, bg: key.bg });
    let buf = await sharp(Buffer.from(fitted.frames[0].buffer), { raw: { width: spec.w, height: spec.h, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    if (buf.length > spec.maxBytes) {
      buf = await sharp(buf).png({ palette: true, quality: 90, compressionLevel: 9 }).toBuffer();
    }
    return { buf, ext: 'png' };
  }

  const bg = o.fillColor ?? '#FFE3EC';
  if (animated && spec.formats.includes('gif')) {
    let q = 90;
    let buf = await sharp(input, { animated: true }).resize(spec.w, spec.h, { fit: 'cover' }).flatten({ background: bg }).gif({ effort: 10 }).toBuffer();
    while (buf.length > spec.maxBytes && q > 30) {
      q -= 20;
      buf = await sharp(input, { animated: true })
        .resize(spec.w, spec.h, { fit: 'cover' })
        .flatten({ background: bg })
        .gif({ effort: 10, colours: Math.max(32, Math.round((256 * q) / 100)), dither: 0 })
        .toBuffer();
    }
    return { buf, ext: 'gif' };
  }

  // 横幅是场景图，可以裁；赞赏图通常是单个角色，比例差太多时硬裁会切掉耳朵/头顶，
  // 所以改为完整缩放进画面，空出的边用原图边缘的颜色补齐
  let base: ReturnType<typeof sharp>;
  const srcRatio = (meta.width ?? 1) / (meta.pageHeight ?? meta.height ?? 1);
  const dstRatio = spec.w / spec.h;
  if (kind !== 'banner' && Math.abs(srcRatio - dstRatio) / dstRatio > 0.08) {
    const { dominant } = await sharp(input).extract(edgeStrip(meta.width!, meta.pageHeight ?? meta.height!)).stats();
    const fill = { r: dominant.r, g: dominant.g, b: dominant.b, alpha: 1 };
    base = sharp(await sharp(input).flatten({ background: fill }).resize(spec.w, spec.h, { fit: 'contain', background: fill }).png().toBuffer());
  } else {
    base = sharp(input).resize(spec.w, spec.h, { fit: 'cover', position: 'attention' }).flatten({ background: bg });
  }
  let buf = await base.clone().png({ compressionLevel: 9 }).toBuffer();
  if (buf.length <= spec.maxBytes) return { buf, ext: 'png' };
  buf = await base.clone().png({ palette: true, quality: 90, compressionLevel: 9 }).toBuffer();
  if (buf.length <= spec.maxBytes || !spec.formats.includes('jpg')) return { buf, ext: 'png' };
  let q = 90;
  do {
    buf = await base.clone().jpeg({ quality: q, mozjpeg: true }).toBuffer();
    q -= 8;
  } while (buf.length > spec.maxBytes && q > 40);
  return { buf, ext: 'jpg' };
}

/**
 * 艺术家头像：640×640、≤500KB、不透明。用角色参考图放在柔和的粉色径向渐变上，
 * 角色完整落在内切圆里（平台/微信常把头像裁成圆形，不会切到耳朵）
 */
export async function makeArtistAvatar(referencePng: Buffer, opts: { inner?: string; outer?: string } = {}): Promise<Buffer> {
  const S = 640;
  const inner = opts.inner ?? '#FFF4F6';
  const outer = opts.outer ?? '#FFC9D6';
  const bg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">
      <defs><radialGradient id="g" cx="50%" cy="46%" r="62%">
        <stop offset="0%" stop-color="${inner}"/><stop offset="100%" stop-color="${outer}"/>
      </radialGradient></defs>
      <rect width="${S}" height="${S}" fill="url(#g)"/>
      <circle cx="${S * 0.18}" cy="${S * 0.2}" r="10" fill="#ffffff" opacity="0.7"/>
      <circle cx="${S * 0.84}" cy="${S * 0.26}" r="7" fill="#ffffff" opacity="0.7"/>
      <circle cx="${S * 0.8}" cy="${S * 0.8}" r="11" fill="#ffffff" opacity="0.6"/>
      <circle cx="${S * 0.15}" cy="${S * 0.74}" r="6" fill="#ffffff" opacity="0.6"/>
    </svg>`,
  );
  const ch = await sharp(referencePng).trim().resize({ height: Math.round(S * 0.7), fit: 'inside' }).png().toBuffer();
  const m = await sharp(ch).metadata();
  // 保证角色外接框的四个角都在半径 0.47S 的圆内
  const half = Math.hypot(m.width! / 2, m.height! / 2);
  const k = Math.min(1, (S * 0.47) / half);
  const fitted = k < 1 ? await sharp(ch).resize(Math.round(m.width! * k), Math.round(m.height! * k)).png().toBuffer() : ch;
  const fm = await sharp(fitted).metadata();
  // sharp 管线里 flatten 会先于 composite 执行，所以分两步：先合成，再去掉透明通道
  const composed = await sharp(bg)
    .composite([{ input: fitted, left: Math.round((S - fm.width!) / 2), top: Math.round((S - fm.height!) / 2 + S * 0.02) }])
    .png()
    .toBuffer();
  let out = await sharp(composed).flatten({ background: outer }).removeAlpha().png({ compressionLevel: 9 }).toBuffer();
  if (out.length > 500 * 1024) out = await sharp(out).png({ palette: true, quality: 90 }).toBuffer();
  return out;
}

/** 左边缘一条竖条（用来取背景色） */
function edgeStrip(w: number, h: number) {
  return { left: 0, top: 0, width: Math.max(1, Math.round(w * 0.04)), height: h };
}

/** 检查一个配套图片是否合规 */
export async function inspectAsset(kind: AssetKind, buf: Buffer, ext: string) {
  const spec = ASSET_SPECS[kind];
  const meta = await sharp(buf, { animated: true }).metadata();
  const issues: string[] = [];
  const h = meta.pageHeight ?? meta.height;
  if (meta.width !== spec.w || h !== spec.h) issues.push(`尺寸应为 ${spec.w}×${spec.h}，实际 ${meta.width}×${h}`);
  if (buf.length > spec.maxBytes) issues.push(`大小超过 ${spec.maxBytes / 1024}KB`);
  if (!spec.formats.includes(ext)) issues.push(`格式应为 ${spec.formats.join('/')}`);
  if (spec.transparent && !meta.hasAlpha) issues.push('须为透明背景');
  return issues;
}
