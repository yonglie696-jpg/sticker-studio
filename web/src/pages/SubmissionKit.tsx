import { useEffect, useRef, useState } from 'react';
import { useApp } from '../App';
import { api, cny, fileUrl, upload, useData, type Album, type AssetKind, type CheckIssue, type Job, type Preset } from '../api';
import { backendLabel, genBackends } from '../backends';
import { ConfirmButton, CopyButton, DropZone, ErrorText, Field, Issues, PageHeader } from '../components/ui';

interface Spec {
  label: string;
  w: number;
  h: number;
  maxBytes: number;
  transparent: boolean;
  formats: string[];
  note: string;
}

export default function SubmissionKit() {
  const app = useApp();
  const album = useData<Album>(app.albumId ? `/albums/${app.albumId}` : null);
  if (!app.albumId) return <p className="text-muted">先在「选题企划」里建一个专辑。</p>;
  return album.data ? <Kit key={album.data.id} a={album.data} reload={album.reload} /> : null;
}

function Kit({ a, reload }: { a: Album; reload: () => void }) {
  const app = useApp();
  const c = app.characters.find((x) => x.id === a.characterId);
  const specs = useData<Record<AssetKind, Spec>>('/asset-specs');
  const preset = useData<Preset>(`/presets/${a.presetId}`);
  const jobs = useData<Job[]>(`/jobs?albumId=${a.id}`, 3000);
  const [check, setCheck] = useState<{ issues: CheckIssue[]; ready: number; ok: boolean; costCny: number } | null>(null);
  const [f, setF] = useState({ name: a.name, intro: a.intro, copyright: a.copyright, rewardText: a.rewardText });
  const [exp, setExp] = useState<{ dir: string; zipName: string } | null>(null);
  const [headRatio, setHeadRatio] = useState('1');
  const [err, setErr] = useState('');
  const timer = useRef(0);

  const runCheck = () => api(`/albums/${a.id}/check`).then(setCheck).catch((e) => setErr(e.message));
  useEffect(() => void runCheck(), []);

  const assetJobsRunning = (jobs.data ?? []).filter((j) => j.kind === 'asset' && (j.status === 'queued' || j.status === 'running')).length;
  useEffect(() => {
    if (!assetJobsRunning) {
      reload();
      runCheck();
    }
  }, [assetJobsRunning]);

  const setField = (k: keyof typeof f, v: string) => {
    const n = { ...f, [k]: v };
    setF(n);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      await api(`/albums/${a.id}`, { method: 'PUT', body: n });
      app.reloadLists();
      runCheck();
    }, 500);
  };

  const act = async (fn: () => Promise<unknown>) => {
    setErr('');
    try {
      await fn();
      reload();
      runCheck();
      jobs.reload();
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const doExport = (force = false) =>
    act(async () => {
      const r = await api(`/albums/${a.id}/export`, { body: { force } });
      setExp(r);
    });

  const firstSelected = a.stickers.find((s) => s.selectedId);

  return (
    <div>
      <PageHeader title="上架包" sub="填好文案、做齐配套图，检查清单全绿就能导出，直接拿去微信表情开放平台上传。" />
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <div className="card grid gap-3 md:grid-cols-2">
            <Field label="表情名称（≤8 字，5 字内最佳，无标点空格）" value={f.name} max={8} onChange={(v) => setField('name', v)} />
            <Field label="版权信息（≤10 字，没注册版权就写设计师/工作室名）" value={f.copyright} max={10} onChange={(v) => setField('copyright', v)} />
            <div className="md:col-span-2">
              <Field label="表情介绍（≤80 字，写形象特点或小故事）" value={f.intro} max={80} multiline onChange={(v) => setField('intro', v)} placeholder={`例：${c?.name ?? 'TA'}是一只嘴硬心软的小团子，生气的时候也很可爱，最喜欢被哄。`} />
            </div>
            <div className="md:col-span-2">
              <Field label="赞赏引导语（5–15 字，用角色口吻）" value={f.rewardText} min={5} max={15} onChange={(v) => setField('rewardText', v)} />
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {preset.data?.rewardTextIdeas.map((t) => {
                  const s = t.replace('{name}', c?.name ?? '');
                  return (
                    <button key={t} className="chip bg-accent-soft text-accent-dark hover:bg-accent hover:text-white" onClick={() => setField('rewardText', s)}>
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="mb-3 flex items-center justify-between">
              <div className="font-display text-xl">配套图片</div>
              {!!assetJobsRunning && <span className="text-xs text-accent-dark">{assetJobsRunning} 张生成中…</span>}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {specs.data &&
                (Object.keys(specs.data) as AssetKind[]).map((k) => {
                  const sp = specs.data![k];
                  const rel = a.assets[k];
                  const ratio = sp.w / sp.h;
                  return (
                    <div key={k} className="rounded-xl border border-line p-3">
                      <div className="flex items-baseline justify-between">
                        <span className="font-medium">{sp.label}</span>
                        <span className="text-xs text-muted">
                          {sp.w}×{sp.h} · {sp.formats.join('/').toUpperCase()}
                        </span>
                      </div>
                      <p className="mb-2 text-xs text-muted">{sp.note}</p>
                      <div className={`mb-2 grid place-items-center overflow-hidden rounded-lg ${sp.transparent ? 'checker' : 'bg-cream'}`} style={{ aspectRatio: ratio > 1.2 ? ratio : 1.6 }}>
                        {rel ? <img src={fileUrl(rel)} className="max-h-full max-w-full" style={{ width: sp.w > 300 ? '100%' : sp.w }} alt="" /> : <span className="text-xs text-muted">还没有</span>}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {k === 'icon' && (
                          <select className="input w-auto" value={headRatio} onChange={(e) => setHeadRatio(e.target.value)} title="图标取景">
                            <option value="1">取景：全身</option>
                            <option value="0.8">取景：上部 80%</option>
                            <option value="0.65">取景：上部 65%</option>
                          </select>
                        )}
                        {(k === 'cover' || k === 'icon') && c?.referencePng && (
                          <button className="btn" onClick={() => act(() => api(`/albums/${a.id}/assets/${k}/from-reference`, { body: { headRatio: Number(headRatio) } }))}>
                            用参考图做
                          </button>
                        )}
                        {(k === 'rewardGuide' || k === 'rewardThanks') && firstSelected && (
                          <button className="btn" onClick={() => act(() => api(`/albums/${a.id}/assets/${k}/from-sticker`, { body: { stickerId: firstSelected.id } }))} title="用第一张已选表情的原图铺底">
                            用表情原图做
                          </button>
                        )}
                        {genBackends(app.status)
                          .filter((o) => !o.disabled)
                          .map((o) => (
                            <button key={o.v} className="btn" onClick={() => act(() => api(`/albums/${a.id}/assets/${k}/generate`, { body: { backend: o.v } }))}>
                              {backendLabel(o.v)} 生成
                            </button>
                          ))}
                        <CopyButton label="提示词" getText={async () => (await api(`/albums/${a.id}/assets/${k}/prompt`)).prompt} />
                        {rel && (
                          <ConfirmButton label="删除" confirmLabel="确定" onConfirm={() => act(() => api(`/albums/${a.id}/assets/${k}`, { method: 'DELETE' }))} />
                        )}
                      </div>
                      <div className="mt-2">
                        <DropZone small label="或拖入图片（自动裁成规格）" onFile={(file) => act(() => upload(`/albums/${a.id}/assets/${k}/upload`, file, { headRatio }))} />
                      </div>
                    </div>
                  );
                })}
            </div>
            <ErrorText msg={err} />
          </div>
        </div>

        <div className="space-y-4">
          <div className="card">
            <div className="mb-2 flex items-center justify-between">
              <div className="font-display text-xl">规范检查</div>
              <button className="btn" onClick={runCheck}>
                重新检查
              </button>
            </div>
            {check ? (
              <>
                <div className="mb-3 flex gap-4 text-sm">
                  <span>
                    已选定 <b>{check.ready}</b> 张
                  </span>
                  <span>
                    这套表情图花费 <b>{cny(check.costCny ?? 0)}</b>
                  </span>
                </div>
                <Issues issues={check.issues} />
              </>
            ) : (
              <p className="text-sm text-muted">检查中…</p>
            )}
          </div>
          <div className="card space-y-2">
            <div className="font-display text-xl">导出</div>
            <button className="btn-primary w-full" disabled={!check?.ok} onClick={() => doExport(false)}>
              导出上架包
            </button>
            {!check?.ok && (
              <button className="w-full text-xs text-muted hover:underline" onClick={() => doExport(true)}>
                还有问题也先导出看看
              </button>
            )}
            {exp && (
              <div className="space-y-2 rounded-xl bg-cream p-3 text-sm">
                <div className="break-all">已导出到：{exp.dir}</div>
                <div className="flex gap-2">
                  <a className="btn" href={`/api/exports/${encodeURIComponent(exp.zipName)}`}>
                    下载 zip
                  </a>
                  <button className="btn" onClick={() => api('/open-folder', { body: { path: exp.dir } })}>
                    打开文件夹
                  </button>
                </div>
                <p className="text-xs text-muted">里面有「上架信息.txt」（复制粘贴用，含 AI 生成声明）和「上传步骤.txt」。图片里已写入 AI 生成的隐式标识。</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
