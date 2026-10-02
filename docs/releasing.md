# 发布流程（0.1.x 已验证两轮）

每一步都留了可复现命令与期望输出。假设仓库在 `E:\AI\GenBox-dsh`，`main` 干净。

## 0. 一次性准备

- `npm login`（本机已用 `--auth-type=web` 登录，账号 `monkeyboss`）
- 真实 `pnpm` 在 PATH 上（`corepack` 不够，`dsh plugin` 会调用它）
- `gh` 可选（本机用便携包：`E:\AI\tools\gh\bin\gh.exe`）

## 1. 改版本与 CHANGELOG

```powershell
# package.json: "version": "0.1.1" -> "0.1.2"
# CHANGELOG.md: 把 ## Unreleased 改成 ## 0.1.2 — <日期>
```

## 2. 构建（绕开本机偶发的目录权限问题）

```powershell
powershell -File .\scripts\rebuild.ps1
# 期望：Build complete；若输出目录被系统收走权限，脚本会先把它改名搬走再构建
```

## 3. 本地全量验证

```powershell
# DSH_PROFILE_DIR 指向一个已装过本插件的 profile 时，会多跑一项「已安装包与仓库构建一致」
$env:DSH_PROFILE_DIR = 'C:\Users\<you>\.dsh\profiles\genbox-011'
node scripts\verify-all.mjs
# 期望：14 个套件全 PASS（GenBox 没起、缺 ffmpeg 的会如实 SKIP）
```

## 4. 发布预检（dry run，不发任何东西）

```powershell
node scripts\publish.mjs
```

期望看到（全 [ok]）：

```
[ok] git working tree clean -> clean
[ok] on a branch -> main
[ok] origin remote -> https://github.com/liwei9745/dsh-genbox-plugin.git
[ok] tarball contains lib/index.js + cordis.patch.yml
[ok] npm version 0.1.2 is unpublished -> next to the published 0.1.1
[ok] npm credentials -> via npm login (monkeyboss)
```

## 5. 真正发布

账号开了两步验证，所以必须过这道门。两条路任选：

**方式 A：让 npm 自己提示输码**

```powershell
cd E:\AI\GenBox-dsh
npm publish --access public
# 会提示 Authenticate your account at: https://www.npmjs.com/auth/cli/<uuid>
# 浏览器点一次授权，然后 + dsh-genbox-plugin@0.1.x
```

**方式 B：掩码输入（token 不进聊天记录）**

```powershell
cd E:\AI\GenBox-dsh
powershell -File .\scripts\publish-with-token.ps1 -Execute -NpmOnly
# 提示：npm token（可留空，用已登录身份）、一次性验证码（开 2FA 时必填）
```

> 直接跑 `npm publish --otp=<code>` 也可以，但码只有约 30 秒有效。

## 6. 回读校验（别信「发布成功」四个字）

```powershell
node scripts\verify-published.mjs
```

期望：registry 版本 == package.json 版本、`engines.dsh` 已声明、`dsh-plugin` 关键字在、已发布 tarball 真的含
`lib/index.js` + `cordis.patch.yml`。

> npm 是暂存发布：`+ name@version` 之后 registry 可能还要 1-2 分钟才可见（先出现 `0.0.0-stage` 占位版本）。
> 直接轮询：`npm view dsh-genbox-plugin versions --json`。

## 7. 从 npm 真装一遍（发布产物验证）

```powershell
dsh --profile genbox-011 --from-default-profile web
dsh plugin --profile genbox-011 add dsh-genbox-plugin
$env:DSH_PROFILE_DIR = 'C:\Users\18722\.dsh\profiles\genbox-011'
node scripts\verify-installed-package.mjs
# 期望：installed version: 0.1.x (14 tools)，且与仓库构建逐一对齐
```

## 8. 推送与 CI

```powershell
git add -A; git commit -m 'release: 0.1.x ...'
git -c credential.helper="!E:/AI/tools/gh/bin/gh.exe auth git-credential" push origin main
# 然后在 GitHub Actions 里确认 CI = success（install / typecheck / build / ffmpeg / verify-all）
```

## 9. 让市场里的用户拿到新版本（用户侧动作）

插件市场比对 npm 的 `latest` dist-tag，发现比本地新就会显示**「有新版本」+「更新」**按钮：

1. 结束所有 agent 会话（市场拒绝在有 agent 运行时安装）
2. 设置 → 插件市场 → `dsh-genbox-plugin` → 更新
3. 重启 DSH NEXT（更新重启后生效）

## 踩过的坑（每条都真实发生过）

| 现象 | 原因 | 处理 |
|---|---|---|
| `npm error code EOTP` | 账号开了 2FA，发布要一次性验证码 | `--otp=<code>`，或走方式 A 的浏览器授权 |
| `npm error 403 ... Two-factor authentication or granular access token` | 用登录凭据直接发、且没给验证码 | 同上；或用允许绕过 2FA 的 granular token |
| `npm view` 还是旧版本 | 暂存发布传播中 | 等 1-2 分钟再轮询 |
| CI 在 `pnpm install` 失败：`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` | pnpm 12 的供应链策略拒绝刚发布的包 | 把该依赖钉到已过窗口的版本（我们钉了 `@types/node@24.19.0`） |
| `git push` 失败并打印 `https://x-access-token:<token>@…` | 凭据被拼进了 URL | 不要这样做——`publish.mjs` 现用 `http.extraheader` 传递 |
| `pnpm run build` 报 `拒绝访问 (os error 5)` | 输出目录被写成管理员组所有 | `scripts/rebuild.ps1` 自动搬走再构建 |
