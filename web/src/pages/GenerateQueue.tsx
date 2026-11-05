import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../App';
import { api, cny, upload, useData, type Album, type GenBackend, type GenMode, type Job } from '../api';
import { backendLabel, costText, defaultBackend, genBackends, isProviderId, MANUAL_TOOLS, PROVIDER_INFO } from '../backends';
import { CopyButton, DropZone, ErrorText, PageHeader, Seg } from '../components/ui';

type B = GenBackend | 'manual';

export default function GenerateQueue() {
  const app = useApp();
  const album = useData<Album>(app.albumId ? `/albums/${app.albumId}` : null, 4000);
  const jobs = useData<(Job & { estimateCny: number })[]>(app.albumId ? `/jobs?albumId=${app.albumId}` : null, 2500);
  const st = app.status;

  const [chosen, setBackend] = useState<B | null>(null);
  const backend: B = chosen ?? defaultBackend(st) ?? 'manual';
  const [variants, setVariants] = useState(1);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [est, setEst] = useState<{ perJob: number; total: number } | null>(null);
  const [err, setErr] = useState('');

  const stickers = album.data?.stickers ?? [];
  const provider = isProviderId(backend);

  // 默认勾选还没有候选的
  useEffect(() => {
    if (album.data && !picked.size) setPicked(new Set(album.data.stickers.filter((s) => !s.candidates.length).map((s) => s.id)));
  }, [album.data?.id]);

  useEffect(() => {
    if (!provider || !app.albumId) return setEst(null);
    api(`/albums/${app.albumId}/estimate`, { body: { stickerIds: [...picked], backend, variants } })
      .then(setEst)
      .catch(() => setEst(null));
  }, [backend, variants, picked.size, app.albumId]);

  const start = async () => {
    setErr('');
    try {
      await api(`/albums/${app.albumId}/generate`, { body: { stickerIds: [...picked], backend, variants } });
      jobs.reload();
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const b = st?.budget;
  const remaining = b ? b.budget - b.spent - b.queuedEstimate : 0;
  // 没启用预算上限时只显示估算，不拦
  const over = !!b?.limited && !!est && est.total > remaining;
  const options = [...genBackends(st), { v: 'manual' as const, label: `手动 · ${MANUAL_TOOLS} 里做好拖进来`, disabled: false }];
  const noKey = !genBackends(st).some((o) => !o.disabled);

  if (!app.albumId) return <p className="text-muted">先在「选题企划」里建一个专辑。</p>;

  return (
    <div>
      <PageHeader title="批量生成" sub="每张先出 1 个候选，挑出效果好的方向，只对不满意的重新生成——这样最省钱。" />
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="card space-y-4">
          <div>
            <span className="label">生成源</span>
            <Seg value={backend} onChange={setBackend} options={options} />
            {noKey && (
              <p className="mt-1 text-xs text-muted">
                还没有填任何平台的 Key，现在只能用手动模式。
                <a className="text-accent-dark underline" href="#/setup">
                  去连接模型
                </a>
              </p>
            )}
          </div>
          {provider && (
            <div>
              <span className="label">每张候选数</span>
              <Seg value={String(variants) as any} onChange={(v) => setVariants(Number(v))} options={[1, 2, 3].map((n) => ({ v: String(n) as any, label: `${n}` }))} />
            </div>
          )}
          <p className="text-xs leading-relaxed text-muted">
            {provider
              ? `${PROVIDER_INFO[backend].label}：每张表情出一张 3×3 的精灵图（9 帧动作，纯色背景，带上角色参考图保持一致），本地切帧、抠背景、加字，合成符合微信规范的 GIF。按张计费，失败不收费。`
              : `每张点「复制提示词」，到 ${MANUAL_TOOLS} 里生成一张 3×3 的精灵图，下载后拖到对应的格子里。已经有现成动图的，选「GIF」直接拖进来。`}
          </p>

          {provider && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-cream p-3">
              <button className="btn-primary" disabled={!picked.size || !!over} onClick={start}>
                生成 {picked.size} 张 × {variants}
              </button>
              {est && (
                <span className={`text-sm ${over ? 'text-bad' : 'text-muted'}`}>
                  预计 {cny(est.total)}（每张约 {cny(est.perJob)}，以平台账单为准）
                  {b?.limited && ` · 预算还剩约 ${cny(remaining)}`}
                  {over && ' — 超出预算上限，请少选几张，或在设置里调高、关掉上限'}
                </span>
              )}
            </div>
          )}
          <ErrorText msg={err} />

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">{provider ? '选择要生成的表情' : '逐张导入'}</span>
              {provider && (
                <span className="flex gap-2 text-xs">
                  <button className="text-accent-dark hover:underline" onClick={() => setPicked(new Set(stickers.map((s) => s.id)))}>
                    全选
                  </button>
                  <button className="text-accent-dark hover:underline" onClick={() => setPicked(new Set(stickers.filter((s) => !s.candidates.length).map((s) => s.id)))}>
                    只选还没有图的
                  </button>
                  <button className="text-accent-dark hover:underline" onClick={() => setPicked(new Set())}>
                    清空
                  </button>
                </span>
              )}
            </div>
            <div className={provider ? 'grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2' : 'space-y-2'}>
              {stickers.map((s) =>
                !provider ? (
                  <ManualRow key={s.id} albumId={app.albumId} s={s} onDone={album.reload} />
                ) : (
                  <label key={s.id} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 ${picked.has(s.id) ? 'border-accent bg-accent-soft' : 'border-line'}`}>
                    <input
                      type="checkbox"
                      checked={picked.has(s.id)}
                      onChange={(e) => {
                        const n = new Set(picked);
                        e.target.checked ? n.add(s.id) : n.delete(s.id);
                        setPicked(n);
                      }}
                    />
                    <span className="font-medium whitespace-nowrap">{s.meaning}</span>
                    {!!s.candidates.length && <span className="ml-auto text-xs whitespace-nowrap text-muted">{s.candidates.length} 个</span>}
                  </label>
                ),
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-display text-xl">任务队列</div>
            <button
              className="text-xs text-muted hover:text-accent-dark"
              onClick={async () => {
                await api('/jobs/clear', { body: {} });
                jobs.reload();
              }}
            >
              清除已完成
            </button>
          </div>
          <JobList jobs={jobs.data ?? []} onChange={jobs.reload} stickers={stickers} />
          <a href="#/review" className="btn-primary mt-3 w-full">
            去挑选精修 →
          </a>
        </div>
      </div>
    </div>
  );
}

function ManualRow({ albumId, s, onDone }: { albumId: string; s: Album['stickers'][number]; onDone: () => void }) {
  const [mode, setMode] = useState<GenMode>('sprite');
  const [msg, setMsg] = useState('');
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-2">
      <span className="w-20 font-medium">{s.meaning}</span>
      <Seg value={mode} onChange={setMode} options={[{ v: 'sprite', label: '精灵图' }, { v: 'gif', label: '现成 GIF' }]} />
      {mode === 'sprite' && <CopyButton getText={async () => (await api(`/albums/${albumId}/stickers/${s.id}/prompt`)).prompt} />}
      <div className="min-w-[200px] flex-1">
        <DropZone
          small
          label={msg || (mode === 'sprite' ? `把 ${MANUAL_TOOLS} 生成的精灵图拖到这里` : '把现成的动图拖到这里')}
          onFile={async (f) => {
            setMsg('处理中…');
            try {
              await upload(`/albums/${albumId}/stickers/${s.id}/upload`, f, { mode });
              setMsg('已加入候选 ✓');
              onDone();
            } catch (e: any) {
              setMsg(e.message);
            }
          }}
        />
      </div>
      {!!s.candidates.length && <span className="text-xs text-muted">{s.candidates.length} 个候选</span>}
    </div>
  );
}

const STATUS: Record<Job['status'], [string, string]> = {
  queued: ['排队', 'bg-[#f3eae6] text-muted'],
  running: ['生成中', 'bg-accent-soft text-accent-dark'],
  done: ['完成', 'bg-[#e2f5ec] text-ok'],
  error: ['失败', 'bg-[#fde4e8] text-bad'],
  canceled: ['已取消', 'bg-[#f3eae6] text-muted'],
};
const KIND: Record<Job['kind'], string> = { sticker: '表情', concept: '设定图', reference: '参考图', asset: '配套图' };

export function JobList({ jobs, onChange, stickers, compact }: { jobs: (Job & { estimateCny?: number })[]; onChange: () => void; stickers?: Album['stickers']; compact?: boolean }) {
  const list = useMemo(() => [...jobs].reverse().slice(0, compact ? 6 : 60), [jobs, compact]);
  const name = (j: Job) => (j.stickerId ? stickers?.find((s) => s.id === j.stickerId)?.meaning : undefined) ?? KIND[j.kind];
  const counts = jobs.reduce((m, j) => ((m[j.status] = (m[j.status] ?? 0) + 1), m), {} as Record<string, number>);
  if (!jobs.length) return <p className="text-sm text-muted">还没有任务。</p>;
  return (
    <div>
      {!compact && (
        <div className="mb-2 flex flex-wrap gap-1.5 text-xs">
          {Object.entries(counts).map(([k, n]) => (
            <span key={k} className={`chip ${STATUS[k as Job['status']][1]}`}>
              {STATUS[k as Job['status']][0]} {n}
            </span>
          ))}
        </div>
      )}
      <ul className="max-h-[520px] space-y-1.5 overflow-y-auto">
        {list.map((j) => (
          <li key={j.id} className="rounded-lg border border-line px-2.5 py-1.5 text-sm">
            <div className="flex items-center gap-2">
              <span className={`chip ${STATUS[j.status][1]}`}>{STATUS[j.status][0]}</span>
              <span className="font-medium">{name(j)}</span>
              <span className="text-xs text-muted">
                {backendLabel(j.backend)} · {j.kind === 'sticker' ? '精灵图' : '静态图'}
              </span>
              <span className="ml-auto text-xs text-muted">{costText(j) || (j.status === 'queued' && j.estimateCny ? `≈${cny(j.estimateCny)}` : '')}</span>
              {j.status === 'error' && (
                <button className="text-xs text-accent-dark hover:underline" onClick={async () => (await api(`/jobs/${j.id}/retry`, { body: {} }), onChange())}>
                  重试
                </button>
              )}
              {j.status === 'queued' && (
                <button className="text-xs text-muted hover:underline" onClick={async () => (await api(`/jobs/${j.id}/cancel`, { body: {} }), onChange())}>
                  取消
                </button>
              )}
            </div>
            {j.error && <div className="mt-1 text-xs break-all text-bad">{j.error}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}
