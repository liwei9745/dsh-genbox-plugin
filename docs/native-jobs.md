# 长视频改走 DSH 原生后台任务（实验性）

## 为什么要有它

默认行为已经解决了"工具调用被卡住"的问题：`background: true` 提交后立刻返回 GenBox 任务 id，
模型用 `genbox_task` 轮询。开启 `nativeJobs` 后，插件改用 **DSH 自己的 job registry**（`ctx.jobs`）：

- 任务获得 `<kind>-N` 形式的稳定 id（我们的是 `genbox-video-N`）；
- 结算时由 `dsh-tool-jobs` 变成**会话内通知**，模型不必轮询；
- 可以用内置的 `job_output` / `job_list` / `job_kill` 控制；
- 归属绑定到启动它的 agent 会话，别的会话看不到也停不掉。

## 怎么开

```yaml
- id: genbox
  name: dsh-genbox-plugin
  config:
    nativeJobs: true      # 默认 false
```

前提是你的组合里加载了后台任务能力（DSH 默认的 `dsh-jobs-local` + `dsh-tool-jobs` 就有）。

## 契约（从 DSH 参考实现里读出来的）

`dsh-tool-bash` 是官方参考实现，它这样用：

```js
registry.start({
  kind: "bash",
  label: args.command,
  ...(exec.agent ? { owner: exec.agent.id } : {}),
  output: processSources(() => proc),      // 可选：拉取式输出源
  run: () => ({
    done: hooks.done,                       // Promise，结算后 resolve
    cancel: (reason) => hooks.cancel(reason),
  }),
})
```

即：`start()` 返回 **job id 字符串**；`run()` 必须返回 `{ done, cancel }`。

## 本插件的接法

| 字段 | 值 |
|---|---|
| `kind` | `genbox-video` |
| `label` | 提示词前 80 字 |
| `owner` | `exec.agent.id`（执行没有 agent 时不带） |
| `done` | 轮询 GenBox 到终态 + 下载成片的 Promise（**刻意不挂 exec.signal**——工具调用已经返回了，任务应该活得更久） |
| `cancel` | `POST /api/video/cancel/{task_id}` |

## 验证到哪一步（诚实说明）

`node scripts/verify-native-jobs.mjs` 现在跑三层，10 项断言全过：

| 层次 | 验的是什么 | 结果 |
|---|---|---|
| 1. 桩 registry | 我们发出的调用形状：kind / label / owner / `run()` 返回 `{done,cancel}`、返回值带 jobId | ✅ |
| 2. **真实的 `dsh-jobs-local` 注册表**（从已安装的 DSH 应用里在进程内组合），且**没有挂 job 控制器** | 注册表会拒绝（`no job controller serves this agent`），**插件必须降级而不是让调用失败** | ✅ 已修并验证 |
| 3. 真实注册表 + 挂上控制器 | 拿到真实 job id（`genbox-video-1`）、kind 正确、job 结算为 `completed`、**新视频真的落盘** | ✅ |

第 2 层是这一轮抓出来的**真实缺陷**：注册表要求"有 job 控制器服务这个 agent"（提示信息明说
要加载 `@deepseek-ai/dsh-tool-jobs`），而插件原来直接把异常抛了出去——那样打开 `nativeJobs`
反而会让 `genbox_video_generate({background:true})` 整个失败。现在注册表拒绝时会**回退到普通的
GenBox 任务句柄**，并用 `console.warn` 说明原因，任务永远不会因为这件事丢掉。

**仍未验证**：模型驱动的真实会话里 `dsh-tool-jobs` 投递完成通知、`job_kill` 生效这条链路
（本机 CLI profile 没有可用的模型凭据，跑不了真实会话）。

因为默认是 `false`，**发布出去的行为仍然是那条已经被完整验证过的路径**；
想尝鲜的人可以打开这个开关，出问题随时关掉。

## 什么时候值得开

视频动辄几分钟、你希望模型在等的时候继续做别的事、并且宿主组合里确实有后台任务能力时。