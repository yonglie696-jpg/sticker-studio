import { useState } from 'react';
import { useApp } from '../App';
import { api, fileUrl, kb, useData, useLocal, type Album, type Candidate, type ProcessSettings, type SpriteGrid, type StickerItem } from '../api';
import { backendLabel, costText, defaultBackend } from '../backends';
import { Badge, ChatPreview, ConfirmButton, ErrorText, PageHeader, Seg } from '../components/ui';

export default function ReviewBoard() {
  const app = useApp();
  const album = useData<Album>(app.albumId ? `/albums/${app.albumId}` : null, 5000);
  const [dark, setDark] = useLocal('reviewDark', false);
  const [open, setOpen] = useState<{ sid: string; cid: string } | null>(null);

  if (!app.albumId) return <p className="text-muted">先在「选题企划」里建一个专辑。</p>;
  const a = album.data;
  const ready = a?.stickers.filter((s) => s.candidates.some((c) => c.id === s.selectedId && c.processedPath)).length ?? 0;

  return (
    <div>
      <PageHeader
        title="挑选精修"
        sub="在仿微信聊天里按真实大小看。每张点选一个最好的；不满意就调后期参数（不花钱）或回去重生成。"
        right={
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted">
              已选定 {ready}/{a?.stickers.length ?? 0}
            </span>
            <Seg value={dark ? 'd' : 'l'} onChange={(v) => setDark(v === 'd')} options={[{ v: 'l', label: '浅色聊天' }, { v: 'd', label: '深色聊天' }]} />
          </div>
        }
      />
      <div className="space-y-3">
        {a?.stickers.map((s, i) => (
          <div key={s.id} className="card">
            <div className="mb-2 flex items-baseline gap-3">
              <span className="text-xs text-muted">{String(i + 1).padStart(2, '0')}</span>
              <span className="font-display text-xl">{s.meaning}</span>
              <span className="text-xs text-muted">{s.action}</span>
            </div>
            {!s.candidates.length ? (
              <p className="text-sm text-muted">还没有候选，去「批量生成」。</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {s.candidates.map((c) => (
                  <div key={c.id} className="space-y-1.5">
                    <ChatPreview
                      dark={dark}
                      src={fileUrl(c.processedPath)}
                      selected={s.selectedId === c.id}
                      onClick={async () => {
                        await api(`/albums/${a.id}/stickers/${s.id}/select`, { body: { candidateId: c.id } });
                        album.reload();
                      }}
                      label={
                        <>
                          {backendLabel(c.backend)}·{c.mode === 'gif' ? 'GIF' : '精灵图'} {costText(c)}
                        </>
                      }
                    />
                    <div className="flex items-center justify-between gap-1">
                      <CandBadges c={c} />
                      <span className="flex gap-2">
                        <button className="text-xs text-accent-dark hover:underline" onClick={() => setOpen({ sid: s.id, cid: c.id })}>
                          精修
                        </button>
                        <ConfirmButton
                          className="text-xs text-muted hover:text-bad hover:underline"
                          label="删除"
                          confirmLabel="确定"
                          onConfirm={async () => {
                            await api(`/albums/${a.id}/stickers/${s.id}/candidates/${c.id}`, { method: 'DELETE' });
                            if (open?.cid === c.id) setOpen(null);
                            album.reload();
                          }}
                        />
                      </span>
                    </div>
                    {c.error && <div className="max-w-[170px] text-xs text-bad">{c.error}</div>}
                  </div>
                ))}
              </div>
            )}
            {open?.sid === s.id && (
              <Tuner
                album={a}
                s={s}
                c={s.candidates.find((x) => x.id === open.cid)!}
                dark={dark}
                onClose={() => setOpen(null)}
                onChanged={album.reload}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function CandBadges({ c }: { c: Candidate }) {
  const r = c.report;
  if (!r) return <Badge ok={null}>未处理</Badge>;
  return (
    <span className="flex flex-wrap gap-1">
      <Badge ok={r.width === 240 && r.height === 240}>240²</Badge>
      <Badge ok={r.bytes <= 500 * 1024}>{kb(r.bytes)}</Badge>
      <Badge ok={r.frames > 1 && r.loop}>{r.frames}帧</Badge>
    </span>
  );
}

/** 在精灵图原图上点格子，选出要用的帧（表情不对、照抄参考图的格子去掉） */
function FramePicker({ src, grid, sel, onChange }: { src: string; grid: SpriteGrid; sel: number[]; onChange: (v: number[]) => void }) {
  const n = grid.cols * grid.rows;
  const cells = Array.from({ length: n }, (_, k) => k + 1);
  const all = sel.length === 0;
  const on = (i: number) => (all ? i <= grid.frames : sel.includes(i));
  const toggle = (i: number) => {
    const cur = all ? cells.filter((k) => k <= grid.frames) : sel;
    const next = cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort((a, b) => a - b);
    onChange(next.length ? next : [i]);
  };
  return (
    <div className="w-[240px]">
      <div className="label flex justify-between">
        <span>用哪几帧（点格子切换）</span>
        <span>{all ? '全部' : `${sel.length} 帧`}</span>
      </div>
      <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-line bg-white">
        <img src={src} className="absolute inset-0 h-full w-full" alt="" />
        <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${grid.cols}, 1fr)`, gridTemplateRows: `repeat(${grid.rows}, 1fr)` }}>
          {cells.map((i) => (
            <button key={i} onClick={() => toggle(i)} className={`relative border border-white/70 transition ${on(i) ? 'hover:bg-accent/10' : 'bg-white/75 hover:bg-white/60'}`} title={on(i) ? '点一下不用这一帧' : '点一下用这一帧'}>
              <span className={`absolute top-0.5 left-0.5 rounded px-1 text-[10px] ${on(i) ? 'bg-accent text-white' : 'bg-line text-muted'}`}>{i}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
        <button className="text-accent-dark hover:underline" onClick={() => onChange([])}>
          全部
        </button>
        <button className="text-accent-dark hover:underline" onClick={() => onChange(cells.slice(Math.floor(n / 2)))}>
          只用后半段
        </button>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">去掉表情不对、照抄参考图的格子，再点「重新处理」。动作接不回第一帧时，勾上「正放+倒放」。</p>
    </div>
  );
}

function Tuner({ album, s, c, dark, onClose, onChanged }: { album: Album; s: StickerItem; c: Candidate; dark: boolean; onClose: () => void; onChanged: () => void }) {
  const [p, setP] = useState<ProcessSettings>(c.settings);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (patch: Partial<ProcessSettings>) => setP({ ...p, ...patch });

  const apply = async () => {
    setBusy(true);
    setErr('');
    try {
      await api(`/albums/${album.id}/stickers/${s.id}/candidates/${c.id}/process`, { body: p });
      onChanged();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const app = useApp();
  const regen = async () => {
    setErr('');
    try {
      const backend = c.backend === 'manual' ? defaultBackend(app.status) : c.backend;
      if (!backend) throw new Error('还没有填任何平台的 Key，手动导入的候选只能在「批量生成」里手动再做一张');
      await api(`/albums/${album.id}/generate`, { body: { stickerIds: [s.id], backend, variants: 1 } });
      location.hash = '/generate';
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const num = (label: string, k: keyof ProcessSettings, min: number, max: number, step = 1) => (
    <label className="block">
      <span className="label flex justify-between">
        <span>{label}</span>
        <span>{String(p[k] ?? '原始')}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={Number(p[k] ?? 0)} onChange={(e) => set({ [k]: Number(e.target.value) } as any)} className="w-full accent-[#ff7a90]" />
    </label>
  );

  return (
    <div className="mt-4 grid gap-4 rounded-2xl bg-cream p-4 md:grid-cols-[auto_1fr_1fr]">
      <div className="space-y-2">
        <ChatPreview dark={dark} src={fileUrl(c.processedPath)} size={160} />
        <div className="flex gap-2">
          <a className="btn" href={fileUrl(c.rawPath)} target="_blank">
            看原图
          </a>
          <ConfirmButton
            label="删除"
            onConfirm={async () => {
              await api(`/albums/${album.id}/stickers/${s.id}/candidates/${c.id}`, { method: 'DELETE' });
              onClose();
              onChanged();
            }}
          />
        </div>
        {c.mode === 'sprite' && <FramePicker src={fileUrl(c.rawPath)} grid={p.spriteGrid ?? { cols: 3, rows: 3, frames: 9 }} sel={p.frameSel ?? []} onChange={(v) => set({ frameSel: v })} />}
      </div>
      <div className="space-y-3">
        <div className="text-sm font-medium">字幕</div>
        <input className="input" value={p.caption} onChange={(e) => set({ caption: e.target.value })} placeholder="画面字，留空则不加" />
        <div className="flex gap-2">
          <select className="input" value={p.textAnim} onChange={(e) => set({ textAnim: e.target.value as any })}>
            <option value="bounce">轻弹</option>
            <option value="pop">弹出</option>
            <option value="shake">抖动</option>
            <option value="static">静止</option>
          </select>
          <input type="color" className="h-9 w-12 rounded-lg border border-line" value={p.textColor} onChange={(e) => set({ textColor: e.target.value })} title="字色" />
          <input type="color" className="h-9 w-12 rounded-lg border border-line" value={p.strokeColor} onChange={(e) => set({ strokeColor: e.target.value })} title="描边色" />
        </div>
        {num('字号', 'fontSize', 28, 64, 2)}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={p.textMode === 'overlay'} onChange={(e) => set({ textMode: e.target.checked ? 'overlay' : 'none' })} /> 叠加字幕
        </label>
      </div>
      <div className="space-y-3">
        <div className="text-sm font-medium">画面与节奏</div>
        <select className="input" value={p.keyMode} onChange={(e) => set({ keyMode: e.target.value as any })}>
          <option value="flood">抠背景（只抠外圈，推荐）</option>
          <option value="global">抠背景（同色全抠）</option>
          <option value="none">保留原背景</option>
        </select>
        {num('抠图阈值', 'keyThreshold', 10, 120, 2)}
        {num('四周留白 %', 'padding', 0, 20)}
        <label className="block">
          <span className="label flex justify-between">
            <span>每帧时长</span>
            <span>{p.frameDurationMs ? `${p.frameDurationMs}ms` : '原始'}</span>
          </span>
          <input type="range" min={0} max={300} step={10} value={p.frameDurationMs ?? 0} onChange={(e) => set({ frameDurationMs: Number(e.target.value) || null })} className="w-full accent-[#ff7a90]" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={p.pingpong} onChange={(e) => set({ pingpong: e.target.checked })} /> 正放+倒放（动作接不回第一帧时用，免费多一倍帧）
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={p.stabilize} onChange={(e) => set({ stabilize: e.target.checked })} /> 对齐各帧（精灵图抖动时用）
        </label>
        <div className="flex flex-wrap gap-2 pt-1">
          <button className="btn-primary" disabled={busy} onClick={apply}>
            {busy ? '处理中…' : '重新处理（免费）'}
          </button>
          <button className="btn" onClick={regen}>
            再生成一个
          </button>
          <button className="btn" onClick={onClose}>
            收起
          </button>
        </div>
        <ErrorText msg={err} />
        {c.report && (
          <details className="text-xs text-muted">
            <summary className="cursor-pointer">处理记录</summary>
            <ul className="mt-1 list-disc pl-4">
              {c.report.steps.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
