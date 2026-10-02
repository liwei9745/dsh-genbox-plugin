# 安装、配置与排错

本文把 `dsh-genbox-plugin` 装进一个 DSH profile 并跑通的完整步骤。所有命令都在
`E:\AI\GenBox-dsh` 下验证过（Windows / Node 24 / pnpm 12）。

## 0. 前置条件

| 需要 | 说明 |
|---|---|
| GenBox 在运行 | 默认 `http://127.0.0.1:8892`。源码启动见 [local-dev.md](./local-dev.md) |
| 至少一个已启用的 provider | 生图/改图/生视频都需要；`genbox_image_upscale` 除外 |
| `dsh` CLI 在 PATH | 本机为 `C:\Users\18722\AppData\Roaming\npm\dsh.ps1` |
| 真正的 `pnpm` 在 PATH | `dsh plugin` 内部调用 pnpm，仅装 corepack 不够，见排错第 1 条 |

## 1. 安装

### 方式 A：tarball（推荐给不联网发布的场景）

```powershell
cd E:\AI\GenBox-dsh
corepack pnpm install
corepack pnpm run build
corepack pnpm pack                      # dsh-genbox-plugin-0.1.0.tgz
dsh plugin --profile genbox-dev add ./dsh-genbox-plugin-0.1.0.tgz
```

### 方式 B：源码挂载（开发迭代最快）

```powershell
dsh --profile genbox-dev --patch E:/AI/GenBox-dsh/dev/overlay.cordis.yml
```

### 方式 C：发布后的 npm 包

```powershell
dsh plugin --profile genbox-dev add dsh-genbox-plugin
```

### 建一个独立 profile（不要直接动 desktop）

```powershell
dsh --profile genbox-dev --from-default-profile web
```

## 2. 验证安装

```powershell
# 组合结果里应当出现插件层
dsh --profile genbox-dev --dump-config | Select-String genbox

# 真启动一次；出现下面这行说明插件已被宿主加载
dsh --profile genbox-dev --port 3099 --no-open
#   [genbox] plugin loaded (baseUrl=http://127.0.0.1:8892)
#   dsh web: http://127.0.0.1:3099/?token=...
```

`dsh plugin add` 会自动把包名写进 profile 的 `dsh.profile.bundles`：

```json
{
  "dependencies": { "dsh-genbox-plugin": "file:E:/AI/GenBox-dsh/dsh-genbox-plugin-0.1.0.tgz" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-genbox-plugin"] } }
}
```

## 3. 在会话里使用

插件注册了 10 个工具（见 README 的工具表）。典型对话：

- “用 GenBox 画一只在雪地里的柴犬，1024x1024” → `genbox_image_generate`
- “把这张图的背景换成沙滩” → `genbox_image_edit`（`i2i` 或 `inpaint` + mask）
- “生成一段 5 秒的日落实拍视频” → `genbox_video_generate`
- “看下 GenBox 里最近的素材” → `genbox_gallery`

生成的文件地址会返回给模型，模型可以再用 `read_image` 打开确认。

## 4. 配置

配置写在 profile 的层里。改 bundle 自带的那一层，或在 profile 的 `cordis.patch.yml` 里覆盖同名行：

```yaml
- id: genbox
  name: dsh-genbox-plugin
  config:
    baseUrl: 'http://127.0.0.1:8892'
    adminKey: ''            # APP_MODE=prod 时需要
    defaultProviderId: ''
    outputDir: '.genbox'
    pollIntervalMs: 2000
    taskTimeoutMs: 900000
```

注意：patch 会**整体替换**该行的 `config`，覆盖时要重述需要保留的键。

## 5. 排错

### 1) `dsh plugin` 报 pnpm 找不到

`dsh plugin` 转发命令给真正的 pnpm。若只装了 corepack，在 PATH 上放一个转发 shim：

```text
C:\Users\<you>\AppData\Roaming\npm\pnpm.cmd
@echo off
corepack pnpm %*
```

### 2) 所有生图请求都失败，报 `Invalid port: ':1]'`

GenBox 用 httpx 发请求，而宿主导出的 `NO_PROXY` 里带 `[::1]`，httpx 0.28 解析即崩。
在 GenBox 的 venv 里放一个 `sitecustomize.py` 剔除带方括号的条目，详见 [local-dev.md](./local-dev.md)。

### 3) 报 `无可用的生图模型` / `无可用的视频生成模型`

GenBox 里没有已启用且配了 Key 的对应 provider。用 `genbox_providers` 先看一遍，再去 GenBox 界面配置。

### 4) `inpaint_provider_unsupported`

GenBox 的局部重绘要求 provider **同时**满足两点：声明 `capabilities.inpaint_mask = true`，
且 `endpoint_type = openai`。只满足一条也会被拒——实测 `gpt-image` 声明了 mask，但 `endpoint_type=auto`，
一样报这个错。被拒时插件会直接列出**当前满足全部条件**的 provider；`genbox_providers` 也能看到每个 provider 的 `endpointType`。

**这类拒绝是可修的，而且我们实测修通过**：

1. 在 GenBox → 设置 → 该 provider 里，把 `endpoint_type` 从 `auto` 改成 `openai`（只有一个字段）；
2. 命令行改也可以：编辑 `storage/providers.json` 里该条的 `endpoint_type`，然后
   `curl -X POST http://127.0.0.1:8892/api/providers/reload`；
3. 之后再用同样的 `image` + `mask` 调 `genbox_image_edit`（`mode: "inpaint"`）即可。

实测记录（`gpt-image` / `gpt-image-2-vip`，1024×1024 底图 + 白框掩膜）：

```
status: completed | took 62.6s
file: .genbox-out/real-inpaint/gpt-image_20261002_231748_inpaint_replace_the_marked_pap_b06078.png
     1024x1024, 1,168,239 B —— 白框内的纸灯笼被换成热气球，湖面/远山/天空保持不变
```

> 为什么 `auto` 会被拒？因为 GenBox 的校验是**声明式**的静态门禁（`main.py:1504-1510`），
> 即使 `auto` 在运行时本来就会解析成 openai 协议（生成状态里的 `request_contract.protocol` 会显示
> `openai`），它也不认。所以翻这个字段是行为中性的，只是把"隐含的 openai"变成"明示的 openai"。

### 5) `precision_edit_provider_unsupported`

GenBox 要求该 provider 的 `capabilities.precision_edit = true`（模型需是它认可的改图模型）。
这**不是**必须真实 Key：仓库自带的 mock provider 就声明了该能力，可以直接跑通这条链路；
真实 provider 则需要在 GenBox 里完成它的验证流程。被拒时插件会列出当前真正可用的 provider。

### 6) `cutout_model_missing`

GenBox 发布包不含 ONNX 抠图 checkpoint，需要操作者手动放置并通过完整性检查。

### 7) 装进 desktop profile 后没生效

桌面端只在启动时读 profile，需要重启 DSH NEXT。装之前建议先在独立 profile 验证。

### 8) 工具报 `GenBox is not answering at http://127.0.0.1:8892`

GenBox 没在运行，或者 `baseUrl` 指错了端口。先启动 GenBox（见 [local-dev.md](./local-dev.md) 第 2 节），
再用 `genbox_open_workbench` 确认工作台 URL 能打开；`genbox_doctor` 会把整条链路逐项检查一遍。

### 9) `pnpm run build` 报 `拒绝访问。 (os error 5)`

构建输出目录偶尔会被系统写成「管理员组所有」，导致 `--clean` 删不掉旧文件。用包装脚本重建即可：

```powershell
powershell -File .\scripts\rebuild.ps1
```

### 10) `npm publish` 返回 403，提到 two-factor authentication

账号开了 2FA 时发布必须带一次性验证码：`npm publish --otp=<code>`，或使用一个明确允许绕过 2FA 的
granular access token。

## 6. 卸载

```powershell
dsh plugin --profile genbox-dev remove dsh-genbox-plugin
```