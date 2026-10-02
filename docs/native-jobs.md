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

| 项 | 状态 |
|---|---|
| 调用形状、返回值、注册次数、job 自行结算并落盘、关闭时完全不碰 registry | ✅ 用**桩 registry** 单元验证：`node scripts/verify-native-jobs.mjs` |
| 真实模型会话里由 `dsh-tool-jobs` 投递完成通知、`job_kill` 生效 | ⚠️ **未经端到端验证**——本机 CLI profile 没有可用的模型凭据，跑不了真实会话 |

因为默认是 `false`，**发布出去的行为仍然是那条已经被完整验证过的路径**；
想尝鲜的人可以打开这个开关，出问题随时关掉。

## 什么时候值得开

视频动辄几分钟、你希望模型在等的时候继续做别的事、并且宿主组合里确实有后台任务能力时。