import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { assertAffordable, recordSpendCny } from './budget';
import { ProviderError, extractJson, providerChat, providerImage, type ProviderCall } from './generators/cnProviders';
import { PROVIDER_IDS, PROVIDER_INFO, isProviderId } from './providerInfo';
import { ASSET_SPECS, inspectAsset, processAsset } from './pipeline/assets';
import { keyBackground } from './pipeline/chromaKey';
import { cropFit } from './pipeline/cropFit';
import { decodeAnimation } from './pipeline/frames';
import { processSticker } from './pipeline/process';
import { assetGenSize, assetPrompt, buildDna, conceptPrompt, referencePrompt, stickerSpritePrompt } from './prompt/buildPrompt';
import {
  DEFAULT_PROCESS,
  RES,
  absPath,
  db,
  flush,
  getAlbum,
  getApiKey,
  getCharacter,
  getSticker,
  httpError,
  newId,
  now,
  readFile,
  save,
  writeFile,
} from './store';
import type {
  Album,
  AssetKind,
  Candidate,
  Character,
  CharacterSpec,
  CheckIssue,
  GenBackend,
  GenMode,
  Job,
  Preset,
  ProcessSettings,
  ProviderId,
  StickerItem,
} from './types';
import { SIMILAR_THRESHOLD, animHash, hashDistance } from './validate/similarity';
import {
  WECHAT,
  checkAlbumName,
  checkCaption,
  checkCopyright,
  checkIntro,
  checkMeaning,
  checkRewardText,
  checkStickerFile,
  charLen,
  getBlocklist,
  scanText,
} from './validate/wechatRules';

// ---------------- 生成源 ----------------
/** 只接受国内平台，并且要先填好 Key */
export function assertBackendAllowed(backend: string): asserts backend is GenBackend {
  if (!isProviderId(backend)) throw httpError(400, `不支持的生成源：${backend}`);
  if (!getApiKey(backend)) throw httpError(400, `还没有填${PROVIDER_INFO[backend].label}的 Key（在「设置」或「连接模型」里填），或者改用手动模式`);
}

/** 生成时要求的纯色背景（后期自动抠掉） */
const bg = () => db.settings.bgColor;

function providerCall(p: ProviderId): ProviderCall {
  const key = getApiKey(p);
  if (!key) throw new ProviderError(`还没有填${PROVIDER_INFO[p].label}的 Key（在「设置」或「连接模型」里填）`, 401);
  return { provider: p, cfg: db.settings.providers[p], key };
}

/** 调用平台出一张图，并按张记账（失败不收费，也不记） */
async function providerGen(job: Job, prompt: string, refs: Buffer[], width: number, height: number) {
  const { buf } = await providerImage(providerCall(job.backend), { prompt, refImages: refs, width, height });
  job.costCny = recordSpendCny(job);
  return { buf, costCny: job.costCny };
}

/** 根据文件头判断扩展名（方舟默认返回 JPEG） */
function extOf(buf: Buffer) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.subarray(0, 3).toString('latin1') === 'GIF') return 'gif';
  if (buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return 'png';
}

const parseSize = (s: string) => {
  const [w, h] = s.split('x').map(Number);
  return { w, h };
};

// ---------------- 预设 ----------------
const PRESET_DIR = path.join(RES, 'presets');
export function listPresets(): Preset[] {
  return fs
    .readdirSync(PRESET_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'blocklist.json')
    .map((f) => JSON.parse(fs.readFileSync(path.join(PRESET_DIR, f), 'utf8')) as Preset);
}
export function getPreset(id: string): Preset {
  const p = listPresets().find((x) => x.id === id);
  if (!p) throw httpError(404, '找不到这个选题预设');
  return p;
}

// ---------------- 角色 ----------------
export function createCharacter(name: string, spec: CharacterSpec): Character {
  const c: Character = { id: newId(), name, spec, dna: buildDna(name, spec), locked: false, concepts: [], createdAt: now() };
  db.characters.push(c);
  save();
  return c;
}

export function updateCharacter(id: string, patch: Partial<Character>): Character {
  const c = getCharacter(id);
  if (patch.name !== undefined) c.name = patch.name;
  if (patch.spec) c.spec = { ...c.spec, ...patch.spec };
  if (patch.locked !== undefined) c.locked = patch.locked;
  // 锁定前 DNA 跟着设定自动更新；锁定后允许手动微调 DNA 文本
  if (patch.dna !== undefined && c.locked) c.dna = patch.dna;
  else if (!c.locked) c.dna = buildDna(c.name, c.spec);
  save();
  return c;
}

export function ipHits(text: string): string[] {
  const lower = text.toLowerCase();
  return getBlocklist().ipNames.filter((n) => lower.includes(n.toLowerCase()));
}

async function normalizeReference(buf: Buffer): Promise<Buffer> {
  const a = await decodeAnimation(buf);
  const one = { ...a, frames: [a.frames[0]], delays: [100] };
  const key = keyBackground(one, 'flood', 48);
  const size = 1024;
  const fitted = await cropFit(one, { size, padding: 4, reserveBottom: 0, transparent: true, bg: key.bg });
  return sharp(Buffer.from(fitted.frames[0].buffer), { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
}

export async function setReferenceFromBuffer(c: Character, buf: Buffer) {
  const old = c.referencePng;
  c.referencePng = writeFile(`characters/${c.id}/reference_${Date.now()}.png`, await normalizeReference(buf));
  if (old) fs.rmSync(absPath(old), { force: true });
  save();
  return c;
}

// ---------------- 专辑 ----------------
export function createAlbum(characterId: string, presetId: string): Album {
  const c = getCharacter(characterId);
  const p = getPreset(presetId);
  const a: Album = {
    id: newId(),
    name: c.name,
    intro: '',
    copyright: '',
    rewardText: (p.rewardTextIdeas[0] ?? '').replace('{name}', c.name),
    characterId,
    presetId,
    stickers: p.stickers.filter((s) => s.default).map((s) => newSticker(s)),
    assets: {},
    createdAt: now(),
    updatedAt: now(),
  };
  db.albums.push(a);
  save();
  return a;
}

export function newSticker(s: Partial<StickerItem>): StickerItem {
  return {
    id: newId(),
    meaning: s.meaning ?? '',
    caption: s.caption ?? s.meaning ?? '',
    action: s.action ?? '',
    emotion: s.emotion ?? '',
    scene: s.scene ?? '',
    group: s.group ?? '自定义',
    textAnim: s.textAnim ?? 'bounce',
    candidates: [],
  };
}

export function updateAlbum(id: string, patch: Partial<Album>): Album {
  const a = getAlbum(id);
  for (const k of ['name', 'intro', 'copyright', 'rewardText', 'characterId'] as const) if (patch[k] !== undefined) (a as any)[k] = patch[k];
  if (patch.stickers) {
    // 允许增删改排序；已有候选保留
    a.stickers = patch.stickers.map((s) => {
      const old = a.stickers.find((x) => x.id === s.id);
      const base = old ?? newSticker(s);
      // 候选和选中状态只由服务端维护，避免前端旧数据覆盖
      return { ...base, ...s, candidates: old?.candidates ?? [], selectedId: old?.selectedId };
    });
  }
  a.updatedAt = now();
  save();
  return a;
}

// ---------------- 生成任务 ----------------
export function defaultProcess(st: StickerItem, mode: GenMode): ProcessSettings {
  return { ...DEFAULT_PROCESS, caption: st.caption, textAnim: st.textAnim, spriteGrid: mode === 'sprite' ? { ...db.settings.spriteGrid } : undefined };
}

/** 生成和手动复制用的都是精灵图提示词 */
export function stickerPrompt(album: Album, st: StickerItem): string {
  const c = getCharacter(album.characterId);
  return stickerSpritePrompt(c, st, db.settings.spriteGrid, !!c.referencePng, true, bg());
}

export function enqueueStickers(o: { albumId: string; stickerIds: string[]; backend: GenBackend; variants: number }): Job[] {
  const album = getAlbum(o.albumId);
  assertBackendAllowed(o.backend);
  const c = getCharacter(album.characterId);
  const hits = ipHits(c.dna);
  if (hits.length) throw httpError(400, `角色设定里出现已有 IP：${hits.join('、')}，请改掉`);
  const jobs: Job[] = [];
  for (const sid of o.stickerIds) {
    const st = getSticker(album, sid);
    for (let v = 0; v < Math.max(1, Math.min(4, o.variants)); v++) {
      jobs.push({
        id: newId(),
        kind: 'sticker',
        backend: o.backend,
        mode: 'sprite',
        albumId: album.id,
        stickerId: st.id,
        status: 'queued',
        prompt: stickerPrompt(album, st),
        createdAt: now(),
      });
    }
  }
  assertAffordable(jobs);
  db.jobs.push(...jobs);
  save();
  return jobs;
}

export function enqueueCharacterJob(characterId: string, kind: 'concept' | 'reference', backend: GenBackend, count = 1) {
  assertBackendAllowed(backend);
  const c = getCharacter(characterId);
  const hits = ipHits(c.dna);
  if (hits.length) throw httpError(400, `角色设定里出现已有 IP：${hits.join('、')}，请改掉`);
  const jobs: Job[] = [];
  for (let i = 0; i < Math.max(1, Math.min(4, count)); i++) {
    jobs.push({
      id: newId(),
      kind,
      backend,
      mode: 'sprite',
      characterId,
      status: 'queued',
      prompt: kind === 'concept' ? conceptPrompt(c.name, c.dna, bg()) : referencePrompt(c.dna, !!c.referencePng, bg()),
      createdAt: now(),
    });
  }
  assertAffordable(jobs);
  db.jobs.push(...jobs);
  save();
  return jobs;
}

export function enqueueAsset(albumId: string, kind: AssetKind, backend: GenBackend) {
  assertBackendAllowed(backend);
  const album = getAlbum(albumId);
  const c = getCharacter(album.characterId);
  const job: Job = {
    id: newId(),
    kind: 'asset',
    backend,
    mode: 'sprite',
    albumId,
    assetKind: kind,
    status: 'queued',
    prompt: assetPrompt(kind, c.dna, bg()),
    createdAt: now(),
  };
  assertAffordable([job]);
  db.jobs.push(job);
  save();
  return job;
}

/** 执行一个任务（由队列调用） */
export async function runJob(job: Job): Promise<void> {
  const s = db.settings;

  if (job.kind === 'sticker') {
    const album = getAlbum(job.albumId!);
    const st = getSticker(album, job.stickerId!);
    const c = getCharacter(album.characterId);
    const size = s.providers[job.backend].size;
    const r = await providerGen(job, job.prompt, c.referencePng ? [readFile(c.referencePng)] : [], size, size);
    const cand: Candidate = {
      id: job.id,
      backend: job.backend,
      mode: job.mode,
      rawPath: writeFile(`albums/${album.id}/${st.id}/${job.id}_raw.${extOf(r.buf)}`, r.buf),
      createdAt: now(),
      prompt: job.prompt,
      costCny: r.costCny,
      settings: defaultProcess(st, job.mode),
    };
    st.candidates.push(cand);
    job.resultPath = cand.rawPath;
    save();
    await processCandidate(album, st, cand);
    return;
  }

  if (job.kind === 'concept' || job.kind === 'reference') {
    const c = getCharacter(job.characterId!);
    // 重做参考图时把现有参考图带上，保持外形延续
    const refs = job.kind === 'reference' && c.referencePng ? [readFile(c.referencePng)] : [];
    const { buf } = await providerGen(job, job.prompt, refs, 1024, 1024);
    if (job.kind === 'concept') {
      const rel = writeFile(`characters/${c.id}/concept_${job.id}.${extOf(buf)}`, buf);
      c.concepts.push(rel);
      job.resultPath = rel;
    } else {
      await setReferenceFromBuffer(c, buf);
      job.resultPath = c.referencePng;
    }
    save();
    return;
  }

  if (job.kind === 'asset') {
    const album = getAlbum(job.albumId!);
    const c = getCharacter(album.characterId);
    const kind = job.assetKind!;
    const { w, h } = parseSize(assetGenSize(kind));
    const { buf } = await providerGen(job, job.prompt, c.referencePng ? [readFile(c.referencePng)] : [], w, h);
    await setAsset(album, kind, buf);
    job.resultPath = album.assets[kind];
    save();
  }
}

export async function processCandidate(album: Album, st: StickerItem, cand: Candidate, patch?: Partial<ProcessSettings>) {
  if (patch) cand.settings = { ...cand.settings, ...patch };
  try {
    const { gif, report } = await processSticker(readFile(cand.rawPath), cand.settings, {
      mode: cand.mode,
      grid: db.settings.spriteGrid,
      spriteFrameMs: db.settings.spriteFrameMs,
      targetBytes: db.settings.targetBytes,
    });
    const old = cand.processedPath;
    cand.processedPath = writeFile(`albums/${album.id}/${st.id}/${cand.id}_${Date.now()}.gif`, gif);
    if (old && old !== cand.processedPath) fs.rmSync(absPath(old), { force: true });
    cand.report = report;
    cand.error = undefined;
    if (!st.selectedId) st.selectedId = cand.id;
  } catch (e: any) {
    cand.error = `后期处理失败：${e.message}`;
  }
  save();
  return cand;
}

export async function addManualCandidate(albumId: string, sid: string, buf: Buffer, filename: string, mode: GenMode) {
  const album = getAlbum(albumId);
  const st = getSticker(album, sid);
  const ext = (path.extname(filename).slice(1) || 'gif').toLowerCase();
  const id = newId();
  const cand: Candidate = {
    id,
    backend: 'manual',
    mode,
    rawPath: writeFile(`albums/${album.id}/${st.id}/${id}_raw.${ext}`, buf),
    createdAt: now(),
    prompt: stickerPrompt(album, st),
    settings: defaultProcess(st, mode),
  };
  st.candidates.push(cand);
  save();
  return processCandidate(album, st, cand);
}

export async function setAsset(album: Album, kind: AssetKind, buf: Buffer, opts?: { headRatio?: number }) {
  const { buf: out, ext } = await processAsset(kind, buf, opts);
  // 删除旧扩展名的文件，避免导出时混入
  const old = album.assets[kind];
  if (old) fs.rmSync(absPath(old), { force: true });
  album.assets[kind] = writeFile(`albums/${album.id}/assets/${kind}_${Date.now()}.${ext}`, out);
  album.updatedAt = now();
  save();
  return album;
}

// ---------------- 规范检查 ----------------
const hashCache = new Map<string, bigint[]>();
async function hashOf(rel: string) {
  const p = absPath(rel);
  const k = `${rel}:${fs.statSync(p).mtimeMs}`;
  if (!hashCache.has(k)) hashCache.set(k, await animHash(fs.readFileSync(p)));
  return hashCache.get(k)!;
}

export function selectedOf(st: StickerItem) {
  return st.candidates.find((c) => c.id === st.selectedId && c.processedPath);
}

export async function checkAlbum(albumId: string) {
  const a = getAlbum(albumId);
  const c = getCharacter(a.characterId);
  const issues: CheckIssue[] = [
    ...checkAlbumName(a.name),
    ...checkIntro(a.intro),
    ...checkCopyright(a.copyright),
    ...checkRewardText(a.rewardText),
  ];
  for (const n of ipHits(c.dna)) issues.push({ level: 'error', field: '角色设定', msg: `出现已有 IP「${n}」` });

  const ready = a.stickers.filter((s) => selectedOf(s));
  if (ready.length < WECHAT.minStickers || ready.length > WECHAT.maxStickers)
    issues.push({ level: 'error', field: '表情数量', msg: `已选定 ${ready.length} 张，须为 8～24 张` });
  for (const s of a.stickers) if (!selectedOf(s)) issues.push({ level: 'warn', field: `「${s.meaning}」`, msg: '还没有选定成品，不会导出' });

  const meanings = ready.map((s) => s.meaning.trim());
  for (const [i, s] of ready.entries()) {
    issues.push(...checkMeaning(s.meaning, meanings.filter((_, j) => j !== i)).filter((x) => !(x.msg.includes('不能重复') && meanings.indexOf(s.meaning.trim()) === i)));
    issues.push(...checkCaption(selectedOf(s)!.settings.caption, `「${s.meaning}」画面字`));
    for (const x of await checkStickerFile(readFile(selectedOf(s)!.processedPath!))) issues.push({ ...x, field: `「${s.meaning}」${x.field}` });
  }

  // 同套差异度
  const hashes = await Promise.all(ready.map((s) => hashOf(selectedOf(s)!.processedPath!)));
  for (let i = 0; i < ready.length; i++)
    for (let j = i + 1; j < ready.length; j++) {
      const d = hashDistance(hashes[i], hashes[j]);
      if (d < SIMILAR_THRESHOLD)
        issues.push({ level: 'warn', field: '差异度', msg: `「${ready[i].meaning}」和「${ready[j].meaning}」画面太像（距离 ${d.toFixed(1)}），微信可能判为差异不足` });
    }

  for (const kind of Object.keys(ASSET_SPECS) as AssetKind[]) {
    const spec = ASSET_SPECS[kind];
    const rel = a.assets[kind];
    const required = kind === 'cover' || kind === 'icon' || kind === 'banner';
    if (!rel) {
      issues.push({ level: required ? 'error' : 'warn', field: spec.label, msg: required ? '还没有制作' : '没有的话不能开通赞赏' });
      continue;
    }
    for (const m of await inspectAsset(kind, readFile(rel), path.extname(rel).slice(1))) issues.push({ level: 'error', field: spec.label, msg: m });
  }
  const costCny = a.stickers.flatMap((s) => s.candidates).reduce((sum, x) => sum + (x.costCny ?? 0), 0);
  return { issues, ready: ready.length, ok: !issues.some((i) => i.level === 'error'), costCny };
}

export function persistNow() {
  flush();
}

// ---------------- AI 帮我想（文字模型） ----------------

/** 选一个能用的文字模型：优先默认平台，其次任何填了 Key 和文字模型的平台 */
function chatCall(): ProviderCall {
  const order = [db.settings.defaultProvider, ...PROVIDER_IDS.filter((p) => p !== db.settings.defaultProvider)];
  const p = order.find((id) => getApiKey(id) && db.settings.providers[id].chatModel);
  if (!p) throw httpError(400, '要用「AI 帮我想」，先在「设置」里给一个平台填好 Key 和文字模型名');
  return providerCall(p);
}

const SPEC_KEYS: (keyof CharacterSpec)[] = ['species', 'body', 'colors', 'features', 'accessories', 'style', 'personality'];

/** 一句话想法 → 原创角色设定（结果仍由用户修改、确认） */
export async function aiCharacter(idea: string): Promise<{ name: string; spec: CharacterSpec; warnings: string[] }> {
  if (!idea.trim()) throw httpError(400, '先写一句你想要的角色，比如“一只爱睡懒觉的橘色小狐狸”');
  const text = await providerChat(chatCall(), [
    {
      role: 'system',
      content: [
        '你是原创微信表情包角色设计师。根据用户的一句话想法，设计一个原创卡通角色，只输出一个 JSON 对象，不要任何解释。',
        '要求：必须原创，不能像任何已有动漫、品牌、吉祥物或真人；2–2.5 头身，圆润，缩小到聊天表情大小也好认；扁平 2D 贴纸风、均匀的深色粗描边；配色写出 hex 色值；有一个固定的小配饰提高辨识度。',
        '字段：name（角色名，2–6 个字，不要和已有 IP 重名），species（形态/物种，末尾注明“原创形象”），body（体型比例），colors（主色、腮红、描边色，带 hex），features（五官与标志特征），accessories（配饰），style（画风），personality（性格，决定动作怎么演）。',
      ].join('\n'),
    },
    { role: 'user', content: idea.trim().slice(0, 200) },
  ]);
  const j = extractJson<Record<string, unknown>>(text);
  const spec = Object.fromEntries(SPEC_KEYS.map((k) => [k, String(j[k] ?? '').trim()])) as unknown as CharacterSpec;
  const name = Array.from(String(j.name ?? '新角色').trim()).slice(0, 8).join('');
  const warnings = [...new Set(ipHits([name, ...Object.values(spec)].join(' ')))].map((n) => `设定里出现了已有 IP「${n}」，请改掉`);
  return { name, spec, warnings };
}

/** 根据主题补充选题（含义词 ≤4 字、不和现有重复、过一遍拦截词表） */
export async function aiStickerIdeas(albumId: string, theme: string, count = 8): Promise<Partial<StickerItem>[]> {
  const album = getAlbum(albumId);
  const c = getCharacter(album.characterId);
  const existing = album.stickers.map((s) => s.meaning.trim()).filter(Boolean);
  const n = Math.max(1, Math.min(12, count));
  const text = await providerChat(chatCall(), [
    {
      role: 'system',
      content: [
        '你是微信表情包策划。为一套动态表情补充选题，只输出一个 JSON 数组，不要任何解释。',
        '每一项字段：meaning（含义词，1–4 个字，聊天里会搜到它），caption（画面上的字，1–6 个字），action（一个具体、夸张、好画的动作，一句话），emotion（情绪，2–4 字），scene（什么时候发），group（分组名，例如 回应确认、开心正向、小情绪、关系互动、日常状态）。',
        '要求：每张只表达一个意思；动作之间差别要大；不要出现联系方式、品牌、低俗、政治、烟酒、金钱相关内容。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `角色：${c.name}，性格：${c.spec.personality || '未填'}。`,
        `主题或方向：${theme.trim() || '日常聊天里最常用的回应和情绪'}。`,
        `已经有的含义词（不要重复）：${existing.join('、') || '无'}。`,
        `给 ${n} 个新选题。`,
      ].join('\n'),
    },
  ]);
  const raw = extractJson<any[]>(text);
  if (!Array.isArray(raw)) throw httpError(502, '模型没有按格式返回，换个说法再试一次');
  const seen = new Set(existing);
  const out: Partial<StickerItem>[] = [];
  for (const x of raw) {
    const meaning = String(x?.meaning ?? '').trim();
    if (!meaning || charLen(meaning) > 4 || seen.has(meaning)) continue;
    const item = {
      meaning,
      caption: Array.from(String(x.caption ?? meaning).trim()).slice(0, 6).join('') || meaning,
      action: String(x.action ?? '').trim(),
      emotion: String(x.emotion ?? '').trim(),
      scene: String(x.scene ?? '').trim(),
      group: String(x.group ?? 'AI 补充').trim() || 'AI 补充',
    };
    const blob = [item.meaning, item.caption, item.action].join(' ');
    if (scanText(blob, 'x').some((i) => i.level === 'error') || ipHits(blob).length) continue;
    seen.add(meaning);
    out.push(item);
  }
  return out;
}
