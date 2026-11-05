import { db, now, save, spentCny } from './store';
import type { Job } from './types';

/** 按张计价：单价在设置里（元） */
export function costKey(job: Job) {
  return `${job.backend}:${db.settings.providers[job.backend].imageModel}:${job.kind}`;
}

export function estimateJobCny(job: Job): number {
  return db.settings.providers[job.backend]?.pricePerImage ?? 0;
}

const active = (j: Job) => j.status === 'queued' || j.status === 'running';

export function budgetStatus() {
  const limited = db.settings.budgetLimit;
  const budget = db.settings.providerBudgetCny;
  const spent = spentCny();
  const queued = db.jobs.filter(active);
  const queuedEstimate = queued.reduce((s, j) => s + estimateJobCny(j), 0);
  return { limited, budget, spent, queuedEstimate, remaining: budget - spent, queuedCount: queued.length };
}

/** 启用上限时：新加入的任务会不会让 已花 + 排队中 + 新任务 超出预算。没启用就不拦 */
export function assertAffordable(newJobs: Job[]) {
  const st = budgetStatus();
  if (!st.limited) return;
  const extra = newJobs.reduce((s, j) => s + estimateJobCny(j), 0);
  if (extra > 0 && st.spent + st.queuedEstimate + extra > st.budget + 1e-9) {
    const left = Math.max(0, st.budget - st.spent - st.queuedEstimate);
    const err = new Error(
      `超出预算上限：已花约 ¥${st.spent.toFixed(2)}，排队中约 ¥${st.queuedEstimate.toFixed(2)}，这批约 ¥${extra.toFixed(2)}，上限 ¥${st.budget}。还能用约 ¥${left.toFixed(2)}。可以少选几张，或在「设置」里调高上限、关掉上限，或者清零花费记录。`,
    ) as Error & { status: number };
    err.status = 400;
    throw err;
  }
}

/** 队列启动任务前再检查一次（只在启用上限时） */
export function canStart(job: Job) {
  if (!db.settings.budgetLimit) return true;
  return spentCny() + estimateJobCny(job) <= db.settings.providerBudgetCny + 1e-9;
}

/** 成功出一张图记一笔（失败的平台不收费，也不记） */
export function recordSpendCny(job: Job): number {
  const cny = estimateJobCny(job);
  db.spendCny.push({ jobId: job.id, cny, at: now(), what: costKey(job) });
  save();
  return cny;
}

/** 清零花费记录（比如在平台充值、对完账之后重新开始算） */
export function resetSpend() {
  db.spendCny = [];
  save();
}
