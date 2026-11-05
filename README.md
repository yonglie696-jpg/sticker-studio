# 表情包工坊（公开版）

用国内大模型（阿里云百炼、火山方舟）或豆包 / 即梦 App 做原创角色动态表情，自动处理成符合微信表情开放平台规范的 GIF，并导出可以直接上传的「上架包」。

## 下载

不想自己编译的话，到右侧的 [Releases](../../releases) 下载 `表情包工坊-安装包-<版本号>.exe`，双击安装即可（仅 Windows 64 位）。

## 启动

在这个文件夹里：

```bash
npm run dev
```

浏览器打开 http://localhost:5173 。第一次打开要先同意用户须知，再走「连接模型」向导。

## 三种出图方式

1. **阿里云百炼**（默认推荐）：用千问图像模型出 3×3 精灵图，带角色参考图保持一致
2. **火山方舟**：用豆包 Seedream 出精灵图（专用条款 3.1 的商用许可还在确认）
3. **手动**：复制提示词到豆包 / 即梦 App 里生成，再把图拖回来，不花钱

Key 由用户自己填，只存在本机数据目录的 `secrets.json`，请求从用户电脑直接发给平台，不经过我们。

## 合规相关（已内置）

- 不带起步角色，必须自建原创角色；IP 拦截词、相似度检查
- 导出的 GIF / PNG / JPG 写入 AI 生成的隐式标识（GB 45438 字段），`上架信息.txt` 附 AI 声明
- 没有任何去水印、照片转表情功能

## 目录

- `server/`：后端（平台适配、后期流水线、微信规范检查、导出）
- `server/presets/`：选题库（职场打工人、日常通用回应）和拦截词表
- `web/`：前端（React + Tailwind）
- `data/`：角色、专辑、生成的图、导出包、Key（本机，不要外传，也不要打进安装包）
- `scripts/smoke.ts`：不花钱的端到端冒烟测试

## 命令

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run smoke
```

最后这个需要先启动 `npm run dev`。

## 打包成 Windows 安装包

```bash
npm run dist:win
```

安装包生成在 `release/表情包工坊-安装包-<版本号>.exe`。

- 安装包里只有 `desktop/`、`dist/`、`server-dist/`、`server/presets`、`server/fonts` 和运行依赖，**不包括 `data/`**（你的 Key 和作品）、`scripts/`、`tests/`
- 装好的软件把数据存在用户自己电脑的 `%APPDATA%\表情包工坊\data`，第一次打开是全新状态；卸载时不会删除这些数据
- 后端只监听本机 127.0.0.1，不会弹防火墙提示，局域网里的其他电脑也访问不到
- 没有代码签名证书，所以 Windows 第一次运行时可能提示“Windows 已保护你的电脑”，点「更多信息」→「仍要运行」即可
- 改版本号：改 `package.json` 里的 `version`

如果第一次装依赖时 Electron 下载卡住（一直 0 字节），通常是电脑要走代理。可以设置下面两个环境变量后，再运行 `node node_modules/electron/install.js`：

```bash
set ELECTRON_GET_USE_PROXY=1
```

```bash
set GLOBAL_AGENT_HTTPS_PROXY=http://127.0.0.1:<你的代理端口>
```

## 字体

画面字用站酷快乐体（ZCOOL KuaiLe），SIL Open Font License，可商用，许可证见 `server/fonts/OFL.txt`。
