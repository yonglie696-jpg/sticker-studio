import fs from 'node:fs';
import path from 'node:path';
import { customAlphabet } from 'nanoid';
import { checkKey, cleanKey } from './apiKey';
import type { Album, Character, Job, ProcessSettings, ProviderId, Settings } from './types';

/** 项目根目录（开发时是 server/ 的上一级；打包后是安装目录里的 app，后端代码在 server-dist/） */
export const ROOT = path.resolve(import.meta.dirname, '..');
/** 选题、拦截词表、字体等资源（打包时原样带上 server/presets 和 server/fonts） */
export const RES = path.join(ROOT, 'server');
/** 数据目录：默认 data/；打包成桌面软件后由外壳指定到 %APPDATA% */
export const DATA = process.env.STUDIO_DATA_DIR ? path.resolve(process.env.STUDIO_DATA_DIR) : path.join(ROOT, 'data');
export const FILES = path.join(DATA, 'files');
export const EXPORTS = path.join(DATA, 'exports');
const DB_FILE = path.join(DATA, 'db.json');
const SECRETS_FILE = path.join(DATA, 'secrets.json');

for (const d of [DATA, FILES, EXPORTS]) fs.mkdirSync(d, { recursive: true });

export const newId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 10);
export const now = () => new Date().toISOString();

export const ARK_DEFAULT_IMAGE_MODEL = 'doubao-seedream-5-0-flash-260915';
/** 以前的默认值；老数据里还是它的话，说明用户没改过，换成新默认 */
const ARK_OLD_DEFAULT_IMAGE_MODELS = ['doubao-seedream-4-0-250828'];

export const DEFAULT_SETTINGS: Settings = {
  // 单价是估算（第三方转售价折算），跑几张后以控制台账单为准，在设置里改。
  // 百炼默认用 pro：2026-11-05 实测，表情连贯、配饰不丢都明显好于 qwen-image-2.0
  providers: {
    bailian: { imageModel: 'qwen-image-2.0-pro', chatModel: 'qwen3.7-plus', size: 1536, pricePerImage: 0.4, watermark: false },
    // 方舟默认 Seedream 5.0 flash（模型 ID 以方舟官方文档为准，2026-11 核对）；单价沿用估算，以账单为准
    ark: { imageModel: ARK_DEFAULT_IMAGE_MODEL, chatModel: 'doubao-seed-2-1-pro-260915', size: 1536, pricePerImage: 0.2, watermark: false },
    custom: { baseUrl: '', imageModel: '', chatModel: '', size: 1024, pricePerImage: 0, watermark: false },
  },
  budgetLimit: false,
  providerBudgetCny: 30,
  providerConcurrency: 2,
  providerMinIntervalSec: 3,
  defaultProvider: 'bailian',
  spriteGrid: { cols: 3, rows: 3, frames: 9 },
  spriteFrameMs: 110,
  bgColor: '#FFFFFF',
  targetBytes: 480 * 1024,
};

export const DEFAULT_PROCESS: ProcessSettings = {
  keyMode: 'flood',
  keyThreshold: 48,
  padding: 4,
  frameDurationMs: null,
  pingpong: false,
  stabilize: false,
  textMode: 'overlay',
  caption: '',
  textAnim: 'bounce',
  textColor: '#FFFFFF',
  strokeColor: '#5A3A2E',
  fontSize: 46,
};

interface Db {
  characters: Character[];
  albums: Album[];
  jobs: Job[];
  settings: Settings;
  /** 花费账本，元（按张计价；删任务也不会丢） */
  spendCny: { jobId: string; cny: number; at: string; what: string }[];
}

function load(): Db {
  if (!fs.existsSync(DB_FILE)) return { characters: [], albums: [], jobs: [], settings: structuredClone(DEFAULT_SETTINGS), spendCny: [] };
  const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) as Partial<Db>;
  const settings = deepMerge(DEFAULT_SETTINGS, raw.settings ?? {});
  if (ARK_OLD_DEFAULT_IMAGE_MODELS.includes(settings.providers.ark.imageModel)) settings.providers.ark.imageModel = ARK_DEFAULT_IMAGE_MODEL;
  return {
    characters: raw.characters ?? [],
    albums: raw.albums ?? [],
    jobs: raw.jobs ?? [],
    settings,
    spendCny: raw.spendCny ?? [],
  };
}

export const spentCny = () => db.spendCny.reduce((s, x) => s + x.cny, 0);

export const db: Db = load();

let saveTimer: NodeJS.Timeout | null = null;
/** 合并 200ms 内的多次修改，原子写入（先写临时文件再改名） */
export function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flush();
  }, 200);
}
export function flush() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, DB_FILE);
}

export function getAlbum(id: string) {
  const a = db.albums.find((x) => x.id === id);
  if (!a) throw httpError(404, '找不到这个专辑');
  return a;
}
export function getCharacter(id: string) {
  const c = db.characters.find((x) => x.id === id);
  if (!c) throw httpError(404, '找不到这个角色');
  return c;
}
export function getSticker(album: Album, sid: string) {
  const s = album.stickers.find((x) => x.id === sid);
  if (!s) throw httpError(404, '找不到这张表情');
  return s;
}

// ---- 文件 ----
export function absPath(rel: string) {
  const p = path.resolve(FILES, rel);
  if (!p.startsWith(FILES)) throw httpError(400, '非法路径');
  return p;
}
export function writeFile(rel: string, buf: Buffer | Uint8Array) {
  const p = absPath(rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, buf);
  return rel;
}
export function readFile(rel: string) {
  return fs.readFileSync(absPath(rel));
}

// ---- API Key（只存在本机数据目录的 secrets.json，不回传给前端，也不会发给我们）----
interface Secrets {
  keys?: Partial<Record<ProviderId, string>>;
}
const ENV_KEY: Record<ProviderId, string> = { bailian: 'DASHSCOPE_API_KEY', ark: 'ARK_API_KEY', custom: 'CUSTOM_API_KEY' };

function readSecrets(): Secrets {
  try {
    return JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8'));
  } catch {
    return {};
  }
}
/**
 * 界面里填的 Key 优先，环境变量兜底：方舟文档会教人设 ARK_API_KEY，
 * 以前环境变量优先时，电脑里留着的旧 Key 会悄悄盖掉用户刚粘贴的新 Key。
 * 读出来时也洗一遍，以前存进去的脏 Key（带了名称、Bearer 等）不用重填也能用。
 */
export function getApiKey(p: ProviderId): string | undefined {
  return cleanKey(readSecrets().keys?.[p] ?? '') || cleanKey(process.env[ENV_KEY[p]] ?? '') || undefined;
}
export function setApiKey(key: string, p: ProviderId) {
  const k = cleanKey(key);
  const bad = checkKey(p, k);
  if (bad) throw httpError(400, bad);
  const s = readSecrets();
  s.keys = { ...s.keys, [p]: k };
  fs.writeFileSync(SECRETS_FILE, JSON.stringify({ keys: s.keys }));
}
export { keyHint } from './apiKey';

// ---- 工具 ----
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const httpError = (status: number, msg: string) => new HttpError(status, msg);

export function deepMerge<T>(base: T, patch: any): T {
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return (patch ?? base) as T;
  const out: any = { ...base };
  for (const [k, v] of Object.entries(patch ?? {})) {
    out[k] = typeof v === 'object' && v !== null && !Array.isArray(v) ? deepMerge((base as any)[k] ?? {}, v) : v;
  }
  return out;
}
