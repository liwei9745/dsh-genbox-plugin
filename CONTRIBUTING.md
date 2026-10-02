# Contributing

这是一个社区插件（DSH 官方目前不接受外部 PR，插件以独立仓库形式贡献生态）。

## 开发

```sh
corepack enable
pnpm install
pnpm run typecheck
pnpm run build
```

## 本地端到端验证（不需要任何 API Key）

一条命令跑完所有套件；缺前置条件的会自动标 SKIP 而不是失败：

`sh
node scripts/verify-all.mjs
`


```sh
# 1) 起一个假 provider
python scripts/mock-openai-image.py          # 需要 Pillow；也可以用 GenBox 的 venv python
# 2) 把它注册进 GenBox（见 docs/local-dev.md 的一行命令）
# 3) 跑工具链路
node scripts/verify-tools.mjs
node scripts/verify-media.mjs
node scripts/verify-edit-modes.mjs
```

## 提 PR 的约定

- 新增/修改工具时，**同时**补一个 `scripts/verify-*.mjs` 能覆盖到的路径；没有验证的命令不要写进文档。
- 配置项必须放进 `src/config.ts` 的 Schemastery schema，不要硬编码部署相关常量。
- 保持"只通过 HTTP 调用 GenBox"的边界：不要把 GenBox 源码或 Python 逻辑拷进来。
- 工具返回值要设计成可直接程序化消费（PTC 下就是 `await tools.<name>(args)` 的返回值）。
