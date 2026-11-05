import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProviderId } from '../../server/types';
export type * from '../../server/types';

export interface ProviderStatus {
  hasKey: boolean;
  keyHint: string;
  paused: string;
  hasChat: boolean;
}
export interface Status {
  agreed: boolean;
  dataDir: string;
  providers: Record<ProviderId, ProviderStatus>;
  /** 预算（元）；limited = 是否启用了上限 */
  budget: { limited: boolean; budget: number; spent: number; queuedEstimate: number; remaining: number; queuedCount: number };
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET'),
    headers: opts.form ? undefined : { 'Content-Type': 'application/json' },
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error ?? `请求失败（${res.status}）`);
  return data as T;
}

export const fileUrl = (rel?: string) => (rel ? `/files/${rel.split('/').map(encodeURIComponent).join('/')}` : '');

/** 拉数据 + 手动刷新 + 可选轮询 */
export function useData<T>(path: string | null, pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const load = useCallback(async () => {
    if (!path) return;
    try {
      const d = await api<T>(path);
      if (alive.current) {
        setData(d);
        setError('');
      }
    } catch (e: any) {
      if (alive.current) setError(e.message);
    }
  }, [path]);
  useEffect(() => {
    alive.current = true;
    setData(null);
    load();
    if (!pollMs) return () => void (alive.current = false);
    const t = setInterval(load, pollMs);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [load, pollMs]);
  return { data, error, reload: load, setData };
}

export function upload(path: string, file: File, extra: Record<string, string> = {}) {
  const fd = new FormData();
  fd.append('file', file);
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return api(path, { form: fd });
}

export const charLen = (s: string) => Array.from(s ?? '').length;
export const cny = (n?: number) => (n === undefined ? '—' : `¥${n.toFixed(2)}`);
export const kb = (n?: number) => (n === undefined ? '—' : `${Math.round(n / 1024)}KB`);

export function useLocal<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key);
      return s ? (JSON.parse(s) as T) : init;
    } catch {
      return init;
    }
  });
  const set = (nv: T) => {
    setV(nv);
    try {
      localStorage.setItem(key, JSON.stringify(nv));
    } catch {
      /* 忽略 */
    }
  };
  return [v, set];
}
