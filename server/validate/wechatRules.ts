import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { RES } from '../store';
import type { CheckIssue } from '../types';

/** 微信表情开放平台《表情制作规范》数值（2026-11 官网原文） */
export const WECHAT = {
  stickerSize: 240,
  stickerMaxBytes: 500 * 1024,
  minStickers: 8,
  maxStickers: 24,
  nameMax: 8,
  nameBest: 5,
  introMax: 80,
  copyrightMax: 10,
  meaningMax: 4,
  rewardTextMin: 5,
  rewardTextMax: 15,
};

export async function inspectGif(buf: Buffer) {
  const meta = await sharp(buf, { animated: true }).metadata();
  const frames = meta.pages ?? 1;
  const delays = meta.delay ?? [];
  // NETSCAPE2.0 扩展块 + loop=0 才是无限循环
  const hasNetscape = buf.includes(Buffer.from('NETSCAPE2.0'));
  const loop = hasNetscape && (meta.loop === 0 || meta.loop === undefined);
  return {
    format: meta.format,
    width: meta.width ?? 0,
    height: meta.pageHeight ?? meta.height ?? 0,
    frames,
    loop,
    durationMs: delays.reduce((a, b) => a + b, 0),
    bytes: buf.length,
  };
}

export async function checkStickerFile(buf: Buffer): Promise<CheckIssue[]> {
  const g = await inspectGif(buf);
  const out: CheckIssue[] = [];
  if (g.format !== 'gif') out.push({ level: 'error', field: '格式', msg: '动态表情须为 GIF' });
  if (g.width !== WECHAT.stickerSize || g.height !== WECHAT.stickerSize)
    out.push({ level: 'error', field: '尺寸', msg: `须为 240×240，当前 ${g.width}×${g.height}` });
  if (g.bytes > WECHAT.stickerMaxBytes) out.push({ level: 'error', field: '大小', msg: `超过 500KB（${(g.bytes / 1024).toFixed(0)}KB）` });
  if (g.frames < 2) out.push({ level: 'error', field: '动态', msg: '只有 1 帧，不是动态表情' });
  if (!g.loop) out.push({ level: 'error', field: '循环', msg: '未设置无限循环播放' });
  return out;
}

// ---------------- 文案 ----------------

export const charLen = (s: string) => Array.from(s).length;
const PUNCT = /[\p{P}\p{S}]/u;
const SPACE = /\s/;
const EMOJI = /\p{Extended_Pictographic}/u;

interface Blocklist {
  ipNames: string[];
  words: string[];
  cautions: string[];
  patterns: { re: string; why: string }[];
}
let blocklist: Blocklist | null = null;
export function getBlocklist(): Blocklist {
  if (!blocklist) {
    const p = path.join(RES, 'presets', 'blocklist.json');
    blocklist = JSON.parse(fs.readFileSync(p, 'utf8')) as Blocklist;
  }
  return blocklist;
}

/** 敏感/违规内容扫描：知名 IP 名、广告推广、联系方式、禁用元素 */
export function scanText(text: string, field: string): CheckIssue[] {
  const bl = getBlocklist();
  const out: CheckIssue[] = [];
  const lower = text.toLowerCase();
  for (const n of bl.ipNames) if (lower.includes(n.toLowerCase())) out.push({ level: 'error', field, msg: `含已有 IP「${n}」，会被判侵权/同人` });
  for (const w of bl.words) if (lower.includes(w.toLowerCase())) out.push({ level: 'error', field, msg: `含审核禁用内容「${w}」` });
  for (const w of bl.cautions)
    if (lower.includes(w.toLowerCase())) out.push({ level: 'warn', field, msg: `含「${w}」，审核可能判为敏感/推广，请人工确认` });
  for (const p of bl.patterns) if (new RegExp(p.re, 'iu').test(text)) out.push({ level: 'error', field, msg: p.why });
  return out;
}

function lenRule(v: string, field: string, max: number, min = 1): CheckIssue[] {
  const n = charLen(v.trim());
  if (n < min) return [{ level: 'error', field, msg: min > 1 ? `至少 ${min} 个字` : '不能为空' }];
  if (n > max) return [{ level: 'error', field, msg: `不超过 ${max} 个字（当前 ${n}）` }];
  return [];
}

export function checkAlbumName(v: string): CheckIssue[] {
  const f = '表情名称';
  const out = lenRule(v, f, WECHAT.nameMax);
  if (PUNCT.test(v)) out.push({ level: 'error', field: f, msg: '不能包含标点符号或特殊字符' });
  if (SPACE.test(v)) out.push({ level: 'error', field: f, msg: '中文名称不要有空格' });
  if (charLen(v) > WECHAT.nameBest && charLen(v) <= WECHAT.nameMax) out.push({ level: 'warn', field: f, msg: '5 个字以内显示效果最佳' });
  return [...out, ...scanText(v, f)];
}
export function checkIntro(v: string) {
  return [...lenRule(v, '表情介绍', WECHAT.introMax), ...scanText(v, '表情介绍')];
}
export function checkCopyright(v: string) {
  return [...lenRule(v, '版权信息', WECHAT.copyrightMax), ...scanText(v, '版权信息')];
}
export function checkRewardText(v: string): CheckIssue[] {
  if (!v.trim()) return [{ level: 'warn', field: '赞赏引导语', msg: '不填就不能开通赞赏' }];
  return [...lenRule(v, '赞赏引导语', WECHAT.rewardTextMax, WECHAT.rewardTextMin), ...scanText(v, '赞赏引导语')];
}

export function checkMeaning(v: string, others: string[]): CheckIssue[] {
  const f = `含义词「${v}」`;
  const out = lenRule(v, f, WECHAT.meaningMax);
  if (PUNCT.test(v)) out.push({ level: 'warn', field: f, msg: '尽量不要带标点符号' });
  if (EMOJI.test(v)) out.push({ level: 'error', field: f, msg: '不能使用表情符号' });
  if (/[a-z]/i.test(v)) out.push({ level: 'warn', field: f, msg: '建议用普通话中文' });
  if (others.includes(v.trim())) out.push({ level: 'error', field: f, msg: '同一套表情里含义词不能重复' });
  return [...out, ...scanText(v, f)];
}

export function checkCaption(v: string, field: string): CheckIssue[] {
  const out: CheckIssue[] = [];
  if (charLen(v) > 6) out.push({ level: 'warn', field, msg: '画面字超过 6 个，240px 下会偏小' });
  if (EMOJI.test(v)) out.push({ level: 'error', field, msg: '画面字不要用 emoji（用 emoji 二创不能开赞赏）' });
  return [...out, ...scanText(v, field)];
}
