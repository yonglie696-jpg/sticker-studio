import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
// archiver v8 是 ESM，导出 ZipArchive 类（@types 还停在旧 API）
// @ts-ignore
import { ZipArchive } from 'archiver';
import { isProviderId, PROVIDER_INFO } from '../providerInfo';
import { labelImage, type AigcInfo } from '../pipeline/aigcLabel';
import { ASSET_SPECS, makeArtistAvatar } from '../pipeline/assets';
import { selectedOf } from '../service';
import { EXPORTS, absPath, db, getAlbum, getCharacter } from '../store';
import type { AssetKind, Candidate } from '../types';

/** 生成方描述（写进隐式标识） */
function producerOf(c: Candidate): string {
  if (isProviderId(c.backend)) return `${PROVIDER_INFO[c.backend].label} ${db.settings.providers[c.backend].imageModel}`.trim();
  return '用户导入的 AI 生成图';
}

/** 复制文件并写入 AIGC 隐式标识 */
function copyLabeled(src: string, dst: string, info: AigcInfo) {
  fs.writeFileSync(dst, labelImage(fs.readFileSync(src), info));
}

const ASSET_FILE: Record<AssetKind, string> = {
  cover: '表情封面图',
  icon: '聊天面板图标',
  banner: '详情页横幅',
  rewardGuide: '赞赏引导图',
  rewardThanks: '赞赏致谢图',
};

/** 导出上架包：一个文件夹 + 同名 zip。文件名按微信上传顺序编号 */
export async function exportKit(albumId: string): Promise<{ dir: string; zip: string }> {
  const a = getAlbum(albumId);
  const c = getCharacter(a.characterId);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const safe = (s: string) => s.replace(/[\\/:*?"<>|\s]/g, '');
  const dir = path.join(EXPORTS, `${safe(a.name) || 'album'}_${stamp}`);
  fs.mkdirSync(path.join(dir, '表情图'), { recursive: true });

  const ready = a.stickers.filter((s) => selectedOf(s));
  ready.forEach((s, i) => {
    const name = `${String(i + 1).padStart(2, '0')}_${safe(s.meaning)}.gif`;
    const cand = selectedOf(s)!;
    copyLabeled(absPath(cand.processedPath!), path.join(dir, '表情图', name), { producer: producerOf(cand), produceId: cand.id });
  });
  const assetInfo = (id: string): AigcInfo => ({ producer: 'AI 辅助生成', produceId: id });
  for (const [kind, rel] of Object.entries(a.assets) as [AssetKind, string][]) {
    if (!rel) continue;
    copyLabeled(absPath(rel), path.join(dir, `${ASSET_FILE[kind]}${path.extname(rel)}`), assetInfo(`${a.id}-${kind}`));
  }

  // 艺术家头像：640×640（用角色参考图合成）
  let artistAvatar = false;
  if (c.referencePng) {
    const avatar = await makeArtistAvatar(fs.readFileSync(absPath(c.referencePng)));
    fs.writeFileSync(path.join(dir, '艺术家头像.png'), labelImage(avatar, assetInfo(`${c.id}-avatar`)));
    artistAvatar = true;
  }

  // 艺术家资料的主页横幅：750×400、≤80KB（从详情页横幅压出来）
  let artistBanner = false;
  if (a.assets.banner) {
    let q = 85;
    let buf: Buffer;
    do {
      buf = await sharp(absPath(a.assets.banner)).resize(750, 400, { fit: 'cover' }).flatten({ background: '#FFE3EC' }).jpeg({ quality: q, mozjpeg: true }).toBuffer();
      q -= 7;
    } while (buf.length > 80 * 1024 && q > 20);
    if (buf.length <= 80 * 1024) {
      fs.writeFileSync(path.join(dir, '艺术家主页横幅.jpg'), labelImage(buf, assetInfo(`${a.id}-artistBanner`)));
      artistBanner = true;
    }
  }

  const info = [
    '【微信表情开放平台 · 上架信息】（逐项复制粘贴到投稿表单）',
    '',
    `表情名称：${a.name}`,
    `表情介绍：${a.intro}`,
    `版权信息：${a.copyright}`,
    `赞赏引导语：${a.rewardText}`,
    `表情形象：${c.name}`,
    '',
    '表情含义词（按上传顺序，一张一个）：',
    ...ready.map((s, i) => `${String(i + 1).padStart(2, '0')}. ${s.meaning}`),
    '',
    '配套图片：',
    ...(Object.keys(ASSET_SPECS) as AssetKind[]).map(
      (k) => `- ${ASSET_SPECS[k].label}（${ASSET_SPECS[k].w}×${ASSET_SPECS[k].h}）：${a.assets[k] ? '✓ 已包含' : '✗ 缺少'}`,
    ),
    '',
    '【表情形象】（建议创建：以后同一角色的系列都归到这个形象下，粉丝可以一起看到）',
    `形象名称：${c.name}`,
    `形象简介：${a.intro}`,
    '头像：用「表情封面图.png」；聊天页图标：用「聊天面板图标.png」',
    '',
    '【艺术家资料】（开通赞赏的前提，需要先审核通过）',
    '艺术家名称（≤10 字）：自己填，建议和版权信息一致',
    '艺术家介绍（≤80 字）：自己填',
    `头像（640×640，≤500KB）：${artistAvatar ? '可用「艺术家头像.png」（角色头像）；平台建议用真人头像，两者都可以' : '平台建议用真人头像'}`,
    `主页横幅（750×400，≤80KB）：${artistBanner ? '用「艺术家主页横幅.jpg」' : '缺少（先做详情页横幅）'}`,
    '',
    '【AI 生成声明】（按《人工智能生成合成内容标识办法》和微信 2025-08-31 的公告，发布 AI 生成内容要主动声明）',
    '- 投稿页如果有「AI 生成」或内容声明的选项，请如实勾选',
    '- 建议在表情介绍里加上「AI辅助创作」几个字（介绍限 80 字，注意别超）',
    '- 这个文件夹里的图片已经在文件元数据里写入了 AI 生成的隐式标识，请不要用工具删除',
    '- 角色由你自己原创设计、每张由你人工挑选和后期修改；不要把别人的形象、真人照片喂给 AI',
  ].join('\r\n');
  fs.writeFileSync(path.join(dir, '上架信息.txt'), '﻿' + info, 'utf8');

  const steps = [
    '【上传步骤】',
    '1. 登录 sticker.weixin.qq.com（第一次需要先注册个人账号，并填写艺术家资料，审核通过后才能开赞赏）',
    '2. 点「提交作品」→「表情专辑」，选择「动态表情」',
    '3. 按编号顺序上传「表情图」文件夹里的 GIF，每张填对应的含义词（见 上架信息.txt）',
    '4. 上传 详情页横幅、表情封面图、聊天面板图标',
    '5. 填写表情名称、介绍、版权信息；第一套选「免费」并开启赞赏，上传赞赏引导图和致谢图、填写引导语',
    '6. 可以在「表情形象」里创建角色，把这套作品加入形象合集（之后的系列都放进去）',
    '7. 提交后等审核结果；被驳回时按审核意见只改对应的那几张或素材，再重新提交',
    '',
    '注意：付费表情需要先有一套已上架作品 + 近 3 个月无违规；同一套表情不能再投到其他平台。',
  ].join('\r\n');
  fs.writeFileSync(path.join(dir, '上传步骤.txt'), '﻿' + steps, 'utf8');

  const zip = `${dir}.zip`;
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(zip);
    const ar = new ZipArchive({ zlib: { level: 6 } });
    out.on('close', () => resolve());
    ar.on('error', reject);
    ar.pipe(out);
    ar.directory(dir, path.basename(dir));
    ar.finalize();
  });
  return { dir, zip };
}
