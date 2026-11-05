import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertAffordable, budgetStatus, canStart, resetSpend } from '../server/budget';
import { DATA, db } from '../server/store';
import type { Job } from '../server/types';

const job = (id: string): Job => ({ id, kind: 'sticker', backend: 'bailian', mode: 'sprite', status: 'queued', prompt: '', createdAt: '' });

describe('预算', () => {
  it('测试用的是临时数据目录', () => {
    expect(DATA).not.toBe(path.resolve(import.meta.dirname, '..', 'data'));
  });

  it('没启用上限：只估算，不拦任务', () => {
    db.settings.budgetLimit = false;
    db.settings.providerBudgetCny = 1;
    db.settings.providers.bailian.pricePerImage = 0.4;
    db.spendCny = [{ jobId: 'a', cny: 5, at: '', what: '' }];
    expect(budgetStatus()).toMatchObject({ limited: false, spent: 5 });
    expect(() => assertAffordable([job('x'), job('y')])).not.toThrow();
    expect(canStart(job('x'))).toBe(true);
  });

  it('启用上限：超出时拦下；清零后又能用', () => {
    db.settings.budgetLimit = true;
    db.settings.providerBudgetCny = 1;
    db.spendCny = [{ jobId: 'a', cny: 5, at: '', what: '' }];
    expect(() => assertAffordable([job('x')])).toThrow(/超出预算上限/);
    expect(canStart(job('x'))).toBe(false);
    resetSpend();
    expect(budgetStatus().spent).toBe(0);
    expect(() => assertAffordable([job('x')])).not.toThrow();
  });
});
