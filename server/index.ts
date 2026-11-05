import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { budgetStatus, estimateJobCny, resetSpend } from './budget';
import { exportKit } from './export/kit';
import { testProvider } from './generators/cnProviders';
import { ASSET_SPECS } from './pipeline/assets';
import { isProviderId, PROVIDER_IDS } from './providerInfo';
import { cancelJob, clearFinished, paused, resume, retryJob } from './queue';
import {
  addManualCandidate,
  aiCharacter,
  aiStickerIdeas,
  checkAlbum,
  createAlbum,
  createCharacter,
  enqueueAsset,
  enqueueCharacterJob,
  enqueueStickers,
  getPreset,
  listPresets,
  processCandidate,
  setAsset,
  setReferenceFromBuffer,
  stickerPrompt,
  updateAlbum,
  updateCharacter,
} from './service';
import { assetPrompt, conceptPrompt, referencePrompt } from './prompt/buildPrompt';
import { DATA, EXPORTS, FILES, HttpError, ROOT, absPath, db, deepMerge, getAlbum, getApiKey, getCharacter, getSticker, keyHint, now, readFile, save, setApiKey } from './store';
import type { AssetKind } from './types';

const app = express();
app.use(express.json({ limit: '2mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });

app.use('/files', express.static(FILES, { maxAge: 0 }));

const r = express.Router();
// Express 5 的 req.params 类型是 string | string[]，这里统一按字符串取
type P = Record<string, string>;

// ---- 状态 / 设置 ----
r.get('/status', (_req, res) => {
  const providers = Object.fromEntries(
    PROVIDER_IDS.map((p) => {
      const k = getApiKey(p);
      return [p, { hasKey: !!k, keyHint: keyHint(k), paused: paused[p] ?? '', hasChat: !!db.settings.providers[p].chatModel }];
    }),
  );
  res.json({ agreed: !!db.settings.agreedAt, dataDir: DATA, providers, budget: budgetStatus() });
});
r.get('/settings', (_req, res) => res.json(db.settings));
r.put('/settings', (req: Request<P>, res) => {
  const { agreedAt: _ignored, ...patch } = req.body ?? {};
  db.settings = deepMerge(db.settings, patch);
  for (const p of PROVIDER_IDS) resume(p); // 改了设置（比如换了模型名、调了预算）就让暂停的队列再试一次
  save();
  res.json(db.settings);
});
r.put('/secrets', (req: Request<P>, res) => {
  const p = req.body.provider;
  if (!isProviderId(p)) throw new HttpError(400, '不认识的平台');
  setApiKey(String(req.body.key ?? ''), p);
  resume(p);
  res.json({ ok: true });
});
r.post('/providers/:id/test', async (req: Request<P>, res) => {
  const p = req.params.id;
  if (!isProviderId(p)) throw new HttpError(400, '不认识的平台');
  res.json(await testProvider({ provider: p, cfg: db.settings.providers[p], key: getApiKey(p) ?? '' }));
});
r.post('/setup/agree', (_req, res) => {
  db.settings.agreedAt = now();
  save();
  res.json({ ok: true });
});
r.get('/spend-cny', (_req, res) => res.json(db.spendCny));
r.post('/spend/reset', (_req, res) => {
  resetSpend();
  for (const p of PROVIDER_IDS) resume(p); // 因为预算暂停的队列可以继续了
  res.json({ ok: true });
});

// ---- AI 帮我想 ----
r.post('/ai/character', async (req: Request<P>, res) => res.json(await aiCharacter(String(req.body.idea ?? ''))));
r.post('/albums/:id/ai-ideas', async (req: Request<P>, res) =>
  res.json(await aiStickerIdeas(req.params.id, String(req.body.theme ?? ''), Number(req.body.count) || 8)),
);

// ---- 预设 ----
r.get('/presets', (_req, res) => res.json(listPresets()));
r.get('/presets/:id', (req: Request<P>, res) => res.json(getPreset(req.params.id)));

// ---- 角色 ----
r.get('/characters', (_req, res) => res.json(db.characters));
r.post('/characters', (req: Request<P>, res) => res.json(createCharacter(req.body.name, req.body.spec)));
r.get('/characters/:id', (req: Request<P>, res) => res.json(getCharacter(req.params.id)));
r.put('/characters/:id', (req: Request<P>, res) => res.json(updateCharacter(req.params.id, req.body)));
r.post('/characters/:id/jobs', (req: Request<P>, res) => {
  const { kind, backend, count } = req.body;
  resume(backend);
  res.json(enqueueCharacterJob(req.params.id, kind, backend, count));
});
r.get('/characters/:id/prompt/:kind', (req: Request<P>, res) => {
  const c = getCharacter(req.params.id);
  const bg = db.settings.bgColor;
  res.json({ prompt: req.params.kind === 'concept' ? conceptPrompt(c.name, c.dna, bg) : referencePrompt(c.dna, false, bg) });
});
r.post('/characters/:id/reference', upload.single('file'), async (req: Request<P>, res) => {
  if (!req.file) throw new HttpError(400, '没有收到文件');
  res.json(await setReferenceFromBuffer(getCharacter(req.params.id), req.file.buffer));
});
r.post('/characters/:id/reference-from-concept', async (req: Request<P>, res) => {
  const c = getCharacter(req.params.id);
  res.json(await setReferenceFromBuffer(c, readFile(req.body.path)));
});
/** 删除角色：连同它的专辑、任务和所有图片文件 */
r.delete('/characters/:id', (req: Request<P>, res) => {
  const c = getCharacter(req.params.id);
  const albums = db.albums.filter((a) => a.characterId === c.id);
  for (const a of albums) fs.rmSync(path.join(FILES, 'albums', a.id), { recursive: true, force: true });
  fs.rmSync(path.join(FILES, 'characters', c.id), { recursive: true, force: true });
  const ids = new Set(albums.map((a) => a.id));
  db.albums = db.albums.filter((a) => !ids.has(a.id));
  db.jobs = db.jobs.filter((j) => j.status === 'running' || (j.characterId !== c.id && !ids.has(j.albumId ?? '')));
  db.characters = db.characters.filter((x) => x.id !== c.id);
  save();
  res.json({ ok: true, albums: albums.length });
});
/** 删除一张概念图 */
r.post('/characters/:id/concepts/delete', (req: Request<P>, res) => {
  const c = getCharacter(req.params.id);
  const rel = String(req.body.path ?? '');
  if (!c.concepts.includes(rel)) throw new HttpError(404, '找不到这张概念图');
  c.concepts = c.concepts.filter((p) => p !== rel);
  fs.rmSync(absPath(rel), { force: true });
  save();
  res.json(c);
});
r.post('/characters/:id/concepts', upload.single('file'), (req: Request<P>, res) => {
  if (!req.file) throw new HttpError(400, '没有收到文件');
  const c = getCharacter(req.params.id);
  const rel = `characters/${c.id}/concept_upload_${Date.now()}${path.extname(req.file.originalname) || '.png'}`;
  fs.mkdirSync(path.join(FILES, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(FILES, rel), req.file.buffer);
  c.concepts.push(rel);
  save();
  res.json(c);
});

// ---- 专辑 ----
r.get('/albums', (_req, res) => res.json(db.albums));
r.post('/albums', (req: Request<P>, res) => res.json(createAlbum(req.body.characterId, req.body.presetId)));
r.get('/albums/:id', (req: Request<P>, res) => res.json(getAlbum(req.params.id)));
r.put('/albums/:id', (req: Request<P>, res) => res.json(updateAlbum(req.params.id, req.body)));
r.delete('/albums/:id', (req: Request<P>, res) => {
  const a = getAlbum(req.params.id);
  db.albums = db.albums.filter((x) => x.id !== a.id);
  db.jobs = db.jobs.filter((j) => j.albumId !== a.id || j.status === 'running');
  fs.rmSync(path.join(FILES, 'albums', a.id), { recursive: true, force: true });
  save();
  res.json({ ok: true });
});
r.get('/albums/:id/check', async (req: Request<P>, res) => res.json(await checkAlbum(req.params.id)));
r.post('/albums/:id/generate', (req: Request<P>, res) => {
  resume(req.body.backend);
  res.json(enqueueStickers({ albumId: req.params.id, ...req.body }));
});
r.post('/albums/:id/estimate', (req: Request<P>, res) => {
  const { stickerIds, backend, variants } = req.body;
  const per = estimateJobCny({ kind: 'sticker', backend } as any);
  res.json({ perJob: per, total: per * stickerIds.length * Math.max(1, variants), budget: budgetStatus() });
});
r.get('/albums/:id/stickers/:sid/prompt', (req: Request<P>, res) => {
  const a = getAlbum(req.params.id);
  res.json({ prompt: stickerPrompt(a, getSticker(a, req.params.sid)) });
});
r.post('/albums/:id/stickers/:sid/upload', upload.single('file'), async (req: Request<P>, res) => {
  if (!req.file) throw new HttpError(400, '没有收到文件');
  res.json(await addManualCandidate(req.params.id, req.params.sid, req.file.buffer, req.file.originalname, (req.body.mode as any) ?? 'sprite'));
});
r.post('/albums/:id/stickers/:sid/candidates/:cid/process', async (req: Request<P>, res) => {
  const a = getAlbum(req.params.id);
  const st = getSticker(a, req.params.sid);
  const cand = st.candidates.find((c) => c.id === req.params.cid);
  if (!cand) throw new HttpError(404, '找不到这个候选');
  res.json(await processCandidate(a, st, cand, req.body));
});
r.post('/albums/:id/stickers/:sid/select', (req: Request<P>, res) => {
  const a = getAlbum(req.params.id);
  const st = getSticker(a, req.params.sid);
  st.selectedId = req.body.candidateId;
  save();
  res.json(st);
});
r.delete('/albums/:id/stickers/:sid/candidates/:cid', (req: Request<P>, res) => {
  const a = getAlbum(req.params.id);
  const st = getSticker(a, req.params.sid);
  const gone = st.candidates.find((c) => c.id === req.params.cid);
  st.candidates = st.candidates.filter((c) => c.id !== req.params.cid);
  if (st.selectedId === req.params.cid) st.selectedId = st.candidates.find((c) => c.processedPath)?.id;
  // 图片文件也删掉，不然越积越多
  for (const rel of [gone?.rawPath, gone?.processedPath]) if (rel) fs.rmSync(absPath(rel), { force: true });
  save();
  res.json(st);
});

// ---- 配套图片 ----
r.get('/asset-specs', (_req, res) => res.json(ASSET_SPECS));
r.get('/albums/:id/assets/:kind/prompt', (req: Request<P>, res) => {
  const a = getAlbum(req.params.id);
  res.json({ prompt: assetPrompt(req.params.kind as AssetKind, getCharacter(a.characterId).dna, db.settings.bgColor) });
});
r.post('/albums/:id/assets/:kind/upload', upload.single('file'), async (req: Request<P>, res) => {
  if (!req.file) throw new HttpError(400, '没有收到文件');
  res.json(await setAsset(getAlbum(req.params.id), req.params.kind as AssetKind, req.file.buffer, { headRatio: Number(req.body.headRatio) || undefined }));
});
r.post('/albums/:id/assets/:kind/from-reference', async (req: Request<P>, res) => {
  const a = getAlbum(req.params.id);
  const c = getCharacter(a.characterId);
  if (!c.referencePng) throw new HttpError(400, '角色还没有参考图');
  res.json(await setAsset(a, req.params.kind as AssetKind, readFile(c.referencePng), { headRatio: Number(req.body.headRatio) || undefined }));
});
r.post('/albums/:id/assets/:kind/from-sticker', async (req: Request<P>, res) => {
  const a = getAlbum(req.params.id);
  const st = getSticker(a, req.body.stickerId);
  const cand = st.candidates.find((c) => c.id === st.selectedId);
  if (!cand) throw new HttpError(400, '这张表情还没有选定成品');
  res.json(await setAsset(a, req.params.kind as AssetKind, readFile(cand.rawPath)));
});
/** 删除一张配套图片 */
r.delete('/albums/:id/assets/:kind', (req: Request<P>, res) => {
  const a = getAlbum(req.params.id);
  const kind = req.params.kind as AssetKind;
  const rel = a.assets[kind];
  if (rel) fs.rmSync(absPath(rel), { force: true });
  delete a.assets[kind];
  save();
  res.json(a);
});
r.post('/albums/:id/assets/:kind/generate', (req: Request<P>, res) => {
  resume(req.body.backend);
  res.json(enqueueAsset(req.params.id, req.params.kind as AssetKind, req.body.backend));
});

// ---- 导出 ----
r.post('/albums/:id/export', async (req: Request<P>, res) => {
  const check = await checkAlbum(req.params.id);
  if (!check.ok && !req.body.force) throw new HttpError(400, '还有不符合微信规范的项目，先在检查清单里处理');
  const out = await exportKit(req.params.id);
  res.json({ ...out, zipName: path.basename(out.zip) });
});
r.get('/exports/:name', (req: Request<P>, res) => {
  const p = path.join(EXPORTS, path.basename(req.params.name));
  if (!fs.existsSync(p)) throw new HttpError(404, '文件不存在');
  res.download(p);
});
r.post('/open-folder', (req: Request<P>, res) => {
  const p = path.resolve(String(req.body.path ?? ''));
  if (p !== DATA && !p.startsWith(DATA + path.sep)) throw new HttpError(400, '只能打开数据目录');
  execFile('explorer.exe', [p]);
  res.json({ ok: true });
});

// ---- 任务 ----
r.get('/jobs', (req: Request<P>, res) => {
  const { albumId, characterId } = req.query;
  res.json(
    db.jobs
      .filter((j) => (!albumId || j.albumId === albumId) && (!characterId || j.characterId === characterId))
      .slice(-300)
      .map((j) => ({ ...j, estimateCny: estimateJobCny(j) })),
  );
});
r.post('/jobs/:id/retry', (req: Request<P>, res) => res.json(retryJob(req.params.id)));
r.post('/jobs/:id/cancel', (req: Request<P>, res) => res.json(cancelJob(req.params.id)));
r.post('/jobs/clear', (_req, res) => {
  clearFinished();
  res.json({ ok: true });
});

app.use('/api', r);

// 生产模式：托管前端构建产物
const dist = path.join(ROOT, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|files).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : (err.status ?? 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message ?? String(err) });
});

// 不读 PORT：预览/托管环境常把 PORT 设成前端端口，会撞车
const PORT = Number(process.env.API_PORT ?? 8787);
// 默认只监听本机 127.0.0.1：接口没有登录认证，绝不能让局域网里的其他人访问（也不会弹 Windows 防火墙提示）。
// 确实需要对外监听时，自己设置 STUDIO_HOST（比如 0.0.0.0），后果自负。
const HOST = process.env.STUDIO_HOST || '127.0.0.1';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
const onListen = (err?: Error) => {
  if (err) {
    console.error(`后端启动失败（${HOST}:${PORT}）：${err.message}`);
    process.exit(1);
  }
  console.log(`表情包工坊后端已启动：http://${HOST.includes(':') ? `[${HOST}]` : HOST}:${PORT}`);
  if (!LOOPBACK.has(HOST)) console.warn(`⚠ 后端正在监听 ${HOST}，接口没有认证，同一网络里的其他人可以读取你的作品、使用你的 API Key 花钱。不需要的话请去掉 STUDIO_HOST。`);
};
app.listen(PORT, HOST, onListen);
