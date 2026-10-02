# 鏈湴寮€鍙戜笌鑱旇皟鐜

鏈枃璁板綍鍦?`E:\AI\GenBox-dsh` 閲岃窇閫?鎻掍欢 鈫?GenBox"闂幆鐨勬瘡涓€姝ワ紝鍖呭惈涓€涓?*鏈満鐗规湁鐨勭幆澧冨潙**鍙婂叾淇銆?
## 1. 渚濊禆

| 缁勪欢 | 鐗堟湰 | 澶囨敞 |
|---|---|---|
| Node | v24.13.1 | |
| pnpm | 閫氳繃 `corepack pnpm` 浣跨敤 | 鏈満娌℃湁鍏ㄥ眬 pnpm |
| Python | **3.11.15**锛坲v 绠＄悊锛?| 鏈満榛樿 `python` 鏄?3.14.3锛孏enBox 閽夌殑 pydantic 2.13 / pillow 12.3 鏈湪 3.14 涓婇獙璇侊紝**涓嶈鐢ㄥ畠** |
| GenBox | v2.6.12锛坢aster `02ce25e`锛?| `upstream/GenBox` |

## 2. 鍚姩 GenBox锛堝紑鍙戞ā寮忥級

```powershell
# 涓€娆℃€э細寤?venv 骞惰渚濊禆
cd E:\AI\GenBox-dsh\upstream\GenBox
uv venv --python 3.11 .venv
uv pip install --python .venv\Scripts\python.exe -r requirements.txt

# 姣忔鍚姩锛歞ev 妯″紡 + 8892 绔彛
$env:APP_MODE='dev'; $env:GENBOX_PORT='8892'; $env:GENBOX_NO_BROWSER='1'
.\.venv\Scripts\python.exe main.py
```

- `APP_MODE=dev` 鏃?**涓嶉渶瑕?`X-Admin-Key`**锛屼笖 uvicorn 鍙粦瀹?`127.0.0.1`锛坢ain.py:9140锛夈€?- `APP_MODE` 缂虹渷鏄?`prod`锛屾鏃跺繀椤绘湁 `ADMIN_KEY`锛屽惁鍒欏惎鍔ㄧ洿鎺ヨ闃绘柇锛坢ain.py:9128锛夈€?- 婧愮爜杩愯涓嶄細鑷姩寮€娴忚鍣紙鍙湁褰?`sys.frozen` 涓虹湡鏃舵墠浼氾紝main.py:9178锛夈€?
## 3. 鈿狅笍 鏈満鐜鍧戯細NO_PROXY 閲岀殑 `[::1]` 浼氭墦宕?httpx

**鐜拌薄**锛氫换浣曚竴娆＄敓鍥鹃兘澶辫触锛岄敊璇槸

```
[Mock OpenAI] 鎵€鏈夌鐐瑰潎澶辫触: 绔偣 1 [FAILED]: [Mock OpenAI] Invalid port: ':1]'
```

**鏍瑰洜**锛欴SH 瀹夸富杩涚▼鍚戝瓙杩涚▼瀵煎嚭浜?
```
NO_PROXY=169.254.198.80,172.17.0.1,192.168.200.195,.local,localhost,127.0.0.1,::1,[::1]
```

CPython 鐨?`urllib.request.getproxies()` 浼氭妸杩欎簺鏉＄洰鍘熸牱鏀捐繘 `no` 閿紝`httpx` 0.28 鍦ㄦ瀯寤?`AsyncClient` 鏃舵妸 `[::1]` 褰?`host:port` 瑙ｆ瀽锛屾姏 `InvalidURL: Invalid port: ':1]'`銆?*杩欒窡 mock provider 鏃犲叧**鈥斺€斿畠鍦?httpx 瀹㈡埛绔瀯閫犻樁娈靛氨宕╋紝瀵逛换浣曠湡瀹?provider 涓€鏍蜂細宕┿€?
**淇**锛堝彧褰卞搷鏈?venv锛屼笉鏀?GenBox 浠ｇ爜锛夛細鍦?`.venv\Lib\site-packages\sitecustomize.py` 閲屾妸甯︽柟鎷彿鐨勬潯鐩墧闄わ細

```python
import os
for name in ("NO_PROXY", "no_proxy"):
    value = os.environ.get(name)
    if not value or "[" not in value:
        continue
    os.environ[name] = ",".join(p for p in value.split(",") if not p.strip().startswith("["))
```

> 杩欐槸鐜渚?workaround锛屼笉灞炰簬鎻掍欢浜や粯鐗┿€傛洿鏍规湰鐨勪慨娉曟槸 GenBox 鍦ㄦ湭閰嶇疆浠ｇ悊鏃剁敤 `httpx.AsyncClient(trust_env=False)`锛屾垨鑰呬笂娓?httpx 淇?no_proxy 瑙ｆ瀽銆?
## 4. 鏃?key 鐨勭鍒扮鑱旇皟锛坢ock provider锛?
涓嶈姳閽便€佷笉闇€瑕佷换浣?API Key 灏辫兘楠岃瘉鏁存潯閾捐矾锛?
```powershell
# a) 璧蜂竴涓?OpenAI 鍏煎鐨勫亣鍥惧簥锛堢敤 venv 閲岀殑 Pillow锛屾寜璇锋眰灏哄杩斿洖绾壊 PNG锛?E:\AI\GenBox-dsh\upstream\GenBox\.venv\Scripts\python.exe E:\AI\GenBox-dsh\scripts\mock-openai-image.py

# b) 鎶婂畠娉ㄥ唽鎴?GenBox 鐨?image provider
$body = @{ id='mock-openai'; name='Mock OpenAI'; type='image'; api_key='sk-mock';
           base_url='http://127.0.0.1:8899'; model='mock-image-1'; models=@('mock-image-1');
           size='512x512'; enabled=$true; capabilities=@{ t2i=$true; i2i=$true };
           endpoint_type='openai' } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri 'http://127.0.0.1:8892/api/providers' -Method POST -Body $body -ContentType 'application/json'
```

鐒跺悗璺戞彃浠剁骇楠岃瘉锛?
```powershell
cd E:\AI\GenBox-dsh
corepack pnpm run build
node scripts\verify-tools.mjs
```

鏈熸湜杈撳嚭锛歚genbox_image_generate` 涓?`genbox_image_edit` 閮芥槸 `completed`锛屽浘鐗囪惤鍦?`.genbox-out\` 涓嬨€?
## 5. 鐪熷疄 provider

鍦?GenBox 鐣岄潰锛坄http://127.0.0.1:8892`锛夐噷閰嶇疆 provider 涓?Key锛屾垨澶嶇敤鐜版湁 `storage/providers.json`銆傛彃浠朵晶涓嶉渶瑕佹敼浠讳綍涓滆タ锛歚genbox_providers` 浼氬垪鍑哄凡鍚敤鐨?provider銆?
## 6. 鎻掍欢绾ч獙璇佽剼鏈?
| 鑴氭湰 | 浣滅敤 |
|---|---|
| `scripts/verify-plugin.mjs` | 鏈€灏忓姞杞介獙璇侊細娉ㄥ唽 `genbox_health` 骞惰皟鐢ㄧ湡瀹?GenBox |
| `scripts/verify-tools.mjs` | 绔埌绔細鐢熷浘 + 鏀瑰浘锛坕2i锛夛紝鏍￠獙鏂囦欢钀界洏涓庢覆鏌?|
| `scripts/mock-openai-image.py` | OpenAI 鍏煎鍋囧浘搴婏紙`/v1/images/generations` 涓?`/v1/images/edits`锛?|
| `scripts/probe-httpx.py` | 璇婃柇 httpx 浠ｇ悊闂 |
## 7. 鎶婃彃浠惰杩涗竴涓?DSH profile锛堝凡瀹炴祴锛?
`dsh plugin` 鍐呴儴浼氳皟鐢ㄧ湡姝ｇ殑 `pnpm`锛屽彧鏈?`corepack` 鏄笉澶熺殑銆傛湰鏈哄缓浜嗕竴涓浆鍙?shim锛?
```powershell
# C:\Users\18722\AppData\Roaming\npm\pnpm.cmd
@echo off
corepack pnpm %*
```

鐒跺悗寤轰竴涓?*鐙珛** profile锛堜笉瑕佸姩姝ｅ湪鐢ㄧ殑 `desktop`锛夛細

```powershell
dsh --profile genbox-dev --from-default-profile web     # 浠庨殢闄勬ā鏉垮垵濮嬪寲
dsh plugin --profile genbox-dev add E:/AI/GenBox-dsh    # 瑁呮垚鏈?bundle
dsh --profile genbox-dev --dump-config | Select-String genbox
dsh --profile genbox-dev --port 3099                    # 瀹炴満鍚姩
```

- 鍥犱负鍖呭０鏄庝簡 `dsh.bundle`锛宍dsh plugin add` 浼氳嚜鍔ㄦ妸瀹冭拷鍔犺繘 `dsh.profile.bundles`銆?- `--dump-config` 閲屽簲鍑虹幇 `# == dsh-genbox-plugin` 灞備笌 `- id: genbox` 琛屻€?- pnpm 浼氳鍛?linked 鍖呬笉浠庣洰鏍?`node_modules` 瑙ｆ瀽 peer锛涙湰浠撳簱鑷甫鍚岀増鏈?devDependencies锛岃繍琛屾湡澶熺敤銆?*姝ｅ紡鍒嗗彂璧?npm 瀹夎鏃讹紝peer 浼氫粠 profile 鐨?`node_modules` 姝ｅ父瑙ｆ瀽**銆?- 瑕佽杩?Desktop锛坄--profile desktop`锛夐渶瑕侀噸鍚?DSH NEXT 鎵嶇敓鏁堛€?
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

也就是说这个目录的所有者变成了「管理员组」，当前用户没有任何权限，脚本也就无法自动修权限。

**应急绕过**（不需要管理员，利用父目录的删除子项权限）：

```powershell
Rename-Item 'E:\AI\GenBox-dsh\lib' 'lib-locked-<日期>'   # 把它搬开
pnpm run build                                              # 重新生成一个属于你的 lib
```

**彻底清理**（需要管理员权限的 PowerShell）：

```powershell
takeown /f 'E:\AI\GenBox-dsh\lib-locked-<日期>' /r /d y
icacls 'E:\AI\GenBox-dsh\lib-locked-<日期>' /grant "$env:USERNAME:(F)" /t
Remove-Item -Recurse -Force 'E:\AI\GenBox-dsh\lib-locked-<日期>'
```

诊断原始记录保存在 `.lab/acl-report/acl-report-*.jsonl`（已 gitignore）。
## 9. 推送到 GitHub 需要走代理

本机访问 `github.com` 必须经过系统代理（Clash 在 `127.0.0.1:7897`），但 git 默认不读系统代理，
于是 `git push` 会以 `Recv failure: Connection was reset` 失败。给本仓库配上代理即可：

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

**临时代理**（只对当前这个终端窗口有效，关掉即失效，不写任何配置文件）：

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
