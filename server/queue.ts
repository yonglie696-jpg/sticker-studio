import { canStart } from './budget';
import { ProviderError } from './generators/cnProviders';
import { PROVIDER_IDS, PROVIDER_INFO } from './providerInfo';
import { runJob } from './service';
import { db, now, save } from './store';
import type { Job } from './types';

/**
 * 持久化任务队列：每个平台各自限并发、限速（见设置）。
 * 欠费、Key 无效时暂停这个平台，等用户处理后在设置里保存 Key，或者重新点生成。
 */
const running: Record<string, number> = {};
const lastStart: Record<string, number> = {};
/** 各平台的暂停原因（空字符串 = 没暂停） */
export const paused: Record<string, string> = {};

export function resume(backend: string) {
  paused[backend] = '';
}

// 服务重启时，之前跑到一半的任务重新排队
for (const j of db.jobs) if (j.status === 'running') j.status = 'queued';

function tick() {
  const s = db.settings;
  const limit = Math.max(1, s.providerConcurrency);
  const gap = Math.max(0, s.providerMinIntervalSec) * 1000;
  for (const backend of PROVIDER_IDS) {
    if (paused[backend]) continue;
    while ((running[backend] ?? 0) < limit && Date.now() - (lastStart[backend] ?? 0) >= gap) {
      const job = db.jobs.find((j) => j.status === 'queued' && j.backend === backend);
      if (!job) break;
      if (!canStart(job)) {
        paused[backend] = `预算 ¥${s.providerBudgetCny} 快用完了，${PROVIDER_INFO[backend].label} 队列已暂停（可在设置里调整预算）`;
        break;
      }
      start(job);
    }
  }
}

function start(job: Job) {
  const b = job.backend;
  running[b] = (running[b] ?? 0) + 1;
  lastStart[b] = Date.now();
  job.status = 'running';
  job.startedAt = now();
  job.error = undefined;
  save();
  runJob(job)
    .then(() => {
      if (job.status === 'running') job.status = 'done';
    })
    .catch((e: Error) => {
      job.status = 'error';
      job.error = e?.message ?? String(e);
      if (e instanceof ProviderError && e.blocking) paused[b] = `${PROVIDER_INFO[b].label} 队列已暂停：${job.error}`;
    })
    .finally(() => {
      running[b]--;
      job.finishedAt = now();
      save();
    });
}

setInterval(tick, 1000).unref?.();

export function retryJob(id: string) {
  const j = db.jobs.find((x) => x.id === id);
  if (j && (j.status === 'error' || j.status === 'canceled')) {
    j.status = 'queued';
    j.error = undefined;
    paused[j.backend] = '';
    save();
  }
  return j;
}

export function cancelJob(id: string) {
  const j = db.jobs.find((x) => x.id === id);
  if (j && j.status === 'queued') {
    j.status = 'canceled';
    save();
  }
  return j;
}

export function clearFinished() {
  db.jobs = db.jobs.filter((j) => j.status === 'queued' || j.status === 'running');
  save();
}
