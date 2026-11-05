// 把后端 TypeScript 打成一个 JS 文件（server-dist/index.mjs），给桌面版用。依赖包不打进来，运行时从 node_modules 加载。
import { build } from 'esbuild';

await build({
  entryPoints: ['server/index.ts'],
  outfile: 'server-dist/index.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  logLevel: 'info',
});
