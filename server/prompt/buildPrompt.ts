import type { AssetKind, Character, CharacterSpec, SpriteGrid, StickerItem } from '../types';

/**
 * 提示词。国内生图模型和豆包/即梦 App 大多不支持透明背景，所以一律要求纯色底，后期自动抠掉。
 */

/** 把角色设定字段拼成固定的"角色 DNA"块 */
export function buildDna(name: string, s: CharacterSpec): string {
  return [
    `角色名：${name}（原创角色，不要画成任何已有的动漫、品牌或吉祥物形象）`,
    `形态：${s.species}`,
    `体型比例：${s.body}`,
    `配色（严格使用）：${s.colors}`,
    `五官与标志特征：${s.features}`,
    s.accessories ? `配饰：${s.accessories}` : '',
    `画风：${s.style}`,
    `性格（用表情和肢体演出来）：${s.personality}`,
  ]
    .filter(Boolean)
    .join('\n');
}

const BANNED = '禁止出现：真人或照片质感、品牌 logo、二维码、条形码、联系方式、国旗、货币、烟酒、武器、其他已有卡通角色。';

function bgLine(bg: string) {
  return `背景：纯色 ${bg} 平涂，无渐变、无阴影、无地面、无任何装饰物。`;
}

/** 把 n 帧分成“开始—最大—回位”三段，写成提示词 */
export function motionPhases(n: number): string {
  const range = (a: number, b: number) => (a === b ? `第 ${a} 格` : `第 ${a}–${b} 格`);
  const a = Math.max(1, Math.round(n / 3));
  const b = Math.min(n - 1, Math.max(a + 1, Math.round((2 * n) / 3)));
  return `动作分三段连贯地演：${range(1, a)}动作开始，${range(a + 1, b)}动作幅度最大（夸张、有挤压与拉伸），${range(b + 1, n)}慢慢回到第 1 格的姿势。相邻两格之间只有小而连续的变化。`;
}

/** 精灵图（多帧拼图）提示词：一张 3×3 拼图 = 一段循环动画，带角色参考图保持一致 */
export function stickerSpritePrompt(c: Character, st: StickerItem, grid: SpriteGrid, hasRef: boolean, withCaptionSpace: boolean, bg: string): string {
  const n = grid.cols * grid.rows;
  return [
    `生成一张正方形的“精灵图”（多帧动画拼图）。整张图的背景是同一种纯色 ${bg} 平涂，无渐变、无阴影、无地面、无装饰。`,
    `排版：严格的 ${grid.cols} 列 × ${grid.rows} 行网格，一共 ${n} 个大小相同的格子；格子之间不要画分隔线、边框、编号或文字。`,
    `按从左到右、从上到下的顺序，是同一段循环小动画的第 1 到第 ${grid.frames} 帧（像动画片的连续分镜），最后一帧能自然接回第 1 帧。`,
    `${n} 个格子每一格都要画角色，一个都不能空；每格只画一个角色，同样大小、水平居中、脚底在同一高度。`,
    '角色连同天线、耳朵、脚和影子，只占格子高度的约 70%，四周留出明显的空白；任何部分都不能超出自己的格子，身体也不能被格子边缘切断，要完整画出来。',
    withCaptionSpace ? '每个格子底部约 18% 留空（后期会加字幕）。' : '',
    hasRef ? '附图是角色参考图，只参考外形：每一格都保持它的体型、比例、耳朵、配色、描边，附图里的每一个配饰每一格都要画上；不要把附图原样放进任何一格，也不要照搬附图里平静的表情。' : '',
    '',
    '角色设定（每一格完全一致）：',
    c.dna,
    '',
    `这一张表情：情绪「${st.emotion}」，动作：${st.action}。`,
    `【最重要】${grid.frames} 格里角色的表情全部都是「${st.emotion}」，从第 1 格就是，一直保持到最后一格；眉毛、眼睛、嘴巴、脸色都要表现这个情绪。不要出现其他表情，不要有任何一格是平静的笑脸。`,
    motionPhases(grid.frames),
    '不要画地面、阴影、背景装饰和任何文字。',
    BANNED,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

/** 角色概念设定图 */
export function conceptPrompt(name: string, dna: string, bg: string): string {
  return [
    '【用途】原创微信表情包角色的设定图。',
    dna,
    '',
    '画面：只有这一个角色，正面全身站姿，带一点符合性格的小动作和表情，居中，约占画面 80%（选中后可直接当参考图用）。',
    bgLine(bg),
    '不要任何文字和标注。',
    BANNED,
  ].join('\n');
}

/** 参考图：正面全身，后面做封面、图标、精灵图参考（纯色底，后期抠图） */
export function referencePrompt(dna: string, hasRef: boolean, bg: string): string {
  return [
    `【用途】表情包角色的标准参考图，纯色 ${bg} 背景。`,
    hasRef ? '附图是这个角色现有的样子：沿用它的外形、比例和配色，但附图里的表情和动作不用照搬；附图和下面文字设定不一致的地方，以文字设定为准。' : '',
    dna,
    '',
    '画面：只有这一个角色，正面全身站姿，微笑，双手自然放在身体两侧，居中，约占画面 85%。',
    `${bgLine(bg)}不要任何文字。`,
    BANNED,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

const ASSET_BRIEF: Record<AssetKind, string> = {
  cover: '角色正面半身或全身像，表情最有辨识度，居中占满画面约 85%。无文字、无白色描边、无边框。',
  icon: '只画角色的头部正面特写，表情可爱，居中占满画面。无文字、无白色描边、无边框。',
  banner:
    '横版故事场景插画：角色在一个温馨有趣的生活小场景里（例如在铺满软垫的房间里抱着零食、和小花小星星玩耍），画面丰富有故事感。色调活泼明朗，背景不要用白色。角色放在画面中部偏左。不要任何文字。',
  rewardGuide:
    '横版构图（宽约是高的 1.3 倍）。角色双手捧着一个空空的小碗，星星眼、期待又害羞地看着观众，像在可爱地讨要投喂；表情开心期待，不要任何生气符号、汗滴或怒气标记。整个角色完整地放在画面中间，头顶和耳朵上方、脚下都留出空白，不要被裁切。背景活泼明朗的纯色或简单圆点图案，不要白色、不要透明。不要文字。',
  rewardThanks:
    '角色开心地鞠躬并双手比心，周围飘着小爱心和小星星，表情非常感动。整个角色完整地放在画面中间，四周留出空白，不要被裁切。背景活泼明朗，不要白色、不要透明。不要文字。',
};

export function assetPrompt(kind: AssetKind, dna: string, bg: string): string {
  // 封面和图标要透明底：先要求纯色底，后期自动抠掉
  const brief = assetWantsTransparent(kind) ? `${ASSET_BRIEF[kind]}${bgLine(bg)}` : ASSET_BRIEF[kind];
  return ['【用途】微信表情专辑的配套图片。', dna, '', brief, BANNED].join('\n');
}

/** 生成时请求的尺寸 */
export function assetGenSize(kind: AssetKind): string {
  if (kind === 'banner' || kind === 'rewardGuide') return '1536x1024';
  return '1024x1024';
}
export const assetWantsTransparent = (kind: AssetKind) => kind === 'cover' || kind === 'icon';
