import { useEffect, useState, type ReactNode } from 'react';
import { useApp } from '../App';
import { api, cny, useData, type ProviderId, type ProviderSettings, type Settings } from '../api';
import { PROVIDER_IDS, PROVIDER_INFO } from '../backends';
import { ConfirmButton, ErrorText, PageHeader } from '../components/ui';

type Txt = (label: string, v: string, on: (t: string) => void, hint?: string, placeholder?: string) => ReactNode;
type Num = (label: string, v: number, on: (n: number) => void, step?: number, hint?: string) => ReactNode;

export default function SettingsPage() {
  const app = useApp();
  const s = useData<Settings>('/settings');
  const spend = useData<{ jobId: string; cny: number; at: string; what: string }[]>('/spend-cny');
  const [form, setForm] = useState<Settings | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => void (s.data && setForm(s.data)), [s.data]);
  if (!form) return null;
  const setP = (p: ProviderId, patch: Partial<ProviderSettings>) => setForm({ ...form, providers: { ...form.providers, [p]: { ...form.providers[p], ...patch } } });

  const save = async () => {
    setErr('');
    try {
      await api('/settings', { method: 'PUT', body: form });
      app.reloadStatus();
      setMsg('已保存 ✓');
      setTimeout(() => setMsg(''), 1500);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const num: Num = (label, v, on, step = 1, hint) => (
    <label className="block">
      <span className="label">{label}</span>
      <input className="input" type="number" step={step} value={v} onChange={(e) => on(Number(e.target.value))} />
      {hint && <span className="mt-0.5 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
  const txt: Txt = (label, v, on, hint, placeholder) => (
    <label className="block">
      <span className="label">{label}</span>
      <input className="input" value={v} placeholder={placeholder} onChange={(e) => on(e.target.value)} />
      {hint && <span className="mt-0.5 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
  const b = app.status?.budget;

  return (
    <div>
      <PageHeader title="设置与预算" right={<button className="btn-primary" onClick={save}>{msg || '保存设置'}</button>} />
      <ErrorText msg={err} />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card space-y-4 lg:col-span-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="font-display text-xl">模型平台</div>
            <label className="flex items-center gap-2 text-sm">
              默认平台
              <select className="input w-auto" value={form.defaultProvider} onChange={(e) => setForm({ ...form, defaultProvider: e.target.value as ProviderId })}>
                {PROVIDER_IDS.map((p) => (
                  <option key={p} value={p}>
                    {PROVIDER_INFO[p].label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-sm text-muted">Key 只保存在这台电脑的数据目录里，不会显示出来，也不会上传给我们。改了模型名或单价后记得点右上角「保存设置」。</p>
          <div className="grid gap-4 xl:grid-cols-3">
            {PROVIDER_IDS.map((p) => (
              <ProviderCard key={p} p={p} cfg={form.providers[p]} onChange={(patch) => setP(p, patch)} txt={txt} num={num} />
            ))}
          </div>
        </div>

        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-display text-xl">花费（元）</div>
            <ConfirmButton
              className="btn text-xs"
              label="清零"
              confirmLabel="确定清零"
              hint="只清软件里的记录，不影响平台账单"
              onConfirm={async () => {
                await api('/spend/reset', { body: {} });
                spend.reload();
                app.reloadStatus();
              }}
            />
          </div>
          <div className={`grid gap-3 text-center ${form.budgetLimit ? 'grid-cols-3' : 'grid-cols-2'}`}>
            <Stat label="估算已花" v={cny(b?.spent)} />
            <Stat label="排队中预计" v={cny(b?.queuedEstimate)} />
            {form.budgetLimit && <Stat label="剩余" v={cny(b?.remaining)} />}
          </div>
          <p className="text-[11px] text-muted">按「每张单价」估算，失败的不算。实际扣费以平台账单为准，对完账可以点「清零」重新算。</p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.budgetLimit} onChange={(e) => setForm({ ...form, budgetLimit: e.target.checked })} />
            启用预算上限（预计会超出时，不再接新任务）
          </label>
          {form.budgetLimit && num('预算上限（元）', form.providerBudgetCny, (n) => setForm({ ...form, providerBudgetCny: n }), 1)}
          <div className="grid grid-cols-2 gap-3">
            {num('同时请求数', form.providerConcurrency, (n) => setForm({ ...form, providerConcurrency: n }))}
            {num('两次请求最小间隔 s', form.providerMinIntervalSec, (n) => setForm({ ...form, providerMinIntervalSec: n }))}
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">花费明细（{spend.data?.length ?? 0} 笔）</summary>
            <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto text-xs">
              {[...(spend.data ?? [])].reverse().map((x) => (
                <li key={x.jobId + x.at} className="flex justify-between">
                  <span className="text-muted">
                    {new Date(x.at).toLocaleString()} · {x.what}
                  </span>
                  <span>{cny(x.cny)}（估）</span>
                </li>
              ))}
            </ul>
          </details>
        </div>

        <div className="card space-y-3">
          <div className="font-display text-xl">精灵图与后期</div>
          <div className="grid gap-3 md:grid-cols-3">
            {num('精灵图列数', form.spriteGrid.cols, (n) => setForm({ ...form, spriteGrid: { ...form.spriteGrid, cols: n } }))}
            {num('精灵图行数', form.spriteGrid.rows, (n) => setForm({ ...form, spriteGrid: { ...form.spriteGrid, rows: n } }))}
            {num('使用帧数', form.spriteGrid.frames, (n) => setForm({ ...form, spriteGrid: { ...form.spriteGrid, frames: n } }))}
            {num('精灵图每帧 ms', form.spriteFrameMs, (n) => setForm({ ...form, spriteFrameMs: n }), 10)}
            {num('压缩目标 KB（上限 500）', Math.round(form.targetBytes / 1024), (n) => setForm({ ...form, targetBytes: n * 1024 }))}
            {txt('生成时要求的背景色', form.bgColor, (t) => setForm({ ...form, bgColor: t }), '后期会自动抠掉')}
          </div>
          {app.status?.dataDir && <p className="text-xs break-all text-muted">数据目录：{app.status.dataDir}</p>}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, v }: { label: string; v: string }) {
  return (
    <div className="rounded-xl bg-cream p-2">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-lg font-semibold">{v}</div>
    </div>
  );
}

function ProviderCard({ p, cfg, onChange, txt, num }: { p: ProviderId; cfg: ProviderSettings; onChange: (patch: Partial<ProviderSettings>) => void; txt: Txt; num: Num }) {
  const app = useApp();
  const info = PROVIDER_INFO[p];
  const ps = app.status?.providers[p];
  const [key, setKey] = useState('');
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-2.5 rounded-xl border border-line p-3">
      <div className="flex items-baseline justify-between">
        <span className="font-medium">{info.label}</span>
        <span className={`text-xs ${ps?.hasKey ? 'text-ok' : 'text-muted'}`}>{ps?.hasKey ? `已填 ${ps.keyHint}` : '未填 Key'}</span>
      </div>
      {ps?.paused && <p className="text-xs text-warn">{ps.paused}</p>}
      <div className="flex gap-1.5">
        <input className="input" type="password" autoComplete="off" placeholder={ps?.hasKey ? '填新的会覆盖' : 'API Key'} value={key} onChange={(e) => setKey(e.target.value)} />
        <button
          className="btn whitespace-nowrap"
          disabled={busy || (!key.trim() && !ps?.hasKey)}
          onClick={async () => {
            setBusy(true);
            setResult(null);
            try {
              if (key.trim()) await api('/secrets', { method: 'PUT', body: { provider: p, key: key.trim() } });
              setKey('');
              app.reloadStatus();
              setResult(await api(`/providers/${p}/test`, { body: {} }));
            } catch (e: any) {
              setResult({ ok: false, detail: e.message });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? '…' : key.trim() ? '保存并测试' : '测试'}
        </button>
      </div>
      {result && <p className={`text-xs ${result.ok ? 'text-ok' : 'text-bad'}`}>{result.detail}</p>}
      {p === 'custom' && txt('接口地址', cfg.baseUrl ?? '', (t) => onChange({ baseUrl: t }), '例如 https://example.com/v1', 'https://')}
      {txt('生图模型', cfg.imageModel, (t) => onChange({ imageModel: t }), p === 'ark' ? '方舟控制台「模型列表」里的 Model ID' : undefined)}
      {txt('文字模型（可空）', cfg.chatModel, (t) => onChange({ chatModel: t }), '用于测试连接和「AI 帮我想」')}
      <div className="grid grid-cols-2 gap-2">
        {num('精灵图边长 px', cfg.size, (n) => onChange({ size: n }), 16)}
        {num('每张单价（元）', cfg.pricePerImage, (n) => onChange({ pricePerImage: n }), 0.01)}
      </div>
      <label className="flex items-start gap-2 text-xs text-muted">
        <input type="checkbox" className="mt-0.5" checked={cfg.watermark} onChange={(e) => onChange({ watermark: e.target.checked })} />
        <span>让平台在图上加可见的“AI 生成”水印。关掉时由你负责标识：软件会在导出文件里写入隐式标识并生成声明文案，发布时请主动声明 AI 生成。</span>
      </label>
      {info.termsNote && <p className="text-[11px] leading-relaxed text-warn">{info.termsNote}</p>}
    </div>
  );
}
