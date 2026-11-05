import { useEffect, useState } from 'react';
import { useApp } from '../App';
import { api, fileUrl, upload, useData, type Character, type CharacterSpec, type GenBackend, type Job } from '../api';
import { defaultBackend, genBackends, MANUAL_TOOLS } from '../backends';
import { ConfirmButton, CopyButton, DropZone, ErrorText, Field, PageHeader, Seg } from '../components/ui';
import { JobList } from './GenerateQueue';

const EMPTY_SPEC: CharacterSpec = { species: '', body: '', colors: '', features: '', accessories: '', style: '扁平 2D 卡通贴纸风，均匀的深色粗描边，平涂上色，线条圆润', personality: '' };

const SPEC_FIELDS: { k: keyof CharacterSpec; label: string; hint?: string }[] = [
  { k: 'species', label: '形态 / 物种', hint: '写明“原创形象”，避免像已有 IP' },
  { k: 'body', label: '体型比例', hint: '建议 2–2.5 头身，圆润，表情包缩小后也好认' },
  { k: 'colors', label: '配色（带 hex 色值）', hint: '主色 + 腮红 + 描边色，粗深色描边在浅色/深色聊天里都清楚' },
  { k: 'features', label: '五官与标志特征' },
  { k: 'accessories', label: '配饰（可选）', hint: '一个固定小配饰能大大提高辨识度' },
  { k: 'style', label: '画风' },
  { k: 'personality', label: '性格', hint: '决定动作怎么演：嘴硬心软、慢吞吞、元气…' },
];

export default function CharacterLab() {
  const app = useApp();
  const c = app.characters.find((x) => x.id === app.characterId);
  const [err, setErr] = useState('');
  const [idea, setIdea] = useState('');
  const [thinking, setThinking] = useState(false);
  const [warn, setWarn] = useState<string[]>([]);

  const create = async (name: string, spec: CharacterSpec) => {
    try {
      const nc = await api<Character>('/characters', { body: { name, spec } });
      app.reloadLists();
      app.setCharacterId(nc.id);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const aiDesign = async () => {
    setErr('');
    setWarn([]);
    setThinking(true);
    try {
      const r = await api<{ name: string; spec: CharacterSpec; warnings: string[] }>('/ai/character', { body: { idea } });
      setWarn(r.warnings);
      await create(r.name, { ...EMPTY_SPEC, ...r.spec });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setThinking(false);
    }
  };

  return (
    <div>
      <PageHeader title="角色工坊" sub="先定下一个原创角色：同一个角色出一套又一套，用户才会记住、追着买。" />
      <div className="card mb-5 space-y-3">
        <div>
          <div className="mb-1 text-sm font-medium">一句话描述你想要的角色，让 AI 帮你写设定（写完可以随便改）</div>
          <div className="flex gap-2">
            <input className="input" maxLength={200} placeholder="例如：一只爱睡懒觉、说话慢吞吞的橘色小狐狸" value={idea} onChange={(e) => setIdea(e.target.value)} />
            <button className="btn-primary whitespace-nowrap" disabled={thinking || !idea.trim()} onClick={aiDesign}>
              {thinking ? '设计中…' : 'AI 帮我设计'}
            </button>
          </div>
          <p className="mt-1 text-xs text-muted">要用这个功能，需要在「设置」里给一个平台填好 Key 和文字模型。不用 AI 也行，点下面的「空白角色」自己写。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn" onClick={() => create('新角色', EMPTY_SPEC)}>
            + 空白角色
          </button>
        </div>
        {warn.map((w) => (
          <p key={w} className="rounded-lg bg-[#fdf0dc] px-3 py-2 text-sm text-warn">
            {w}
          </p>
        ))}
        <ErrorText msg={err} />
      </div>
      {c ? <Editor key={c.id} c={c} /> : <p className="text-muted">先在上面新建一个角色。</p>}
    </div>
  );
}

function Editor({ c }: { c: Character }) {
  const app = useApp();
  const [name, setName] = useState(c.name);
  const [spec, setSpec] = useState(c.spec);
  const [dna, setDna] = useState(c.dna);
  const [chosen, setBackend] = useState<GenBackend | null>(null);
  const backend = chosen ?? defaultBackend(app.status);
  const options = genBackends(app.status);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const jobs = useData<Job[]>(`/jobs?characterId=${c.id}`, 3000);
  const running = (jobs.data ?? []).some((j) => j.status === 'queued' || j.status === 'running');
  const albumCount = app.albums.filter((a) => a.characterId === c.id).length;

  useEffect(() => {
    // 任务完成后刷新角色（新概念图/参考图）
    if (!running) app.reloadLists();
  }, [running]);

  const save = async (extra: Partial<Character> = {}) => {
    setErr('');
    try {
      const r = await api<Character>(`/characters/${c.id}`, { method: 'PUT', body: { name, spec, ...(c.locked ? { dna } : {}), ...extra } });
      setDna(r.dna);
      app.reloadLists();
      return r;
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const job = async (kind: 'concept' | 'reference', count: number) => {
    setErr('');
    setBusy(true);
    try {
      await save();
      await api(`/characters/${c.id}/jobs`, { body: { kind, backend, count } });
      jobs.reload();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-display text-xl">设定卡</div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={c.locked} onChange={(e) => save({ locked: e.target.checked })} />
            锁定角色 DNA
          </label>
        </div>
        <Field label="角色名（≤8 字，也是微信「表情形象」名称）" value={name} onChange={setName} max={8} />
        {SPEC_FIELDS.map((f) => (
          <Field key={f.k} label={f.label} hint={f.hint} value={spec[f.k]} multiline onChange={(v) => setSpec({ ...spec, [f.k]: v })} />
        ))}
        <div className="flex gap-2">
          <button className="btn-primary" onClick={() => save()}>
            保存设定
          </button>
          <span className="ml-auto">
            <ConfirmButton
              label="删除角色"
              hint={`连同 ${albumCount} 个专辑和所有图，不可恢复`}
              onConfirm={async () => {
                try {
                  await api(`/characters/${c.id}`, { method: 'DELETE' });
                  app.setCharacterId('');
                  app.reloadLists();
                } catch (e: any) {
                  setErr(e.message);
                }
              }}
            />
          </span>
        </div>
        <div>
          <span className="label">角色 DNA（每张表情的提示词都原样带上这一段{c.locked ? '，已锁定，可以手动微调' : '，由上面的设定自动生成'}）</span>
          <textarea className="input min-h-[170px] font-mono text-xs" value={dna} readOnly={!c.locked} onChange={(e) => setDna(e.target.value)} />
        </div>
        <ErrorText msg={err} />
      </div>

      <div className="space-y-4">
        <div className="card space-y-3">
          <div className="font-display text-xl">出图</div>
          {backend ? (
            <>
              <Seg value={backend} onChange={setBackend} options={options} />
              <div className="flex flex-wrap gap-2">
                <button className="btn" disabled={busy} onClick={() => job('concept', 2)}>
                  出 2 张概念设定图
                </button>
                <button className="btn" disabled={busy} onClick={() => job('reference', 1)}>
                  出参考图
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">
              还没有填任何平台的 Key。<a className="text-accent-dark underline" href="#/setup">去连接模型</a>，或者用下面的提示词手动出图。
            </p>
          )}
          <p className="text-xs text-muted">
            每张按平台单价计费（单价在「设置」里能看到）。也可以在 {MANUAL_TOOLS} 里自己生成后拖进来：
          </p>
          <div className="flex gap-2">
            <CopyButton label="复制设定图提示词" getText={async () => (await api(`/characters/${c.id}/prompt/concept`)).prompt} />
            <CopyButton label="复制参考图提示词" getText={async () => (await api(`/characters/${c.id}/prompt/reference`)).prompt} />
          </div>
          <DropZone small label="拖入概念图" onFile={async (f) => (await upload(`/characters/${c.id}/concepts`, f), app.reloadLists())} />
          {!!jobs.data?.length && <JobList jobs={jobs.data} onChange={jobs.reload} compact />}
        </div>

        <div className="card">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-display text-xl">参考图</div>
            <span className="text-xs text-muted">做精灵图、封面、图标用</span>
          </div>
          {c.referencePng ? (
            <img src={fileUrl(c.referencePng)} className="checker mx-auto w-48 rounded-xl" alt="" />
          ) : (
            <p className="text-sm text-muted">还没有。出一张透明参考图，或在下面的概念图上点「设为参考图」。</p>
          )}
          <div className="mt-2">
            <DropZone small label="拖入参考图（会自动抠背景、居中）" onFile={async (f) => (await upload(`/characters/${c.id}/reference`, f), app.reloadLists())} />
          </div>
        </div>
      </div>

      {!!c.concepts.length && (
        <div className="card lg:col-span-2">
          <div className="mb-3 font-display text-xl">概念设定图</div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {c.concepts.map((p) => (
              <div key={p} className="space-y-2">
                <img src={fileUrl(p)} className="w-full rounded-xl border border-line" alt="" />
                <div className="flex gap-1.5">
                  <button
                    className="btn flex-1"
                    onClick={async () => {
                      await api(`/characters/${c.id}/reference-from-concept`, { body: { path: p } });
                      app.reloadLists();
                    }}
                  >
                    设为参考图
                  </button>
                  <ConfirmButton
                    label="删除"
                    confirmLabel="确定"
                    onConfirm={async () => {
                      await api(`/characters/${c.id}/concepts/delete`, { body: { path: p } });
                      app.reloadLists();
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
