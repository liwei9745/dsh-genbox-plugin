## 0.2.0 — GenBox 的原版界面，现在直接住在 DSH NEXT 里

以前用 GenBox 得切浏览器：插件只管"生图 / 改图 / 生视频"，配置 provider、翻媒体库、看系统看板还是得离开对话。
0.2.0 把这件事从根上解决了——**插件多了一个客户端半边，在 DSH NEXT 右侧边栏注册了一个原生 GenBox 面板**。

### 怎么打开

- **Ctrl+Shift+G**，或右侧边栏「新标签页」里的 **GenBox** 卡片；
- 面板里就是 GenBox 自己的 Web UI：系统看板 / 生图 / 生视频 / 媒体库 / 历史 / 扩展功能 / 模型设置；
- 面板自带**地址栏**（默认 `http://127.0.0.1:8892/`，可改端口并记住）、**刷新**、**在系统浏览器中打开**。

### 技术上是怎么做到的（值得写下来）

1. **iframe 一定不行**。GenBox 的响应头带 `X-Frame-Options: DENY` 与
   `Content-Security-Policy: frame-ancestors 'none'`——任何网页容器都会被浏览器拒绝。
   这也解释了为什么"把 GenBox 嵌进 DSH"看起来不可能。
2. **桌面端走 DSH 官方的 webview 租约**，而不是自己造一个 `<webview>`：DSH 主进程在
   `will-attach-webview` 上校验**租约**（lease）与 partition，没有租约的 webview 会被直接 `preventDefault()` 拦掉。
   于是面板严格复刻官方顺序：
   `dshDesktop.browser.acquire(workspace)` → `src="about:blank#<lease>"` + `partition` → 挂载 →
   `dom-ready` 后 `loadURL(genboxUrl)`。
   隔离策略（无 node、沙箱、禁权限、禁下载、只允许 http(s) 且不得指向 DSH 自身端口）全部由主进程统一施加。
3. **插件形态**：`package.json` 声明 `dsh.client`（`platform` + `inject`），`exports["./client"]` 指向手写的
   `client/client.js`——它只调用 `window.__ModuleLoader__.load({ id, factory })` 注册工厂，
   真正的挂载（标签类型、body/title 插槽、快捷键）都在 `apply(ctx)` 里用 `ctx.effect` 完成，插件卸载即整体回收。

### 测试（先测试再发，老规矩）

新增 `scripts/verify-client-panel.mjs`：**25 项断言，零网络零花费**（假 DOM + 假 React + 假 Electron 桥），
验证 bundle 只注册一个 factory、`apply/inject` 契约、标签类型 / body / title / 快捷键绑定，
以及**租约协议全过程**（acquire → `about:blank#<lease>` → partition → dom-ready → `loadURL`）。

全量回归：**25 个套件全部通过**（`all runnable suites passed`），其中包括这次的
`client panel (in-app GenBox tab) OK (25 checks)`。

顺带：`genbox_open_workbench` 现在会提示"在 DSH 里用 Ctrl+Shift+G 内嵌打开"。

**npm**：`npm i dsh-genbox-plugin@0.2.0`（装进 `desktop` profile 后重启 DSH NEXT 生效）
**repo**：https://github.com/liwei9745/dsh-genbox-plugin
