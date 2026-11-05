import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../App';
import { api, charLen, useData, type Album, type Preset, type StickerItem, type TextAnim } from '../api';
import { ConfirmButton, ErrorText, PageHeader } from '../components/ui';

const ANIMS: { v: TextAnim; label: string }[] = [
  { v: 'bounce', label: '轻弹' },
  { v: 'pop', label: '弹出' },
  { v: 'shake', label: '抖动' },
  { v: 'static', label: '静止' },
];

export default function AlbumPlanner() {
  const app = useApp();
  const presets = useData<Preset[]>('/presets');
  const album = useData<Album>(app.albumId ? `/albums/${app.albumId}` : null);
  const [err, setErr] = useState('');
  const c = app.characters.find((x) => x.id === app.characterId);

  const createAlbum = async (presetId: string) => {
    try {
      const a = await api<Album>('/albums', { body: { characterId: app.characterId, presetId } });
      app.reloadLists();
      app.setAlbumId(a.id);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  if (!c) return <p className="text-muted">先去「角色工坊」建一个角色。</p>;

  return (
    <div>
      <PageHeader
        title="选题企划"
        sub="一套 8～24 张。每张只表达一个意思：一个夸张动作 + ≤4 字含义词。"
        right={
          <div className="flex gap-2">
            {app.albumId && (
              <ConfirmButton
                label="删除当前专辑"
                hint="连同所有生成的图，不可恢复"
                onConfirm={async () => {
                  await api(`/albums/${app.albumId}`, { method: 'DELETE' });
                  app.setAlbumId('');
                  app.reloadLists();
                }}
              />
            )}
            {presets.data?.map((p) => (
              <button key={p.id} className="btn" onClick={() => createAlbum(p.id)}>
                + 新专辑（{p.name}）
              </button>
            ))}
          </div>
        }
      />
      <ErrorText msg={err} />
      {!app.albumId && <p className="text-muted">点右上角新建一个专辑，会自动带上推荐的 24 张选题。</p>}
      {album.data && presets.data && <Planner key={album.data.id} album={album.data} preset={presets.data.find((p) => p.id === album.data!.presetId) ?? presets.data[0]} onSaved={app.reloadLists} />}
    </div>
  );
}

/** 让文字模型按主题补充选题；结果先列出来，点一下才加入 */
function AiIdeas({ albumId, used, onAdd }: { albumId: string; used: Set<string>; onAdd: (s: Partial<StickerItem>) => void }) {
  const [theme, setTheme] = useState('');
  const [ideas, setIdeas] = useState<Partial<StickerItem>[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const list = ideas.filter((s) => !used.has(s.meaning ?? ''));
  return (
    <div className="card space-y-2">
      <div className="font-display text-lg">AI 补充选题</div>
      <div className="flex gap-2">
        <input className="input" placeholder="方向，例如：考研党、带娃日常、追星" value={theme} onChange={(e) => setTheme(e.target.value)} />
        <button
          className="btn whitespace-nowrap"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr('');
            try {
              setIdeas(await api(`/albums/${albumId}/ai-ideas`, { body: { theme, count: 8 } }));
            } catch (e: any) {
              setErr(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? '想点子中…' : '想几个'}
        </button>
      </div>
      <ErrorText msg={err} />
      {!!list.length && (
        <div className="flex flex-wrap gap-1.5">
          {list.map((s) => (
            <button key={s.meaning} className="chip bg-accent-soft text-accent-dark hover:bg-accent hover:text-white" title={s.action} onClick={() => onAdd(s)}>
              + {s.meaning}
            </button>
          ))}
        </div>
      )}
      {!!list.length && <p className="text-[11px] text-muted">鼠标停在上面能看到动作；加进来以后还能改。</p>}
    </div>
  );
}

function Planner({ album, preset, onSaved }: { album: Album; preset: Preset; onSaved: () => void }) {
  const [items, setItems] = useState<StickerItem[]>(album.stickers);
  const [state, setState] = useState<'saved' | 'dirty' | 'saving'>('saved');
  const [err, setErr] = useState('');
  const timer = useRef<number>(0);

  const update = (next: StickerItem[]) => {
    setItems(next);
    setState('dirty');
    clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      setState('saving');
      try {
        await api(`/albums/${album.id}`, { method: 'PUT', body: { stickers: next } });
        setState('saved');
        setErr('');
        onSaved();
      } catch (e: any) {
        setErr(e.message);
        setState('dirty');
      }
    }, 600);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const meanings = items.map((s) => s.meaning.trim());
  const used = new Set(meanings);
  const library = preset.stickers.filter((s) => !used.has(s.meaning));
  const count = items.length;
  const actionDupes = useMemo(() => {
    const seen = new Map<string, number>();
    items.forEach((s) => seen.set(s.action.slice(0, 6), (seen.get(s.action.slice(0, 6)) ?? 0) + 1));
    return seen;
  }, [items]);

  const set = (i: number, patch: Partial<StickerItem>) => update(items.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const n = [...items];
    [n[i], n[j]] = [n[j], n[i]];
    update(n);
  };
  const add = (s: Partial<StickerItem>) =>
    update([
      ...items,
      {
        id: `new_${Math.random().toString(36).slice(2, 10)}`,
        meaning: s.meaning ?? '',
        caption: s.caption ?? s.meaning ?? '',
        action: s.action ?? '',
        emotion: s.emotion ?? '',
        scene: s.scene ?? '',
        group: s.group ?? '自定义',
        textAnim: s.textAnim ?? 'bounce',
        candidates: [],
      },
    ]);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-display text-xl">
            这套的 {count} 张 <span className={`text-sm ${count < 8 || count > 24 ? 'text-bad' : 'text-ok'}`}>{count < 8 ? '（至少 8 张）' : count > 24 ? '（最多 24 张）' : '✓'}</span>
          </div>
          <span className="text-xs text-muted">{state === 'saved' ? '已自动保存' : state === 'saving' ? '保存中…' : '有改动…'}</span>
        </div>
        <ErrorText msg={err} />
        <div className="grid grid-cols-[28px_92px_92px_1fr_80px_76px] gap-2 border-b border-line pb-1 text-xs text-muted">
          <span />
          <span>含义词 ≤4</span>
          <span>画面字</span>
          <span>动作（越具体越好）</span>
          <span>情绪</span>
          <span>字幕动效</span>
        </div>
        <div className="divide-y divide-line">
          {items.map((s, i) => {
            const dup = meanings.indexOf(s.meaning.trim()) !== i;
            const long = charLen(s.meaning) > 4 || !s.meaning.trim();
            const sameAction = (actionDupes.get(s.action.slice(0, 6)) ?? 0) > 1 && s.action.length > 0;
            return (
              <div key={s.id} className="grid grid-cols-[28px_92px_92px_1fr_80px_76px] items-start gap-2 py-2">
                <div className="flex flex-col items-center text-xs text-muted">
                  <button onClick={() => move(i, -1)} className="hover:text-accent">▲</button>
                  <span>{i + 1}</span>
                  <button onClick={() => move(i, 1)} className="hover:text-accent">▼</button>
                </div>
                <div>
                  <input className={`input ${dup || long ? 'border-bad' : ''}`} value={s.meaning} onChange={(e) => set(i, { meaning: e.target.value })} />
                  {(dup || long) && <div className="mt-0.5 text-[11px] text-bad">{dup ? '重复了' : '1–4 个字'}</div>}
                </div>
                <input className="input" value={s.caption} onChange={(e) => set(i, { caption: e.target.value })} />
                <div>
                  <textarea className={`input min-h-[38px] ${sameAction ? 'border-warn' : ''}`} rows={1} value={s.action} onChange={(e) => set(i, { action: e.target.value })} />
                  <div className="mt-0.5 flex justify-between text-[11px] text-muted">
                    <span>
                      {s.group} · {s.scene || '何时发？'}
                    </span>
                    <span className="flex gap-2">
                      {sameAction && <span className="text-warn">动作和别的张太像</span>}
                      {!!s.candidates.length && <span>{s.candidates.length} 个候选</span>}
                      {s.candidates.length ? (
                        <ConfirmButton
                          className="text-bad hover:underline"
                          label="移除"
                          confirmLabel="确定移除"
                          hint="已有候选图"
                          onConfirm={() => update(items.filter((_, k) => k !== i))}
                        />
                      ) : (
                        <button className="text-bad hover:underline" onClick={() => update(items.filter((_, k) => k !== i))}>
                          移除
                        </button>
                      )}
                    </span>
                  </div>
                </div>
                <input className="input" value={s.emotion} onChange={(e) => set(i, { emotion: e.target.value })} />
                <select className="input px-1" value={s.textAnim} onChange={(e) => set(i, { textAnim: e.target.value as TextAnim })}>
                  {ANIMS.map((a) => (
                    <option key={a.v} value={a.v}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
        <button className="btn mt-3" onClick={() => add({})}>
          + 自定义一张
        </button>
      </div>

      <div className="space-y-4">
        <AiIdeas albumId={album.id} used={used} onAdd={add} />
        <div className="card">
          <div className="mb-2 font-display text-lg">受众洞察 · {preset.name}</div>
          <p className="mb-2 text-xs text-muted">{preset.audience}</p>
          <ul className="list-disc space-y-1.5 pl-4 text-sm">
            {preset.insight.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
        <div className="card">
          <div className="mb-2 font-display text-lg">选题库（点一下加入）</div>
          {preset.groups.map((g) => {
            const list = library.filter((s) => s.group === g.name);
            if (!list.length) return null;
            return (
              <div key={g.name} className="mb-3">
                <div className="text-xs font-medium">{g.name}</div>
                <div className="mb-1 text-[11px] text-muted">{g.why}</div>
                <div className="flex flex-wrap gap-1.5">
                  {list.map((s) => (
                    <button key={s.meaning} className="chip bg-accent-soft text-accent-dark hover:bg-accent hover:text-white" title={s.action} onClick={() => add(s)}>
                      + {s.meaning}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {!library.length && <p className="text-sm text-muted">预设选题都加进来了。</p>}
        </div>
      </div>
    </div>
  );
}
