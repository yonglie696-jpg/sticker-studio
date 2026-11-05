// 端到端冒烟测试：不花钱。用程序画的假精灵图走完 参考图→专辑→导入 8 张候选→配套图→检查→导出→读回 AI 隐式标识
// 用法：先 npm run dev，再 npm run smoke
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { readAigc } from '../server/pipeline/aigcLabel';

const BASE = `http://127.0.0.1:${process.env.API_PORT ?? 8787}/api`;

async function call(p: string, init?: RequestInit & { json?: unknown }) {
  const res = await fetch(BASE + p, {
    ...init,
    method: init?.method ?? (init?.json || init?.body ? 'POST' : 'GET'),
    headers: init?.json ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.json ? JSON.stringify(init.json) : init?.body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${p} → ${res.status} ${data.error}`);
  return data;
}
const form = (buf: Buffer, name: string, extra: Record<string, string> = {}) => {
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(buf)]), name);
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return fd;
};

/** 画一张 3×3 精灵图：白底上一个带粗描边的团子，每格上下弹一点 */
async function fakeSprite(seed: number) {
  const S = 1536;
  const cell = S / 3;
  const hue = (seed * 47) % 360;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}"><rect width="100%" height="100%" fill="#FFFFFF"/>`;
  for (let i = 0; i < 9; i++) {
    const cx = (i % 3) * cell + cell / 2;
    const cy = Math.floor(i / 3) * cell + cell / 2 - 30 + Math.sin((i / 9) * Math.PI * 2) * 25;
    svg += `<ellipse cx="${cx}" cy="${cy}" rx="${150 + (i % 2) * 8}" ry="${140 - (i % 2) * 8}" fill="hsl(${hue},70%,80%)" stroke="#5A3A2E" stroke-width="14"/>`;
    svg += `<circle cx="${cx - 45}" cy="${cy - 10}" r="14" fill="#5A3A2E"/><circle cx="${cx + 45}" cy="${cy - 10}" r="14" fill="#5A3A2E"/>`;
  }
  return sharp(Buffer.from(`${svg}</svg>`)).png().toBuffer();
}

const status = await call('/status');
if (!status.agreed) await call('/setup/agree', { json: {} });

const c = await call('/characters', { json: { name: '测试团子', spec: { species: '圆滚滚的小团子（原创形象）', body: '2 头身', colors: '粉 #F8C8D8，描边 #5A3A2E', features: '豆豆眼', accessories: '', style: '扁平贴纸风', personality: '元气' } } });
const first = await fakeSprite(0);
const cellBuf = await sharp(first).extract({ left: 512, top: 512, width: 512, height: 512 }).png().toBuffer();
await call(`/characters/${c.id}/reference`, { body: form(cellBuf, 'ref.png') });

const album = await call('/albums', { json: { characterId: c.id, presetId: 'daily-reply' } });
const keep = album.stickers.slice(0, 8);
await call(`/albums/${album.id}`, { method: 'PUT', json: { stickers: keep } });
for (const [i, st] of keep.entries()) {
  const cand = await call(`/albums/${album.id}/stickers/${st.id}/upload`, { body: form(await fakeSprite(i), 'sprite.png', { mode: 'sprite' }) });
  if (cand.error) throw new Error(cand.error);
}
for (const k of ['cover', 'icon']) await call(`/albums/${album.id}/assets/${k}/from-reference`, { json: { headRatio: 1 } });
await call(`/albums/${album.id}/assets/banner/upload`, { body: form(first, 'banner.png') });
for (const k of ['rewardGuide', 'rewardThanks']) await call(`/albums/${album.id}/assets/${k}/from-sticker`, { json: { stickerId: keep[0].id } });
await call(`/albums/${album.id}`, { method: 'PUT', json: { name: '测试团子', intro: '一只元气的小团子。AI辅助创作。', copyright: '测试工作室', rewardText: '给团子买杯奶茶吧' } });

const check = await call(`/albums/${album.id}/check`);
console.log('检查：ok =', check.ok, '已选定', check.ready, '张');
for (const i of check.issues.filter((x: any) => x.level === 'error')) console.log(`  [必须改] ${i.field}：${i.msg}`);

const out = await call(`/albums/${album.id}/export`, { json: { force: !check.ok } });
console.log('导出到', out.dir);
let labeled = 0;
let total = 0;
for (const f of fs.readdirSync(out.dir, { recursive: true }) as string[]) {
  if (!/\.(gif|png|jpe?g)$/i.test(f)) continue;
  total++;
  if (readAigc(fs.readFileSync(path.join(out.dir, f)))?.Label === '1') labeled++;
  else console.log('  缺少隐式标识：', f);
}
console.log(`隐式标识：${labeled}/${total} 个图片文件`);
const info = fs.readFileSync(path.join(out.dir, '上架信息.txt'), 'utf8');
console.log('上架信息里有 AI 声明：', info.includes('【AI 生成声明】'));
if (!check.ok || labeled !== total || !info.includes('【AI 生成声明】')) process.exit(1);
