## 0.2.1 — 修掉 0.2.0 那个"启动即崩"的严重 bug

先说清楚发生了什么，因为这是我的错，而且影响很直接：

**0.2.0 的客户端半边把 `inject` 导出成了函数**，而 cordis 只认**静态数组**形式的注入声明。
结果就是"声明了零个依赖"，`apply()` 里第一次读 `ctx.sidebarRightTabs` 立刻抛错：

```
Error: failed to apply loader entry (dsh-genbox-plugin):
cannot get property "sidebarRightTabs" without inject
```

DSH NEXT 把它记成 `web boot: 1 entry did not activate / dsh-genbox-plugin: failed`，
随后插件自愈机制**把整个 bundle 停用**（`.dsh/recovery/` 里留了快照），桌面端才能重新启动。
换句话说：**装了 0.2.0 的桌面端会在下次重启时打不开**——这个代价我该在发布前用真实启动验证掉，
而不是只用假 DOM 的单元测试。（我原来的测试还把这个错误当成了"正确行为"：它断言 `inject` 是个函数。）

### 0.2.1 改了什么

1. `client/client.js`：`inject` 改为数组 `["slots", "sidebarRight", "sidebarRightTabs"]`，与内置插件同形；
2. `verify-client-panel.mjs`：断言 `inject` **必须是数组**、**必须覆盖 apply() 触碰的每个服务**，
   并用一个 **cordis 同款严格 ctx**（读未声明服务即抛错）来跑 `apply()`——
   也就是说，0.2.0 的错误现在会**在测试里失败**，而不是在用户启动应用时爆炸；
3. 复现方法也写进了 CHANGELOG（不需要重启桌面端）：
   `dsh --profile <有插件的 profile> --no-open --port 9126`，再用 Chromium 打开抓 console。

### 验证（这次是真的跑起来验的）

- 修复前：真实启动 → console 报上面那条 inject 错误；
- 修复后：真实启动 → **console 干净**，且 sidebar 的"新标签页"里能看到插件注册的 **GenBox** 卡片；
- 全量回归：套件全绿（含 `client panel (in-app GenBox tab) OK (25 checks)`）。

**npm**: `npm i dsh-genbox-plugin@0.2.1`
如果你因为这次事故把桌面端的 GenBox 插件停用了：升级到 0.2.1 后可以重新启用。
