import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000,
    pool: 'forks',
    // 测试用临时数据目录，绝不碰 data/（里面有用户的 Key 和作品）
    env: { STUDIO_DATA_DIR: path.join(os.tmpdir(), 'sticker-studio-public-test') },
  },
});
