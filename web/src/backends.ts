import { PROVIDER_IDS, PROVIDER_INFO, isProviderId } from '../../server/providerInfo';
import { cny, type Backend, type GenBackend, type Status } from './api';

export { PROVIDER_IDS, PROVIDER_INFO, isProviderId };

export interface BackendOption {
  v: GenBackend;
  label: string;
  disabled: boolean;
}

/** 可选的平台：百炼、方舟；自定义接口填了 Key 才显示 */
export function genBackends(st: Status | null): BackendOption[] {
  const out: BackendOption[] = [];
  for (const p of PROVIDER_IDS) {
    const ps = st?.providers?.[p];
    if (p === 'custom' && !ps?.hasKey) continue;
    out.push({ v: p, label: ps?.hasKey ? PROVIDER_INFO[p].label : `${PROVIDER_INFO[p].label}（未填 Key）`, disabled: !ps?.hasKey });
  }
  return out;
}

/** 默认平台：第一个填了 Key 的；都没填时返回 null（只能手动） */
export function defaultBackend(st: Status | null): GenBackend | null {
  return genBackends(st).find((o) => !o.disabled)?.v ?? null;
}

export function backendLabel(b: Backend): string {
  return isProviderId(b) ? PROVIDER_INFO[b].short : '手动';
}

export const costText = (x: { costCny?: number }) => (x.costCny !== undefined ? cny(x.costCny) : '');

/** 手动模式里推荐的出图工具 */
export const MANUAL_TOOLS = '豆包 / 即梦 App';
