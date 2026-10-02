# 本地开发与联调环境

本文记录在 `E:\AI\GenBox-dsh` 里跑通「插件 → GenBox」闭环的每一步，包含本机特有的**环境坑**及其修复。

## 1. 依赖

| 组件 | 版本 | 备注 |
|---|---|---|
| Node | v24.13.1 | |
| pnpm | 通过 `corepack pnpm` 使用 | 本机没有全局 pnpm |
| Python | **3.11.15**（uv 管理） | 本机默认 `python` 是 3.14.3，GenBox 钉的 pydantic 2.13 / pillow 12.3 未在 3.14 上验证，**不要用它** |
| GenBox | v2.6.12（master `02ce25e`） | `upstream/GenBox` |

## 2. 启动 GenBox（开发模式）

```powershell
# 一次性：建 venv 并装依赖
cd E:\AI\GenBox-dsh\upstream\GenBox
uv venv --python 3.11 .venv
uv pip install --python .venv\Scripts\python.exe -r requirements.txt

# 每次启动：dev 模式 + 8892 端口
$env:APP_MODE='dev'; $env:GENBOX_PORT='8892'; $env:GENBOX_NO_BROWSER='1'
.\.venv\Scripts\python.exe main.py
```

- `APP_MODE=dev` 时**不需要 `X-Admin-Key`**，且 uvicorn 只绑定 `127.0.0.1`。
- `APP_MODE` 缺省是 `prod`，此时必须有 `ADMIN_KEY`，否则启动直接被阻断。
- 源码运行不会自动开浏览器（只有 `sys.frozen` 为真时才会）。

## 3. ⚠️ 本机环境坑：`NO_PROXY` 里的 `[::1]` 会打崩 httpx

**现象**：任何一次生图都失败，错误是

```
[Mock OpenAI] 所有端点均失败: 端点 1 [FAILED]: [Mock OpenAI] Invalid port: ':1]'
```

**根因**：DSH 宿主进程向子进程导出了

```
NO_PROXY=169.254.198.80,172.17.0.1,192.168.200.195,.local,localhost,127.0.0.1,::1,[::1]
```

CPython 的 `urllib.request.getproxies()` 会把这些条目原样放进 `no` 键，`httpx` 0.28 在构造
`AsyncClient` 时把 `[::1]` 当 `host:port` 解析，抛 `InvalidURL: Invalid port: ':1]'`。
**这跟 mock provider 无关**——它在 httpx 客户端构造阶段就崩，对任何真实 provider 一样会崩。

**修复**（只影响本 venv，不改 GenBox 代码）：在 `.venv\Lib\site-packages\sitecustomize.py` 里把带方括号的条目剔除：

```python
import os
for name in ("NO_PROXY", "no_proxy"):
    value = os.environ.get(name)
    if not value or "[" not in value:
        continue
    os.environ[name] = ",".join(p for p in value.split(",") if not p.strip().startswith("["))
```

> 这是环境侧 workaround，不属于插件交付物。更根本的修法是 GenBox 在未配置代理时用
> `httpx.AsyncClient(trust_env=False)`，或上游修复 no_proxy 解析。

## 4. 免 Key 的端到端联调（mock provider）

不花钱、不需要任何 API Key 就能验证整条链路：

```powershell
# a) 起一个 OpenAI 兼容的假图床（用 venv 里的 Pillow，按请求尺寸返回纯色 PNG）
E:\AI\GenBox-dsh\upstream\GenBox\.venv\Scripts\python.exe E:\AI\GenBox-dsh\scripts\mock-openai-image.py

# b) 把它注册成 GenBox 的 image provider
$body = @{ id='mock-openai'; name='Mock OpenAI'; type='image'; api_key='sk-mock';
           base_url='http://127.0.0.1:8899'; model='mock-image-1'; models=@('mock-image-1');
           size='512x512'; enabled=$true; capabilities=@{ t2i=$true; i2i=$true };
           endpoint_type='openai' } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri 'http://127.0.0.1:8892/api/providers' -Method POST -Body $body -ContentType 'application/json'

# c) 跑插件级验证
cd E:\AI\GenBox-dsh
corepack pnpm install; corepack pnpm run build
node scripts\verify-all.mjs
```

`verify-all.mjs` 会在缺少前置条件时如实 SKIP：GenBox 没起时只跑不需要它的套件。

## 5. 真实 provider

在 GenBox 界面（`http://127.0.0.1:8892`）里配置 provider 与 Key，或复用现有 `storage/providers.json`。
插件侧不需要改任何东西：`genbox_providers` 会列出已启用的 provider。

## 6. 插件级验证脚本

| 脚本 | 作用 |
|---|---|
| `scripts/verify-all.mjs` | **入口**：跑全部套件，缺前置条件就 SKIP，最后汇总 PASS/FAIL |
| `scripts/verify-annotate.mjs` | 批注渲染（纯 JS PNG 编码器）与坐标契约 |
| `scripts/verify-video-edit.mjs` | 本地 ffmpeg 的 11 种剪辑操作 |
| `scripts/verify-doctor.mjs` | 自检工具的输出与判定 |
| `scripts/verify-tools.mjs` | 生图 + 改图端到端（需 GenBox + mock provider） |
| `scripts/verify-background.mjs` / `verify-media.mjs` / `verify-gallery-filters.mjs` | 后台任务、图库与提示词、图库过滤 |
| `scripts/verify-precision.mjs` | 精准改图批注端到端 |
| `scripts/verify-presentation.mjs` | UI 渲染意图契约（12 项断言） |
| `scripts/verify-onboarding.mjs` | 首装引导：工作台工具 + doctor 的 next-steps |
| `scripts/verify-native-jobs.mjs` | 实验性 `ctx.jobs` 集成（桩 registry） |
| `scripts/mock-openai-image.py` | OpenAI 兼容假图床（`/v1/images/generations` 与 `/v1/images/edits`） |
| `scripts/probe-httpx.py` | 诊断 httpx 代理问题 |

## 7. 把插件装进一个 DSH profile（已实测）

`dsh plugin` 内部会调用真正的 `pnpm`，只有 `corepack` 是不够的。本机建了一个转接 shim：

```powershell
# C:\Users\18722\AppData\Roaming\npm\pnpm.cmd
@echo off
corepack pnpm %*
```

然后建一个**独立** profile（不要动正在用的 `desktop`）：

```powershell
dsh --profile genbox-dev --from-default-profile web     # 从随附模板初始化
dsh plugin --profile genbox-dev add E:/AI/GenBox-dsh    # 装成本地 bundle
dsh --profile genbox-dev --dump-config | Select-String genbox
dsh --profile genbox-dev --port 3099                    # 实机启动
```

- 因为包声明了 `dsh.bundle`，`dsh plugin add` 会自动把它追加进 `dsh.profile.bundles`。
- `--dump-config` 里应出现 `# == dsh-genbox-plugin` 层与 `- id: genbox` 行。
- 从 npm 安装（`dsh plugin add dsh-genbox-plugin`）时，peer 会从 profile 的 `node_modules` 正常解析。
- 要装进 Desktop（`--profile desktop`）需要重启 DSH NEXT 才生效；该 profile 由 Electron 应用独占管理，CLI 拒绝写入。

## 8. 已知环境问题：构建目录被系统收走权限

**现象**：`pnpm run build` 报 `拒绝访问。 (os error 5)`（rolldown 的 `--clean` 删不掉旧输出），
`Remove-Item -Recurse -Force lib` 同样失败。

**诊断**（用会话自带的 `diagnose-windows-sandbox-acl` 技能脚本跑的）：

```
PATH=E:\AI\GenBox-dsh\lib
  OWNER=S-1-5-32-544 (BUILTIN\Administrators)  IS_CURRENT_USER=False
  MY_RIGHTS=[]  WRITE_DAC=False  WRITE_OWNER=False
VERDICT=PRECONDITION     REPAIR_REFUSED (needs WRITE_DAC)
```

这个目录的所有者变成了「管理员组」，当前用户没有任何权限，脚本也就无法自动修权限。

**应急绕过**：`scripts/rebuild.ps1` 会自动检测这种情况（输出目录里的文件所有者不是当前用户时），
把它改名搬走再构建——因为仓库根目录给了当前用户删除子项的权限，搬走不需要管理员：

```powershell
powershell -File .\scripts\rebuild.ps1
```

**彻底清理**（需要管理员权限的 PowerShell）：

```powershell
takeown /f 'E:\AI\GenBox-dsh\lib-locked-<日期>' /r /d y
icacls 'E:\AI\GenBox-dsh\lib-locked-<日期>' /grant "$env:USERNAME:(F)" /t
Remove-Item -Recurse -Force 'E:\AI\GenBox-dsh\lib-locked-<日期>'
```

诊断原始记录保存在 `.lab/acl-report/acl-report-*.jsonl`（已 gitignore）。

## 9. 推送到 GitHub 需要走代理

本机访问 `github.com` 有时会被重置（`Recv failure: Connection was reset`），走系统代理（Clash 在 `127.0.0.1:7897`）更稳：

```powershell
cd E:\AI\GenBox-dsh
git config --local http.proxy http://127.0.0.1:7897
git config --local https.proxy http://127.0.0.1:7897
git push -u origin main
```

推送凭据不要在 URL 里带 token（失败时 git 会把整条 URL 打到终端上，等于泄露）。
`scripts/publish.mjs` 现在改用 `http.extraheader` 传递凭据。

## 10. GitHub CLI（便携安装，不改系统）

winget 在这台机器上连不上源，所以 `gh` 用便携包安装：下载 GitHub 官方的
`gh_<version>_windows_amd64.zip`，解压到 `E:\AI\tools\gh`，直接用
`E:\AI\tools\gh\bin\gh.exe`。**不写系统 PATH、不做机器级安装。**

登录（浏览器一次性授权）：

```powershell
E:\AI\tools\gh\bin\gh.exe auth login      # GitHub.com -> HTTPS -> Login with a web browser
```

**临时代理**（只对当前终端窗口有效，关掉即失效，不写任何配置文件）：

```powershell
$env:HTTP_PROXY = 'http://127.0.0.1:7897'
$env:HTTPS_PROXY = 'http://127.0.0.1:7897'
```

用 gh 的凭据推送（同样是单次生效，不动全局 git 配置）：

```powershell
cd E:\AI\GenBox-dsh
git -c credential.helper="!E:/AI/tools/gh/bin/gh.exe auth git-credential" push -u origin main
```

加仓库标签：

```powershell
E:\AI\tools\gh\bin\gh.exe repo edit liwei9745/dsh-genbox-plugin --add-topic dsh-plugin --add-topic deepseek-harness
```
