// 前后端共享的数据类型（web 端也会 import 这个文件）

/** 国内模型平台：阿里云百炼 / 火山方舟 / 自定义兼容接口（都由用户自己填 Key，在本机直接调用） */
export type ProviderId = 'bailian' | 'ark' | 'custom';
/** 生成源：国内平台，或手动导入（在豆包、即梦等 App 里生成后拖回来） */
export type Backend = ProviderId | 'manual';
/** 会进入任务队列的生成源（手动导入不排队） */
export type GenBackend = ProviderId;
/** gif = 导入现成的动图；sprite = 一张多帧拼图(精灵图)，本地切帧合成 GIF */
export type GenMode = 'gif' | 'sprite';
export type TextAnim = 'static' | 'bounce' | 'shake' | 'pop';
/** none = 保留原背景；flood = 从边缘连通区域抠掉背景（不误伤白眼睛等内部白色）；global = 全图同色都抠掉 */
export type KeyMode = 'none' | 'flood' | 'global';
export type AssetKind = 'cover' | 'icon' | 'banner' | 'rewardGuide' | 'rewardThanks';

export interface ProviderSettings {
  /** 生图模型名（百炼：qwen-image-2.0 等；方舟：控制台里的 Model ID） */
  imageModel: string;
  /** 文字模型名（AI 帮我想、测试连接用；可以留空） */
  chatModel: string;
  /** 精灵图边长 px */
  size: number;
  /** 每张单价（元），用来估算和记账 */
  pricePerImage: number;
  /** 是否让平台加可见的“AI 生成”水印（方舟默认加在右下角，会落在精灵图最后一帧上） */
  watermark: boolean;
  /** 只有自定义接口用：接口地址，例如 https://example.com/v1 */
  baseUrl?: string;
}

export interface SpriteGrid {
  cols: number;
  rows: number;
  frames: number;
}

export interface CharacterSpec {
  species: string; // 形态/物种
  body: string; // 体型比例
  colors: string; // 配色（带 hex）
  features: string; // 五官和标志特征
  accessories: string; // 配饰
  style: string; // 画风
  personality: string; // 性格（影响动作演绎）
}

export interface Character {
  id: string;
  name: string;
  spec: CharacterSpec;
  /** 锁定后的"角色 DNA"提示词块，每张表情都原样带上 */
  dna: string;
  locked: boolean;
  concepts: string[]; // data/files 下的相对路径
  referencePng?: string; // 透明背景正面全身参考图
  createdAt: string;
}

export interface ProcessSettings {
  keyMode: KeyMode;
  keyThreshold: number; // RGB 欧氏距离，越大抠得越狠
  padding: number; // 主体四周留白百分比
  frameDurationMs: number | null; // null = 保留原始帧时长
  pingpong: boolean; // 正放+倒放，让不闭合的动作也能无缝循环
  stabilize: boolean; // 精灵图各帧对齐（去抖）
  textMode: 'overlay' | 'none';
  caption: string;
  textAnim: TextAnim;
  textColor: string;
  strokeColor: string;
  fontSize: number;
  spriteGrid?: SpriteGrid;
  /** 只用这几帧（精灵图按格子编号，从 1 开始，按顺序播放）；空 = 全部 */
  frameSel?: number[];
}

export interface ProcessReport {
  width: number;
  height: number;
  bytes: number;
  frames: number;
  loop: boolean;
  durationMs: number;
  colors: number;
  lossy: number;
  steps: string[];
}

export interface Candidate {
  id: string;
  backend: Backend;
  mode: GenMode;
  rawPath: string;
  processedPath?: string;
  createdAt: string;
  prompt: string;
  /** 花费（元） */
  costCny?: number;
  report?: ProcessReport;
  settings: ProcessSettings;
  error?: string;
}

export interface StickerItem {
  id: string;
  meaning: string; // 含义词（≤4 字，同套不重复）
  caption: string; // 画面字
  action: string; // 动作描述
  emotion: string;
  scene: string; // 什么时候发
  group: string;
  textAnim: TextAnim;
  candidates: Candidate[];
  selectedId?: string;
}

export interface Album {
  id: string;
  name: string;
  intro: string;
  copyright: string;
  rewardText: string;
  characterId: string;
  presetId: string;
  stickers: StickerItem[];
  assets: Partial<Record<AssetKind, string>>;
  createdAt: string;
  updatedAt: string;
}

export type JobKind = 'sticker' | 'concept' | 'reference' | 'asset';
export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'canceled';

export interface Job {
  id: string;
  kind: JobKind;
  backend: GenBackend;
  mode: GenMode;
  albumId?: string;
  stickerId?: string;
  characterId?: string;
  assetKind?: AssetKind;
  status: JobStatus;
  error?: string;
  prompt: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  costCny?: number;
  resultPath?: string;
}

export interface Settings {
  providers: Record<ProviderId, ProviderSettings>;
  /** 是否启用预算上限：关掉时只显示估算花费，不拦任务 */
  budgetLimit: boolean;
  /** 总预算（元），启用上限时才生效 */
  providerBudgetCny: number;
  providerConcurrency: number;
  providerMinIntervalSec: number;
  /** 默认用哪个平台（向导里选的） */
  defaultProvider: ProviderId;
  /** 同意用户须知的时间（第一次打开时） */
  agreedAt?: string;
  spriteGrid: SpriteGrid;
  spriteFrameMs: number;
  bgColor: string; // 生成时要求的纯色背景（后期抠掉）
  targetBytes: number; // 压缩目标（微信上限 500KB，留余量）
}

export interface CheckIssue {
  level: 'error' | 'warn';
  field: string;
  msg: string;
}

export interface Preset {
  id: string;
  name: string;
  audience: string;
  insight: string[];
  characters: { name: string; spec: CharacterSpec }[];
  groups: { name: string; why: string }[];
  stickers: {
    meaning: string;
    caption: string;
    action: string;
    emotion: string;
    scene: string;
    group: string;
    default: boolean;
    textAnim?: TextAnim;
  }[];
  rewardTextIdeas: string[];
}
