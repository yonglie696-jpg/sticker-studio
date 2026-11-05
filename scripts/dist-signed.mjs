// 带签名打包 Windows 安装包。证书放在本机证书库（当前用户 → 个人），这里只按指纹去找，不需要 .pfx 和密码。
// 指纹来源：环境变量 WIN_CERT_SHA1，或 signing/local.json 里的 certificateSha1（signing/ 不进 git）。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

let sha1 = process.env.WIN_CERT_SHA1;
if (!sha1 && fs.existsSync('signing/local.json')) sha1 = JSON.parse(fs.readFileSync('signing/local.json', 'utf8')).certificateSha1;
if (!sha1) {
  console.error('没找到签名证书指纹：设置环境变量 WIN_CERT_SHA1，或在 signing/local.json 里写 {"certificateSha1":"..."}');
  process.exit(1);
}

const r = spawnSync('npx', ['electron-builder', '--win', 'nsis', `-c.win.signtoolOptions.certificateSha1=${sha1.trim()}`], {
  stdio: 'inherit',
  shell: true,
});
process.exit(r.status ?? 1);
