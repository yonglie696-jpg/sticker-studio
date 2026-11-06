import type { ProviderId } from './types';

/**
 * 把用户粘贴进来的 Key 洗干净。
 * Key 输入框是密码框，看不见粘进去的内容，常见的混入物有：
 * - 控制台列表里 Key 的名称、备注（中文），比如“我的key ark-xxxx”
 * - 示例代码里的 `Authorization: Bearer ...`、`ARK_API_KEY=...`、`$env:ARK_API_KEY="..."`
 * - 零宽字符、全角空格、换行、中英文引号
 * 这些字符一旦进了请求头，Node 会直接报
 * “Cannot convert argument to a ByteString because the character at index 7 has a value of …”
 */
export function cleanKey(raw: string): string {
  let s = String(raw ?? '')
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
    .replace(/\u3000/g, ' ')
    .trim();
  const unquote = (t: string) => t.replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '').trim();
  s = unquote(s);
  s = s.replace(/^authorization\s*[:：]\s*/i, '').replace(/^bearer\s+/i, '');
  s = s.replace(/^(?:export\s+|set\s+|\$env:)?[A-Z][A-Z0-9_]*\s*[=:：]\s*/, '');
  s = unquote(s);
  // 前面带着“key:”“我的key ”之类的说明：有 ark- / sk- 开头的一段就直接取它
  const tagged = /(?:^|[^A-Za-z0-9])((?:ark|sk)-[A-Za-z0-9_-]{16,})/i.exec(s);
  if (tagged) return tagged[1];
  if (/[^\x21-\x7e]/.test(s)) {
    // 还混着中文或空格：取最长的一段连续可见 ASCII 字符，Key 本身一定在里面
    const best = (s.match(/[\x21-\x7e]+/g) ?? []).sort((a, b) => b.length - a.length)[0] ?? '';
    if (best.length >= 16) s = best.replace(/^[("'`[<]+|[)"'`,.;:\]>]+$/g, '');
  }
  return s;
}

/** Key 明显不对时返回原因（给用户看的话），没问题返回 undefined */
export function checkKey(p: ProviderId, k: string): string | undefined {
  if (!k) return '没有读到 Key，请重新复制粘贴';
  if (/[^\x21-\x7e]/.test(k)) return 'Key 里混进了中文、空格或其他特殊字符。请回到控制台，只复制 Key 本身（不要带名称、备注），再粘贴一次';
  if (k.length < 16) return 'Key 太短了，可能没复制全，请重新复制粘贴';
  if (p === 'bailian' && /^ark-/i.test(k)) return '这是火山方舟的 Key（ark- 开头），请填到「火山方舟」那一栏';
  if (p === 'ark' && /^sk-/i.test(k)) return '这像是阿里云百炼的 Key（sk- 开头），请填到「阿里云百炼」那一栏；火山方舟的 Key 在方舟控制台「API Key 管理」里创建';
  if (p === 'ark' && /^AKLT/.test(k)) return '这是火山引擎的 Access Key（AKLT 开头），不是方舟的 API Key。请到方舟控制台「API Key 管理」里创建 API Key';
  return undefined;
}

/** 设置页显示用：带上前缀方便看出填没填错平台，后面只露 4 位 */
export const keyHint = (k?: string) => (k ? `${/^(sk|ark)-/i.exec(k)?.[0] ?? ''}…${k.slice(-4)}` : '');
