# 架构与目录

> 给贡献者：这个插件内部是怎么组织的、一次工具调用经过哪些环节、以及加一个新工具要动哪里。

## 一张图

```
DSH agent
  │  tools.*（参数校验 → execute）
  ▼
src/index.ts           注册 14 个工具（apply(ctx, config)）
  │
  ├── src/tools/*.ts   每个工具的：parameters / output.render / execute
  │        │
  │        └── src/client.ts   唯一的 HTTP 出口（GenBoxClient）
  │                 │
  │                 └── HTTP ──▶ GenBox FastAPI (127.0.0.1:8892)
  │
  ├── src/media.ts     产出落盘、路径、provider 列表
  ├── src/annotate.ts  纯 JS 的 PNG 编码器 + 批注几何 → GenBox 规范化坐标
  └── src/config.ts    Schemastery 配置（profile 补丁层可覆盖）
```

插件**只通过 HTTP 调用** GenBox，不引入它的源码（GPL-3.0 边界）。因此 GenBox 可以独立升级。

## 目录

| 路径 | 职责 |
|---|---|
| `src/index.ts` | 插件入口：导出 `name` / `inject` / `Config`，`apply()` 里注册全部工具 |
| `src/config.ts` | 配置 schema：`baseUrl`、`adminKey`、`outputDir`、轮询/超时、ffmpeg 路径、`nativeJobs` |
| `src/client.ts` | `GenBoxClient`：`json()` / `status()` / `waitFor()` / `download()`，以及错误措辞与容错 |
| `src/media.ts` | `resolveOutputDir`、文件名生成、data URL 归一化、`listProviders` |
| `src/annotate.ts` | PNG 编码（zlib + CRC）、箭头/方框/椭圆/画笔画布、坐标归一化、图片尺寸读取 |
| `src/json.ts` | 规范 JSON 值的类型别名 |
| `src/tools/providers.ts` | `genbox_providers`、`genbox_health` |
| `src/tools/image.ts` | `genbox_image_generate`、`genbox_image_edit`（含批注/掩膜） |
| `src/tools/image-extra.ts` | 超分、变体、抠图 |
| `src/tools/video.ts` | `genbox_video_generate`（含 `background` 与实验性 `nativeJobs`） |
| `src/tools/video-edit.ts` | `genbox_video_edit`：11 种本地 ffmpeg 操作 |
| `src/tools/task.ts` | `genbox_task`：收取/取消 GenBox 侧的后台任务 |
| `src/tools/media.ts` | `genbox_gallery`（含过滤）、`genbox_prompt_optimize` |
| `src/tools/doctor.ts` | `genbox_doctor`：逐项自检 + next-steps |
| `src/tools/workbench.ts` | `genbox_open_workbench`：报告/打开 GenBox 自己的工作台 |
| `cordis.patch.yml` | bundle 补丁：往 profile 里 `insert` 一行 `id: genbox` |
| `scripts/verify-*.mjs` | 全部验证套件，由 `verify-all.mjs` 统一驱动 |

## 一次工具调用的生命周期

1. **参数校验**由 `defineTool` 的 `parameters` schema 完成（DSH 侧）。非法参数不会进到 `execute`。
2. `execute(args, exec)` 组装请求体，必要时把本地图片/data URL 归一化成 GenBox 要的形状。
3. `client.json()` 发出请求；**失败时**要么是「连不上」（给出可执行的提示），要么是 HTTP 失败（引用响应体里的人话）。
4. 长任务：`client.waitFor()` 轮询到终态。**掉一两次 poll 不会失败**（5xx/429/408/网络抖动可容忍，4xx 立即失败）。
5. 产出：`client.download()` 写入 `outputDir`，工具把**绝对路径**返回给模型；模型可用 `read_image` 直接看。
6. 取消：`exec.signal` 一路透传到 `fetch`；取消**不会**被包装成「连不上」。

## 三个横切关注点（都在 `src/client.ts`）

- **错误措辞** `describeFailure()`：GenBox 的失败体有 `{"detail": "..."}`、`{"detail": {"error", "message"}}`、`{"error", "message"}` 等形状，取其句子，必要时附错误码。
- **轮询容错** `waitFor()`：连续可重试失败超过 `toleratedFailures`（默认 5）才放弃；永久性 4xx 立即抛。
- **连通性判定** `transportError()`：`ECONNREFUSED/ENOTFOUND/ECONNRESET` 等归为「GenBox 没有应答」，并指向 `genbox_open_workbench` / `genbox_doctor`。

## bundle 是怎么生效的

`package.json` 声明 `dsh.bundle.patch = ./cordis.patch.yml`，补丁内容：

```yaml
- insert:
    - id: genbox
      name: dsh-genbox-plugin
      config:
        baseUrl: 'http://127.0.0.1:8892'
        outputDir: '.genbox'
```

- **必须用 `insert:` 包裹**：直接写 `- id: genbox` 会被当成「覆盖已存在的行」并报 `patch: entry "genbox" not found`（实测过）。
- 补丁替换整行 `config`：想保留默认值就要在补丁里重申它们。
- `name` 写包名，Node 从 profile 的 `node_modules` 解析；本地开发可以写绝对路径（`file:///.../lib/index.js`）。

## 加一个新工具

1. 在 `src/tools/` 里加文件，用 `defineTool({ name, description, parameters, output, execute })`。
2. 在 `src/index.ts` 的 `apply()` 里注册。
3. `description` 是写给模型看的：说明**什么时候该用它**，而不只是它做什么。
4. 返回值是规范 JSON；`output.render` 只影响人类可读的那一行。产出文件请放进 `locations`（`presentResult`）。
5. 补验证：放进 `scripts/verify-*.mjs`，并在 `verify-all.mjs` 注册（注明前置条件 `genbox` / `ffmpeg` / `market` / `installed`）。
6. `corepack pnpm exec tsc --noEmit` + `node scripts/verify-all.mjs` 全绿再提交。

## 验证阶梯

| 层 | 命令 | 覆盖 |
|---|---|---|
| 套件 | `node scripts/verify-all.mjs` | **20 个套件**；缺前置条件如实 SKIP |
| 用户旅程 | 同上（`verify-journey.mjs`） | 自检 → 生图 → 图生图 → 精准改图 → 后台生视频 → 收取 → **取消** → 本地剪辑 → 图库 |
| 真实 provider | `GENBOX_REAL_PROVIDER=gpt-image node scripts/verify-real-provider.mjs` | 真花钱的那一条：真图 + 真改图，默认 SKIP |
| 发布回读 | `node scripts/verify-published.mjs` | registry 上的版本/关键字/tarball 内容 |
| 装出来的产物 | `DSH_PROFILE_DIR=<profile> node scripts/verify-installed-package.mjs` | 已安装包与仓库构建的工具集一致 |
| 市场就绪 | `node scripts/verify-market-readiness.mjs` | 用**市场自己的模块**判定 host 兼容与 profile 预检 |
| CI | GitHub Actions | install / typecheck / build / ffmpeg / `verify-all` |
