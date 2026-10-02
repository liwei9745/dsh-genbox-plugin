# 教程：把 GenBox 变成 DSH agent 的媒体生成后端

> 可对外发布的教程。目标：让 DSH 里的 agent 能直接「画一张图」「改这张图」「生成一段视频」「剪一段视频」，
> 底层用本机已经在跑的开源项目 [GenBox](https://github.com/liwei9745/GenBox) 提供多模型能力。

## 0. 为什么用插件而不是塞进提示词

DSH 的插件就是「导出 `apply(ctx)` 的 TypeScript 模块」，通过 `ctx.tools.register` 把能力注册成模型能调用的工具。
相比让模型去 `curl` 一个接口，插件还能拿到：参数校验、类型化返回值、错误处理，以及 UI 渲染意图与后台任务支持。

## 1. 前置：让 GenBox 跑起来

```powershell
cd <GenBox 检出目录>
uv venv --python 3.11 .venv                 # 不要用 3.14（GenBox 依赖未必有 wheel）
uv pip install --python .venv\Scripts\python.exe -r requirements.txt
$env:APP_MODE='dev'; $env:GENBOX_PORT='8892'
.\.venv\Scripts\python.exe main.py
```

`APP_MODE=dev` 时 GenBox 免 `X-Admin-Key`，且只监听 `127.0.0.1`。浏览器打开 `http://127.0.0.1:8892`
配置你的图片/视频 provider（OpenAI 兼容、Gemini、Qwen、火山等）。

## 2. 装上插件

**从 npm 装（推荐）**——装的是预构建产物，不需要任何构建授权：

```powershell
dsh plugin --profile genbox-dev add dsh-genbox-plugin
```

**从源码装**（想改代码时用）：

```powershell
git clone https://github.com/liwei9745/dsh-genbox-plugin
cd dsh-genbox-plugin; corepack pnpm install; corepack pnpm run build
dsh plugin --profile genbox-dev add .
```

然后启动。日志里出现这行就说明插件被宿主加载了：

```
[genbox] plugin loaded (baseUrl=http://127.0.0.1:8892)
```

## 3. 装完之后先做这三步

1. **打开工作台**：对 agent 说「打开 GenBox 工作台」。它会调用 `genbox_open_workbench`，把
   `http://127.0.0.1:8892/` 交给你（或直接用系统浏览器打开）。provider、API Key、设置都在这个界面里。
   如果 GenBox 没在跑，它会明确告诉你「没有应答」，而不是给你一个假的成功。
2. **自检**：说「跑一下 GenBox 自检」。`genbox_doctor` 会逐项检查连通性、鉴权模式、provider 与 Key、
   ffmpeg、输出目录可写性，最后附一份 next-steps 清单。
3. **开始用**：说一句具体需求（见下一节）。

## 4. 用起来

在会话里直接说人话：

- 生图：「用 GenBox 画一只在雪地里的柴犬，1024x1024」
- 改图：「把 `E:\out\dog.png` 的背景换成沙滩」
- 精准改图：「在这张图上画个箭头指向天空，然后把天空改成黄昏」——插件会把批注合成为蒙版再交给 GenBox
- 生视频：「生成一段 5 秒的日落实拍视频」
- 剪视频：「把 `E:\out\clip.mp4` 裁到前 3 秒，再把 `E:\out\sub.srt` 烧成字幕」——11 种操作全在本地 ffmpeg 跑
- 收结果：「看看 GenBox 里最近的素材」

生成的文件会落到 `outputDir`（默认 `.genbox`），工具把**绝对路径**返回给模型，模型可以接着用 DSH 自带的
`read_image` 打开确认——插件不需要自己去构造图片附件。

## 5. 不想花 Key 先验证？用自带的 mock provider

仓库里带了一个假图床 / 假视频服务（用 Pillow 按请求尺寸生成 PNG，外加一个 volcengine 协议的视频任务）：

```powershell
# 终端 A：假服务
python scripts/mock-openai-image.py
# 终端 B：一条命令跑全部套件（缺前置条件的会如实 SKIP）
node scripts/verify-all.mjs
```

它会验证「批注渲染 → 本地视频剪辑 11 种 → 自检 → 生图生视频 → 后台任务 → 图库过滤 → 精准改图 →
UI 渲染契约 → 首装引导 → 报错信息」整条链路，**全程不花一分钱、不需要任何 Key**。

## 6. 四个真实的坑（都踩过了）

1. **`NO_PROXY` 里的 `[::1]`**：宿主导出的 `NO_PROXY` 含 `[::1]` 时，CPython 会把它原样放进
   `getproxies()['no']`，httpx 0.28 解析即抛 `Invalid port: ':1]'`——**GenBox 所有出站请求都会失败**。
   修法：在 GenBox 的 venv 放一个 `sitecustomize.py` 剔除带方括号的条目。
2. **`dsh plugin` 需要真 pnpm**：只装 corepack 不够，PATH 上要有 `pnpm`（可以用一个转发到 `corepack pnpm` 的 shim）。
3. **精准改图有授权门槛**：GenBox 要求「显式验证过的改图模型」，否则返回 `precision_edit_provider_unsupported`。
   这不是插件 bug，是它刻意的安全设计。
4. **发布要过 2FA**：npm 账号开了两步验证时，`npm publish` 必须带一次性验证码（`--otp=<code>`），
   或者用一个明确允许绕过 2FA 的 granular access token。

## 7. 想自己写一个类似的插件

最小骨架就三件事：

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'my-plugin'
export const inject = ['tools']

export function apply(ctx: Context, config: MyConfig) {
  ctx.tools.register(defineTool({
    name: 'my_tool',
    description: 'What the model sees.',
    parameters: { prompt: { type: 'string', required: true } },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
    async execute(args, exec) { /* return a canonical JSON value */ },
  }))
}
```

再加一份 `package.json` 里的 `dsh.bundle.patch` 和 `cordis.patch.yml`，就能 `dsh plugin add` 分发了。

## 8. 小结

整个插件的思路一句话：**GenBox 已经有 REST API，就不要改它**。插件只负责把它翻译成模型好用的工具，
两边都能独立演进。

仓库（MIT，`dsh-plugin` topic）：https://github.com/liwei9745/dsh-genbox-plugin
