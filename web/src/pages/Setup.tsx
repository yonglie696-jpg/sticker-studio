import { useState } from 'react';
import { useApp } from '../App';
import { api, useData, type ProviderId, type Settings } from '../api';
import { PROVIDER_INFO } from '../backends';
import { ErrorText, PageHeader } from '../components/ui';

/** 用户须知：公开版第一次打开必须同意 */
const TERMS = [
  '你设计的角色必须是原创的：不要模仿已有的动漫、品牌、吉祥物形象，也不要用真人照片或真人肖像。',
  '本软件只是在你的电脑上，用你自己账号的 Key 调用模型平台。Key 只保存在你的电脑上，不会上传给我们。不要把 Key 发给任何人，也不要转借、出售自己的 Key 或账号（这违反平台协议）。',
  '模型费用由你和平台直接结算，按平台规则计费。新用户的免费额度、有效期和单价以平台控制台为准。',
  '生成的图片由你负责检查和使用。发布时请按《人工智能生成合成内容标识办法》和平台规则声明“AI 生成”。软件导出的图片里会写入 AI 生成的隐式标识，请不要删除。',
  '软件不保证你的表情一定能通过微信审核，也不承诺任何收益。',
];

type Choice = ProviderId | 'manual';

export default function Setup() {
  const app = useApp();
  const st = app.status;
  const settings = useData<Settings>('/settings');
  const [agree, setAgree] = useState(false);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [err, setErr] = useState('');

  if (!st) return null;

  if (!st.agreed) {
    return (
      <div className="max-w-3xl">
        <PageHeader title="欢迎使用表情包工坊" sub="开始之前，请先读完下面几条。" />
        <div className="card space-y-3">
          <div className="font-display text-xl">用户须知</div>
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed">
            {TERMS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            我已阅读并同意
          </label>
          <button
            className="btn-primary"
            disabled={!agree}
            onClick={async () => {
              try {
                await api('/setup/agree', { body: {} });
                app.reloadStatus();
                location.hash = '/setup';
              } catch (e: any) {
                setErr(e.message);
              }
            }}
          >
            同意，下一步
          </button>
          <ErrorText msg={err} />
        </div>
      </div>
    );
  }

  const cur: Choice = choice ?? settings.data?.defaultProvider ?? 'bailian';
  const pick = async (c: Choice) => {
    setChoice(c);
    if (c !== 'manual') await api('/settings', { method: 'PUT', body: { defaultProvider: c } }).catch(() => {});
  };

  const cards: { v: Choice; title: string; desc: string; tag?: string }[] = [
    { v: 'bailian', title: PROVIDER_INFO.bailian.label, desc: PROVIDER_INFO.bailian.imageNote, tag: '推荐' },
    { v: 'ark', title: PROVIDER_INFO.ark.label, desc: PROVIDER_INFO.ark.imageNote },
    { v: 'manual', title: '先不填 Key', desc: '复制提示词到豆包或即梦 App 里免费出图，再把图拖回来。慢一点，但一分钱不花' },
  ];

  return (
    <div className="max-w-4xl">
      <PageHeader title="连接模型" sub="选一种出图方式。以后随时可以在「设置」里改，或者几种一起用。" />
      <div className="mb-5 grid gap-3 md:grid-cols-3">
        {cards.map((c) => (
          <button
            key={c.v}
            onClick={() => pick(c.v)}
            className={`card text-left transition ${cur === c.v ? 'ring-2 ring-accent' : 'hover:ring-1 hover:ring-accent/50'}`}
          >
            <div className="flex items-center gap-2">
              <span className="font-display text-lg">{c.title}</span>
              {c.tag && <span className="chip bg-accent text-white">{c.tag}</span>}
              {c.v !== 'manual' && st.providers[c.v as ProviderId]?.hasKey && <span className="chip bg-[#e2f5ec] text-ok">已填 Key</span>}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted">{c.desc}</p>
          </button>
        ))}
      </div>
      {cur === 'manual' ? <ManualGuide /> : <KeyGuide key={cur} p={cur} />}
      <div className="mt-5 flex gap-2">
        <a href="#/character" className="btn-primary">
          好了，去设计角色 →
        </a>
      </div>
    </div>
  );
}

function KeyGuide({ p }: { p: ProviderId }) {
  const app = useApp();
  const info = PROVIDER_INFO[p];
  const ps = app.status?.providers[p];
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);

  const saveAndTest = async () => {
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
  };

  return (
    <div className="card space-y-4">
      <div className="font-display text-xl">获取{info.label}的 API Key</div>
      {info.termsNote && <p className="rounded-lg bg-[#fdf0dc] px-3 py-2 text-sm text-warn">{info.termsNote}</p>}
      <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed">
        {info.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        {info.site && (
          <a className="btn" href={info.site} target="_blank" rel="noreferrer">
            打开{info.short}控制台 ↗
          </a>
        )}
        {info.keyPage && (
          <a className="btn" href={info.keyPage} target="_blank" rel="noreferrer">
            打开 API Key 页面 ↗
          </a>
        )}
      </div>
      <div>
        <span className="label">粘贴 API Key（只保存在这台电脑上）</span>
        <div className="flex gap-2">
          <input
            className="input"
            type="password"
            autoComplete="off"
            placeholder={ps?.hasKey ? `已填 ${ps.keyHint}，填新的会覆盖` : 'sk-...'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button className="btn-primary whitespace-nowrap" disabled={busy || (!key.trim() && !ps?.hasKey)} onClick={saveAndTest}>
            {busy ? '测试中…' : key.trim() ? '保存并测试' : '测试连接'}
          </button>
        </div>
        {result && <p className={`mt-2 rounded-lg px-3 py-2 text-sm ${result.ok ? 'bg-[#e2f5ec] text-ok' : 'bg-[#fde4e8] text-bad'}`}>{result.detail}</p>}
      </div>
      <p className="text-xs leading-relaxed text-muted">
        测试连接用的是文字模型，只花几分钱甚至不花钱。生图模型的名字和单价在「设置」里可以改；第一次正式出图前，建议先在平台控制台确认这个模型已经开通。
      </p>
    </div>
  );
}

function ManualGuide() {
  return (
    <div className="card space-y-3 text-sm leading-relaxed">
      <div className="font-display text-xl">不填 Key 怎么用</div>
      <ol className="list-decimal space-y-2 pl-5">
        <li>在「角色工坊」写好角色设定，点「复制设定图提示词」，粘贴到豆包或即梦 App 里生成，把满意的图拖回来，设为参考图</li>
        <li>在「批量生成」选「手动」，每张表情点「复制提示词」，到 App 里生成一张 3×3 的精灵图（9 格动作），下载后拖回对应的格子</li>
        <li>软件会自动切帧、抠背景、加字、压缩成符合微信规范的 GIF</li>
      </ol>
      <p className="rounded-lg bg-cream px-3 py-2 text-xs text-muted">
        提醒：免费出图的 App 可能会在图上加可见的“AI 生成”水印，请不要用工具去掉它；生成内容能不能商用，以 App 的用户协议为准。
      </p>
    </div>
  );
}
