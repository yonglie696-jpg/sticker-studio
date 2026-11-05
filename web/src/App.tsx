import { createContext, useContext, useEffect, useState } from 'react';
import { cny, useData, useLocal, type Album, type Character, type Status } from './api';
import { PROVIDER_IDS, PROVIDER_INFO } from './backends';
import AlbumPlanner from './pages/AlbumPlanner';
import CharacterLab from './pages/CharacterLab';
import GenerateQueue from './pages/GenerateQueue';
import ReviewBoard from './pages/ReviewBoard';
import SettingsPage from './pages/Settings';
import Setup from './pages/Setup';
import SubmissionKit from './pages/SubmissionKit';

export type { Status };

interface Ctx {
  characterId: string;
  setCharacterId: (id: string) => void;
  albumId: string;
  setAlbumId: (id: string) => void;
  characters: Character[];
  albums: Album[];
  reloadLists: () => void;
  status: Status | null;
  reloadStatus: () => void;
  go: (route: string) => void;
}
const AppCtx = createContext<Ctx>(null as any);
export const useApp = () => useContext(AppCtx);

const STEPS = [
  { route: 'character', n: '1', title: '角色工坊', sub: '设计原创形象' },
  { route: 'plan', n: '2', title: '选题企划', sub: '含义词与动作' },
  { route: 'generate', n: '3', title: '批量生成', sub: '国内模型 / 手动' },
  { route: 'review', n: '4', title: '挑选精修', sub: '聊天里看效果' },
  { route: 'kit', n: '5', title: '上架包', sub: '检查并导出' },
];

function useRoute(): [string, (r: string) => void] {
  const get = () => location.hash.replace(/^#\/?/, '') || 'character';
  const [r, setR] = useState(get);
  useEffect(() => {
    const on = () => setR(get());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return [r, (nr: string) => (location.hash = `/${nr}`)];
}

export default function App() {
  const [route, go] = useRoute();
  const [characterId, setCharacterId] = useLocal('characterId', '');
  const [albumId, setAlbumId] = useLocal('albumId', '');
  const chars = useData<Character[]>('/characters');
  const albums = useData<Album[]>('/albums');
  const status = useData<Status>('/status', 5000);

  const reloadLists = () => {
    chars.reload();
    albums.reload();
  };
  const curAlbums = (albums.data ?? []).filter((a) => a.characterId === characterId);

  useEffect(() => {
    if (!chars.data) return;
    if (!chars.data.find((c) => c.id === characterId) && chars.data[0]) setCharacterId(chars.data[0].id);
  }, [chars.data]);
  useEffect(() => {
    if (!albums.data) return;
    if (!curAlbums.find((a) => a.id === albumId)) setAlbumId(curAlbums[0]?.id ?? '');
  }, [albums.data, characterId]);

  const ctx: Ctx = {
    characterId,
    setCharacterId,
    albumId,
    setAlbumId,
    characters: chars.data ?? [],
    albums: albums.data ?? [],
    reloadLists,
    status: status.data,
    reloadStatus: status.reload,
    go,
  };
  const st = status.data;
  // 第一次打开：先读用户须知、连接模型
  const page = st && !st.agreed ? 'setup' : route;
  const pausedMsgs = PROVIDER_IDS.map((p) => st?.providers?.[p]?.paused).filter(Boolean);
  const b = st?.budget;

  return (
    <AppCtx.Provider value={ctx}>
      <div className="flex h-full">
        <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-paper">
          <div className="px-5 pt-5 pb-4">
            <div className="font-display text-2xl text-accent-dark">表情包工坊</div>
            <div className="text-xs text-muted">AI 动态表情 × 微信表情上架</div>
          </div>
          <div className="space-y-2 px-4 pb-4">
            <select className="input" value={characterId} onChange={(e) => setCharacterId(e.target.value)}>
              {!ctx.characters.length && <option value="">还没有角色</option>}
              {ctx.characters.map((c) => (
                <option key={c.id} value={c.id}>
                  角色：{c.name}
                </option>
              ))}
            </select>
            <select className="input" value={albumId} onChange={(e) => setAlbumId(e.target.value)}>
              {!curAlbums.length && <option value="">还没有专辑</option>}
              {curAlbums.map((a) => (
                <option key={a.id} value={a.id}>
                  专辑：{a.name}（{a.stickers.length} 张）
                </option>
              ))}
            </select>
          </div>
          <nav className="flex-1 space-y-1 px-3">
            {STEPS.map((s) => (
              <a
                key={s.route}
                href={`#/${s.route}`}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition ${page === s.route ? 'bg-accent-soft text-accent-dark' : 'hover:bg-cream'}`}
              >
                <span className={`grid h-7 w-7 place-items-center rounded-full text-sm font-bold ${page === s.route ? 'bg-accent text-white' : 'bg-cream text-muted'}`}>{s.n}</span>
                <span>
                  <span className="block font-medium">{s.title}</span>
                  <span className="block text-xs text-muted">{s.sub}</span>
                </span>
              </a>
            ))}
          </nav>
          <a href="#/setup" className={`mx-3 mb-1 rounded-xl px-3 py-2 text-sm ${page === 'setup' ? 'bg-accent-soft text-accent-dark' : 'text-muted hover:bg-cream'}`}>
            🔑 连接模型（向导）
          </a>
          <a href="#/settings" className={`mx-3 mb-2 rounded-xl px-3 py-2 text-sm ${page === 'settings' ? 'bg-accent-soft text-accent-dark' : 'text-muted hover:bg-cream'}`}>
            ⚙ 设置与预算
          </a>
          <div className="m-3 mt-0 rounded-xl bg-cream p-3 text-xs leading-relaxed">
            {b?.limited ? (
              <>
                <div className="flex justify-between">
                  <span className="text-muted">预算上限</span>
                  <b>
                    {cny(b.spent)} / {cny(b.budget)}
                  </b>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
                  <div className="h-full bg-accent" style={{ width: `${Math.min(100, (b.spent / (b.budget || 1)) * 100)}%` }} />
                </div>
              </>
            ) : (
              <div className="flex justify-between">
                <span className="text-muted">估算花费</span>
                <b>{cny(b?.spent)}</b>
              </div>
            )}
            <div className="mt-2 space-y-0.5">
              {PROVIDER_IDS.filter((p) => p !== 'custom' || st?.providers?.custom?.hasKey).map((p) => (
                <div key={p} className="flex justify-between">
                  <span className="text-muted">{PROVIDER_INFO[p].label}</span>
                  <span className={st?.providers?.[p]?.hasKey ? 'text-ok' : 'text-muted'}>{st?.providers?.[p]?.hasKey ? `已填 ${st.providers[p].keyHint}` : '未填 Key'}</span>
                </div>
              ))}
            </div>
            {pausedMsgs.map((m) => (
              <div key={m} className="mt-2 text-warn">
                {m}
              </div>
            ))}
          </div>
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-8 py-7">
            {page === 'setup' && <Setup />}
            {page === 'character' && <CharacterLab />}
            {page === 'plan' && <AlbumPlanner />}
            {page === 'generate' && <GenerateQueue />}
            {page === 'review' && <ReviewBoard />}
            {page === 'kit' && <SubmissionKit />}
            {page === 'settings' && <SettingsPage />}
          </div>
        </main>
      </div>
    </AppCtx.Provider>
  );
}
