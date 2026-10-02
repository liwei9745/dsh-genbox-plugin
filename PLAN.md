# GenBox 脳 DeepSeek Harness 鎺ュ叆鏂规

> 璋冪爺鏃堕棿锛氭湰杞細璇濄€傜粨璁哄熀浜?`liwei9745/GenBox`锛坢aster锛寁2.6.x锛夋簮鐮佷笌瀹樻柟 DSH 鎻掍欢鏂囨。銆?> 璋冪爺瀵硅薄宸?clone 鍒?`upstream/GenBox`锛堝彧璇诲弬鑰冿紝鏈慨鏀癸級銆?
## 0. 缁撹锛圱L;DR锛?
1. **涓嶉渶瑕佹敼閫?GenBox銆?* 瀹冩湰韬氨鏄竴涓崟杩涚▼ **FastAPI** 搴旂敤锛屽凡缁忔毚闇蹭簡瀹屾暣鐨?HTTP API锛?17 鏉¤矾鐢憋紝瑕嗙洊鐢熷浘銆佹敼鍥俱€佽棰戙€佸獟浣撳簱銆佹姞鍥俱€佽秴鍒嗭級銆?2. 姝ｇ‘褰㈡€佹槸锛?*鍐欎竴涓?DSH "HTTP 瀹㈡埛绔? 鎻掍欢**锛圱ypeScript / Cordis锛夛紝鎶?GenBox 鐨?REST 绔偣鍖呰鎴愭ā鍨嬪彲璋冪敤鐨勫伐鍏凤紝骞惰礋璐ｈ疆璇㈤暱浠诲姟銆佹妸缁撴灉钀界洏銆佹妸鍥剧墖/瑙嗛鍥炰紶缁欐ā鍨嬪拰 UI銆?3. **鐢熷浘 / 鏀瑰浘 / 鐢熻棰戝彲浠ョ洿鎺ヨ鐩?*锛?*"鏀硅棰?鐩墠鍦?GenBox 閲屾病鏈夊疄鐜?*鈥斺€擿docs/ARCHITECTURE.md` 鏄庣‘鍐欐槑瑙嗛宸ヤ綔鍙帮紙Video Workbench锛?is a design boundary, not a claim that those modules exist"銆傜涓€鐗堝彧鑳藉仛"浠ュ浘 / 棣栧熬鍏抽敭甯ч┍鍔ㄥ啀鐢熸垚"锛岀湡姝ｇ殑瑙嗛缂栬緫闇€瑕佸崟鐙珛椤广€?4. 寮€鍙戣惤鍦?`E:\AI\GenBox-dsh`锛氫粨搴撻噷鏀?**鎻掍欢鍖呬负涓?*锛宍upstream/GenBox` 浣滀负鍙傝€冧笌鑱旇皟瀵硅薄銆?5. 涓や釜蹇呴』鍏堣В鍐崇殑澶栭儴鏉′欢锛?*鏈満娌℃湁瀹夎 GenBox锛?892 绔彛涔熸病鏈夊湪鐩戝惉**锛涗互鍙?**GPL-3.0 璁稿彲杈圭晫**锛堥€氳繃 HTTP 璋冪敤娌￠棶棰橈紝涓嶈鎷疯礉 GenBox 婧愮爜杩涙彃浠讹級銆?
---

## 1. 璋冪爺缁撹

### 1.1 GenBox 鎶€鏈敾鍍?
| 椤?| 浜嬪疄 | 璇佹嵁 |
|---|---|---|
| 褰㈡€?| 鍗曡繘绋?FastAPI + 鍐呯疆闈欐€?SPA锛岄厤缃笌濯掍綋瀛樻枃浠剁郴缁?| `docs/ARCHITECTURE.md`銆孏enBox is a single-process FastAPI application銆?|
| 鍏ュ彛 | `main.py`锛堢害 397 KB锛岃矾鐢?+ pydantic 妯″瀷 + 浠诲姟缂栨帓鍏ㄥ湪杩欙級 | 浠撳簱鏍圭洰褰?|
| 绔彛 | 浠ｇ爜榛樿 **8891**锛坄GENBOX_PORT` 瑕嗙洊锛夛紱`.env.example` 妯℃澘鍐?8892锛屾ā鏉夸笌浠ｇ爜榛樿涓嶄竴鑷?| main.py:9162銆?env.example |
| 璺敱 | 117 鏉?`/api/*` + `/` | `main.py` grep ```app.get/post` |
| 璁よ瘉 | prod 妯″紡瑕佹眰璇锋眰澶?`X-Admin-Key`锛汣SRF 涓棿浠舵牎楠?Origin/Referer | `main.py:7128`锛坅dmin_auth_middleware锛夈€乣main.py:1901`锛坈srf_protection锛?|
| 杩愯妯″紡 | `APP_MODE=dev`锛堟湰鍦板紑鍙戯級/ prod | `.env.example`銆乣config.py` |
| 渚濊禆 | fastapi 0.139 / uvicorn 0.51 / httpx / pillow / pydantic 2.13 | `requirements.txt` |
| 璁稿彲 | **GPL-3.0** | `LICENSE` |

### 1.2 鑳藉姏娓呭崟锛堜笌鎴戜滑鐨勭洰鏍囧搴旓級

- **鐢熷浘**锛歚POST /api/generate` 鈫?`GET /api/generate/status/{gen_id}`锛堝紓姝ヤ换鍔★級锛宍POST /api/generate/cancel/{gen_id}`
- **鏀瑰浘鐩稿叧**锛歚/api/images/variations`锛堝彉浣擄級銆乣/api/images/upscale`锛堣秴鍒嗭級銆乣/api/image-tools/cutout` + `/refine`锛堟姞鍥?鍓嶆櫙鎭㈠锛夈€乣GET /api/precision/workflows*`锛堢簿鍑嗘敼鍥?V4 鐨勫伐浣滄祦涓庣増鏈鍙栵級銆?*绮惧噯鏀瑰浘鐨?鍒涘缓"鍏ュ彛闇€瑕侀€氳繃 `/api/generate` 鐨勫弬鑰冨浘/mask 瀛楁瀹炵幇**鈥斺€斿叿浣撳瓧娈电敱 API 濂戠害灏忚妭纭銆?- **瑙嗛**锛歚POST /api/video/generate`锛堟枃鐢熻棰?/ 鍥剧敓瑙嗛 / 鍏抽敭甯э級銆乣GET /api/video/status/{task_id}`銆乣GET /api/video/list`銆乣GET /api/video/file/{filename}`銆乣GET /api/video/model-specs`銆乣POST /api/video/cancel/{task_id}`
- **濯掍綋搴?*锛歚GET /api/gallery`銆乣GET /api/gallery/image/{filename}`銆乣GET /api/gallery/image/{filename}/base64`銆乣GET /api/gallery/video-info/{item_id}`
- **鑳藉姏鍙戠幇**锛歚GET /api/providers`銆乣GET /api/providers/{id}`銆乣GET /api/setup/status`銆乣GET /api/video/model-spec/\{model_name\}`
- **杈呭姪**锛歚POST /api/llm/optimize`锛堟彁绀鸿瘝浼樺寲锛夈€乣GET /api/history`銆乣GET /api/logs`

### 1.3 鏈満鐜浜嬪疄锛堝凡瀹炴祴锛?
| 椤?| 瀹炴祴缁撴灉 |
|---|---|
| `E:\AI\GenBox-dsh` | 鐩綍宸插瓨鍦紝鍘熸湰涓虹┖ |
| `upstream/GenBox` | 鉁?宸?`git clone --depth 1` 鎴愬姛 |
| GenBox 鏄惁宸插畨瑁?| 鉂?鏈畨瑁咃紙`%LOCALAPPDATA%\Programs\GenBox` 绛夊潎涓嶅瓨鍦級 |
| 8892 绔彛 | 鉂?鏃犵洃鍚?|
| Node / git / Python | v24.13.1 / 2.53.0 / 3.14.3 |
| pnpm | 鏈叏灞€瀹夎锛坄corepack 0.34.6` 鍙敤锛屽彲 `corepack enable`锛?|
| `dsh` CLI | `C:\Users\18722\AppData\Roaming\npm\dsh.ps1`锛岀増鏈?**0.1.5-rc.2** |
| `$DSH_HOME` | `C:\Users\18722\.dsh`锛宲rofiles锛歚desktop`锛坆undles = dsh-base, dsh-web-app, dshmarket, @agents-anywhere/dsh-bridge-next锛夈€乣web` |
| 褰撳墠浼氳瘽鎵€鍦?DSH | DSH NEXT Desktop锛坄@deepseek-ai/dsh@ 0.2.0-rc.2` 琚墦鍖呭湪 app 鍐咃級 |

> 鈿狅笍 娉ㄦ剰锛氬叏灞€ `dsh` CLI 鏄?**0.1.5-rc.2**锛岃€?Desktop 鍐呯疆鐨勬槸 **0.2.0-rc.2**銆傛彃浠惰鍦?Desktop 閲岃窇锛屼緷璧栫増鏈繀椤讳互 **0.2.0-rc.2** 涓哄噯锛坄@deepseek-ai/dsh-tools@ 0.2.0-rc.2`銆乣@deepseek-ai/cordis@ 4.0.4`銆乣@deepseek-ai/schemastery@ 3.18.4`锛夈€?
---

## 2. 闆嗘垚鏋舵瀯

### 2.1 涓轰粈涔堟槸"HTTP 瀹㈡埛绔彃浠?

| 鏂规 | 璇勪环 |
|---|---|
| **A. DSH 鎻掍欢 鈫?GenBox HTTP API**锛堟帹鑽愶級 | GenBox 宸叉湁瀹屾暣 REST API锛涙彃浠舵槸绾?TS锛屼笉寮曞叆 Python 渚濊禆锛汫PL 杈圭晫骞插噣锛汫enBox 鍙嫭绔嬪崌绾?|
| B. 鎻掍欢鍐呭祵 / 鎷疯礉 GenBox 鐨?Python 閫昏緫 | 闇€瑕佹妸 Python 鏈嶅姟閫昏緫绉绘鍒?TS锛屾垚鏈瀬楂橈紱涓斾細鎶?GPL-3.0 浠ｇ爜甯﹁繘鎻掍欢 |
| C. 鍋氭垚 MCP server 鍐嶈 DSH 鎺ュ叆 | 鍙锛坄dsh-mcp-client` 宸插唴缃級锛屼絾瑕佸缁存姢涓€灞傝繘绋嬩笌鍗忚锛涙嬁涓嶅埌 DSH 鍘熺敓宸ュ叿鍗＄墖銆佸悗鍙颁换鍔′笌瀹℃壒閽╁瓙 |
| D. 鏀归€?GenBox 鏈綋鍔?agent API" | 鍙湁 B 鑳藉姏缂哄彛锛堣 1.2 瑙嗛缂栬緫锛夊嚭鐜版椂鎵嶅€煎緱鍋?|

**閫?A銆?* 濡傛灉灏嗘潵 GenBox 闇€瑕佹柊澧為潰鍚?agent 鐨勭ǔ瀹氱鐐癸紝鍐嶅湪閭ｄ釜浠撳簱鍗曠嫭鎻?PR锛圙PL 椤圭洰锛岃础鐚槸娆㈣繋鐨勶級銆?
### 2.2 鏁版嵁娴?
```
DSH agent
  鈹? 璋冪敤宸ュ叿锛坉efineTool锛?  鈻?dsh-genbox-plugin  鈹€鈹€ fetch(X-Admin-Key) 鈹€鈹€鈻? GenBox FastAPI (127.0.0.1:8892)
  鈹?                                                  鈹?  鈹? 鈼€鈹€鈹€ 浠诲姟 id / 鐘舵€佽疆璇?/ 缁撴灉鏂囦欢 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?  鈹?                                                  鈻?  鈹?                                           涓婃父 provider锛圙PT-Image / Gemini / Qwen / 鐏北 鈥︼級
  鈻?鎶婄粨鏋滀笅杞藉埌鏈湴鐩綍 鈫?浣滀负闄勪欢/鍥剧墖鍐呭鍥炵粰妯″瀷 + 鍦?UI 鍗＄墖閲屽睍绀?```

### 2.3 鍏抽敭瀹炵幇鐐?
- **闀夸换鍔?*锛欸enBox 鐨勭敓鎴愰兘鏄?鎻愪氦杩斿洖 id 鈫?杞鐘舵€?銆侱SH 渚х敤 `ctx.jobs.start({ kind, label, owner: exec.agent, run })` 鍋氭垚鍚庡彴浠诲姟锛岃妯″瀷鎷垮埌 `{ kind: 'background', jobId }` 鍙ユ焺锛岃€屼笉鏄樆濉炲埌瓒呮椂銆?- **缁撴灉钀藉湴**锛氬浘鐗?瑙嗛蹇呴』鍐欏埌鏈湴鏂囦欢锛堜緥濡傚伐浣滃尯涓?`.genbox/` 鎴栫敤鎴烽厤缃殑杈撳嚭鐩綍锛夛紝鍐嶆妸璺緞浣滀负闄勪欢杩斿洖锛涗笉瑕佸 base64 杩涙ā鍨嬩笂涓嬫枃銆?- **鑳藉姏鍓嶇疆妫€鏌?*锛氳皟鐢ㄥ墠鍏?`GET /api/providers` / `model-specs` 鎷垮埌"璇ユā鍨嬫敮鎸佸摢浜涘昂瀵搞€佹槸鍚︽敮鎸佹敼鍥?锛岄伩鍏嶇敓鎴?503 鍚庣瀻鐚滐紙GenBox 鑷繁鐨勬枃妗ｅ弽澶嶅己璋?503 涓嶇瓑浜庡昂瀵镐笉鏀寔"锛夈€?- **閰嶇疆**锛歚baseUrl`銆乣adminKey`銆乣defaultProviderId`銆乣outputDir`銆乣pollIntervalMs`銆乣taskTimeoutMs` 鈥斺€?鍏ㄩ儴璧?Schemastery `Config`锛屼笉纭紪鐮併€?- **鑷姩鎷夎捣**锛氬彲閫夊仛涓€涓?`genboxServer` 瀛愭湇鍔★細妫€娴?8892 鏈洃鍚椂鐢?`python -m uvicorn` 鍚姩 `upstream/GenBox`锛岄€€鍑烘椂娓呯悊锛坄ctx.effect`锛夈€?
---

## 3. 宸ュ叿璁捐锛堣兘鍔?鈫?绔偣鏄犲皠锛?
| DSH 宸ュ叿鍚?| 浣滅敤 | GenBox 绔偣 | 閲岀▼纰?|
|---|---|---|---|
| `genbox_status` | 鍋ュ悍妫€鏌?/ 杩愯鐘舵€?| `GET /api/status`銆乣/api/runtime/status` | M1 |
| `genbox_providers` | 鍒楀嚭 provider銆佹ā鍨嬩笌鑳藉姏锛堝昂瀵?鏀瑰浘鎺堟潈锛?| `GET /api/providers`銆乣/api/video/model-specs` | M2 |
| `genbox_image_generate` | **鏂囩敓鍥?*锛屽彲澶氭ā鍨嬪苟鎺掑姣?| `POST /api/generate` + 杞 | M2 |
| `genbox_image_edit` | **鏀瑰浘**锛氬浘鐢熷浘銆佸眬閮ㄩ噸缁橈紙mask锛夈€佹墿鍥?| `POST /api/generate`锛堝弬鑰冨浘/mask锛? `/api/precision/*` | M3 |
| `genbox_image_upscale` | 瓒呭垎杈ㄧ巼 | `POST /api/images/upscale` | M3 |
| `genbox_image_variations` | 鐢熸垚鍙樹綋 | `POST /api/images/variations` | M3 |
| `genbox_cutout` | 鎶犲浘 / 鍓嶆櫙鎭㈠ / 杈圭紭绮句慨 | `POST /api/image-tools/cutout`銆乣/refine` | M3 |
| `genbox_video_generate` | **鏂囩敓瑙嗛 / 鍥剧敓瑙嗛 / 棣栧熬鍏抽敭甯?* | `POST /api/video/generate` + 杞 | M4 |
| `genbox_gallery` | 濯掍綋搴撴绱笌鍙栧洖锛堝浘鐗?瑙嗛/鎻愮ず璇?妯″瀷锛?| `GET /api/gallery`銆乣/api/gallery/image/{f}`銆乣/api/video/file/{f}` | M5 |
| `genbox_prompt_optimize` | 鎻愮ず璇嶄紭鍖?| `POST /api/llm/optimize` | M5 |
| ~~`genbox_video_edit`~~ | **鏀硅棰戯紙鍓緫/鎹㈠唴瀹?缁啓锛?* | **GenBox 鏃犲疄鐜?* | 闇€绔嬮」 |

### 3.1 "鏀硅棰?鐨勭幇瀹為€夐」

1. **M4 鍏堝仛"鍐嶇敓鎴愬紡鏀硅棰?**锛氫互鍙傝€冨浘 + 棣栧熬甯?+ 鏂版彁绀鸿瘝閲嶆柊鐢熸垚锛圙enBox 鐜版垚鑳藉姏锛夈€?2. **涓湡**锛氬湪鎻掍欢渚у仛"鍒嗘鐢熸垚 + ffmpeg 鎷兼帴/瑁佸壀/鍙橀€?鍔犲瓧骞?鐨勭紪鎺掞紙ffmpeg 鏈満宸叉湁 Electron 闄勫甫锛屼絾鎻掍欢搴斾緷璧栫郴缁?ffmpeg锛夈€?3. **闀挎湡**锛氭帹鍔?GenBox 鐨?Video Workbench锛堝畠鑷繁鐨?`docs/VIDEO-WORKBENCH-*.md` 绯诲垪锛夎惤鍦板悗鍐嶆帴銆?
---

## 4. 鐩綍缁撴瀯锛坄E:\AI\GenBox-dsh`锛?
```
E:\AI\GenBox-dsh\
鈹溾攢 PLAN.md                  # 鏈枃妗ｏ紙璋冪爺 + 璁捐锛?鈹溾攢 README.md                # 浣跨敤鑰呰鏄?鈹溾攢 package.json             # dsh-genbox-plugin锛屽０鏄?dsh.bundle
鈹溾攢 cordis.patch.yml         # bundle 瀹夎鏃跺簲鐢ㄧ殑閰嶇疆灞?鈹溾攢 tsconfig.json
鈹溾攢 src\
鈹? 鈹溾攢 index.ts              # apply(ctx, config)锛屾敞鍐屽叏閮ㄥ伐鍏?鈹? 鈹溾攢 config.ts             # Config 鎺ュ彛 + Schemastery schema
鈹? 鈹溾攢 client.ts             # GenBox HTTP 瀹㈡埛绔紙璁よ瘉/瓒呮椂/杞/涓嬭浇锛?鈹? 鈹溾攢 server.ts             # 锛堝彲閫夛級鑷姩鎷夎捣/鍋滄 GenBox 杩涚▼
鈹? 鈹斺攢 tools\
鈹?    鈹溾攢 health.ts
鈹?    鈹溾攢 image.ts           # 鐢熷浘 / 鏀瑰浘 / 瓒呭垎 / 鍙樹綋
鈹?    鈹溾攢 video.ts           # 鏂囩敓瑙嗛 / 鍥剧敓瑙嗛
鈹?    鈹溾攢 media.ts           # 濯掍綋搴?/ 涓嬭浇
鈹?    鈹斺攢 cutout.ts
鈹溾攢 dev\
鈹? 鈹斺攢 overlay.cordis.yml    # 鐢?--patch 鎸傝浇鏈湴鎻掍欢锛堝紑鍙戠儹杩唬锛?鈹斺攢 upstream\GenBox\        # 瀹樻柟浠撳簱 clone锛坓itignore锛屼粎鍙傝€?鑱旇皟锛?```

---

## 5. 寮€鍙戞楠わ紙閲岀▼纰戯級

### M0 路 鐜锛堝墠缃級
1. `corepack enable`锛堟垨瑁?pnpm锛夆€斺€斿畼鏂规暀绋嬬敤 `pnpm`銆?2. 璁?GenBox 鑳借窇璧锋潵锛氬湪 `upstream/GenBox` 寤?venv銆佽 `requirements.txt`銆乣python main.py` 鎴?`uvicorn` 璧?8892锛涚‘璁?`GET /api/status` 杩斿洖 200銆?   - 闇€瑕?*鑷冲皯涓€涓?provider 鐨?API Key**锛圤penAI 鍏煎 / Gemini / Qwen / 鐏北 鈥︼級锛屽惁鍒欏彧鑳介獙璇佸埌"鎺ュ彛杩為€?銆?   - 鈿狅笍 椋庨櫓锛氭湰鏈?Python 鏄?**3.14.3**锛岃€?GenBox 閽夌殑 pydantic 2.13 / pillow 12.3 鏄惁閮芥湁 3.14 wheel 闇€瑕佸疄娴嬶紱涓嶈灏辫涓€涓?3.11/3.12 鐨勭嫭绔嬭В閲婂櫒銆?3. 璁板綍璁よ瘉妯″紡锛歚APP_MODE=dev` 鏃舵槸鍚﹀厤 `X-Admin-Key`锛堢敱 API 濂戠害纭锛夛紝prod 鏃舵妸 key 鍐欒繘鎻掍欢閰嶇疆銆?
### M1 路 鎻掍欢楠ㄦ灦锛堟渶灏忓彲鍔犺浇锛?- 寤?`package.json`锛坄dsh.bundle.patch`锛? `cordis.patch.yml` + `tsconfig.json` + `src/index.ts`銆?- 鍏堝彧娉ㄥ唽 `genbox_status`锛岃窇閫?鎻掍欢琚姞杞?鈫?宸ュ叿鍑虹幇鍦ㄤ細璇濋噷 鈫?鑳借皟鍒?GenBox"銆?- 瀹夎楠岃瘉锛堜簩閫変竴锛夛細
  - **寮€鍙戞€?*锛堟帹鑽愬厛鍋氾級锛氭柊寤轰竴涓嫭绔?profile锛屽 `dsh --profile genbox-dev --from-default-profile web`锛屽啀鐢?`--patch ` 鎸傛湰鍦版彃浠讹紝閬垮厤鎶婃鍦ㄧ敤鐨?Desktop profile 寮勫潖銆?  - **姝ｅ紡鎬?*锛歚dsh plugin --profile desktop add E:\AI\GenBox-dsh`锛岃 Desktop 閲嶅惎鍚庡姞杞姐€?
### M2 路 鐢熷浘
- `genbox_image_generate`锛歱rovider/model/prompt/size/n/鍙傝€冨浘 鈫?`POST /api/generate` 鈫?杞 `/api/generate/status/{gen_id}` 鈫?涓嬭浇缁撴灉鍒?`outputDir` 鈫?杩斿洖 `{ files: [...], genId, model, provider }`锛宍output.render` 閲岃繑鍥炴枃鏈?+ 鍥剧墖銆?- 鍔?`genbox_providers` 鍋氳皟鐢ㄥ墠鑳藉姏妫€鏌ャ€?- 鍔?`presentCall/presentResult` 鍗＄墖锛堝彲閫夛紝鍏?generic锛夈€?
### M3 路 鏀瑰浘
- `genbox_image_edit`锛氬浘鐢熷浘 / mask 灞€閮ㄩ噸缁?/ 鎵╁浘锛涘弬鏁颁粠鑳藉姏澹版槑鎺ㄥ锛堝昂瀵告巿鏉冦€佹槸鍚︽敮鎸佹敼鍥撅級銆?- `genbox_image_upscale`銆乣genbox_image_variations`銆乣genbox_cutout`銆?
### M4 路 瑙嗛
- `genbox_video_generate`锛氭枃鐢熻棰?/ 鍥剧敓瑙嗛 / 棣栧熬甯э紱闀夸换鍔¤蛋 `ctx.jobs`锛堣棰戝姩杈勬暟鍒嗛挓锛屼笉鑳藉崰鐫€宸ュ叿璋冪敤锛夈€?- 瑙嗛鏂囦欢鐢?`GET /api/video/file/{filename}` 涓嬭浇鍒版湰鍦般€?
### M5 路 濯掍綋搴撲笌鎵撶（
- `genbox_gallery`锛堝垪琛?绛涢€?鍙栧洖鍥剧墖涓庤棰戯級銆乣genbox_prompt_optimize`銆?- 鍥剧墖鍦?UI 鍗＄墖涓庢ā鍨嬩笂涓嬫枃鐨勫洖浼犵瓥鐣ワ細澶у浘璧伴檮浠惰惤鐩?+ 寮曠敤璺緞锛岄伩鍏嶆拺鐖嗕笂涓嬫枃銆?
### M6 路 浜や粯涓庡彂甯?- 鏂囨。銆侀厤缃鏄庛€侀敊璇鐞嗕笌瓒呮椂锛涙墦鍖咃紙`tsdown` 鏋勫缓 `lib/`锛夈€?- 鍒嗗彂锛歯pm 鍙戝竷锛堥鏋勫缓锛夋垨 tarball锛汫itHub 浠撳簱鍔?**`dsh-plugin` topic**锛堝畼鏂硅础鐚寚鍗楁槑纭繖鏄ぞ鍖烘彃浠剁殑鍙戠幇鏂瑰紡锛夈€?- 鑻ヨ鍙戝埌鏈満 Desktop锛歚dsh plugin --profile desktop add` + 閲嶅惎銆?
---

## 6. 椋庨櫓涓庡緟瀹氶」

| # | 椋庨櫓/寰呭畾 | 褰卞搷 | 澶勭悊 |
|---|---|---|---|
| R1 | 鏈満娌¤ GenBox銆?892 鏈洃鍚?| 鏃犳硶绔埌绔獙璇?| M0 鍏堣窇璧锋潵锛堟垨鐢辨彃浠惰嚜鍔ㄦ媺璧凤級 |
| R2 | 闇€瑕?provider API Key | 鏃?key 鍙兘楠岃瘉鍒版帴鍙ｅ眰 | 鐢变綘纭畾鐢ㄥ摢涓?provider / 鏄惁澶嶇敤 Desktop 宸查厤缃殑 key |
| R3 | Python 3.14 涓?GenBox 渚濊禆鍏煎鎬ф湭鐭?| M0 鍙兘澶辫触 | 瀹炴祴锛涘繀瑕佹椂鐢?3.11/3.12 鐙珛瑙ｉ噴鍣?|
| R4 | GenBox 鏃?鏀硅棰? | 鐩爣涔嬩竴涓嶅畬鏁?| 鍏?鍐嶇敓鎴愬紡鏀硅棰?锛岀紪杈戣兘鍔涘彟绔嬮」 |
| R5 | GPL-3.0 | 璁稿彲浼犳煋 | 鍙€氳繃 HTTP 璋冪敤锛涗笉鎷疯礉鍏舵簮鐮?甯搁噺鍒版彃浠?|
| R6 | `dsh` CLI 0.1.5 vs Desktop 鍐呯疆 0.2.0 | 瀹夎鍙兘涓嶇敓鏁?| 浠?Desktop 鍐呯疆鐗堟湰涓哄噯锛涘繀瑕佹椂鐢?Desktop 鐨勬彃浠剁鐞嗙晫闈?|
| R7 | 寰€ `desktop` profile 瑁呮彃浠朵細褰卞搷姝ｅ湪杩愯鐨?DSH NEXT | 鍙兘寮勫潖褰撳墠鐜 | 鍏堝缓 `genbox-dev` profile 楠岃瘉锛屾渶鍚庡啀杩?desktop |
| R8 | 鍥剧墖/瑙嗛鍥炰紶妯″瀷鐨勬満鍒讹紙闄勪欢/鍥剧墖鍐呭鍧楋級鏈獙璇?| 妯″瀷"鐪嬩笉鍒板浘" | M2 鍏堣惤鐩?+ 鏂囨湰杩斿洖璺緞锛屽啀楠岃瘉 image content 娓叉煋 |

---

## 7. 闇€瑕佷綘纭

1. **鎺ュ叆褰㈡€?*锛氱‘璁よ蛋"HTTP 瀹㈡埛绔彃浠?锛堟柟妗?A锛夛紝涓嶆敼 GenBox 鏈綋锛?2. **GenBox 杩愯鏂瑰紡**锛氱敱浣犳墜鍔ㄥ父椹昏繍琛岋紱杩樻槸璁╂彃浠跺湪 8892 绌洪棽鏃惰嚜鍔ㄦ媺璧?`upstream/GenBox`锛堥渶瑕佸彲鐢?Python 鐜 + API Key锛夛紵
3. **楠岃瘉鐢ㄧ殑 provider**锛氱敤鍝釜锛熸湁娌℃湁鐜版垚 key 鍙互鍦ㄦ湰鏈鸿仈璋冿紙涓嶉渶瑕佹垜璁板綍鏄庢枃锛屽彧瑕佺‘璁ゅ彲閫夛級锛?4. **鏀硅棰戠殑鑼冨洿**锛氬厛鎺ュ彈"鍥?鍏抽敭甯ч┍鍔ㄧ殑鍐嶇敓鎴?锛岃繕鏄繖娆″氨瑕佹妸 ffmpeg 缂栨帓锛堣鍓?鎷兼帴/鍙橀€?瀛楀箷锛変竴璧峰仛锛?5. **鎻掍欢鍛藉悕/浠撳簱**锛氬寘鍚嶆部鐢?`dsh-genbox-plugin`銆佷粨搴?`GenBox-dsh` 鍙互鍚楋紵

---

## 8. 杩涘睍涓庡疄娴嬭褰曪紙婊氬姩鏇存柊锛?
### 宸插畬鎴?
| 閲岀▼纰?| 缁撹 | 璇佹嵁 |
|---|---|---|
| M0 鐜 | 鉁?GenBox v2.6.12 浠?dev 妯″紡璺戝湪 `127.0.0.1:8892`锛圥ython 3.11.15 venv锛岄伩寮€鏈満 3.14锛夈€俙/api/setup/status` 杩斿洖 `auth_required:false` | 瑙?[docs/local-dev.md](docs/local-dev.md) |
| M1 楠ㄦ灦 | 鉁?tsdown 鏋勫缓鍑?`lib/index.js`锛涚湡瀹?Cordis `apply` + 鐪熷疄 `defineTool` 娉ㄥ唽鍑?`genbox_health` 骞舵垚鍔熻皟鐢?`/api/status`锛沗dsh --profile web --patch dev/overlay.cordis.yml --dump-config` 閫€鍑虹爜 0 涓旇兘鐪嬪埌 `id: genbox` 琛?| `scripts/verify-plugin.mjs` |
| M2 鐢熷浘 | 鉁?`genbox_providers` / `genbox_image_generate` 瀹炵幇骞堕€氳繃**绔埌绔?*楠岃瘉锛氭彁浜?鈫?杞 鈫?浠?`/api/gallery/image/{filename}` 涓嬭浇 鈫?钀界洏 鈫?娓叉煋 | `scripts/verify-tools.mjs` |
| M3 閮ㄥ垎 | 馃煛 `genbox_image_edit` 鐨?`i2i` / `inpaint` / `precision_edit` 宸插疄鐜帮紱i2i 宸茬鍒扮楠岃瘉 | 鍚屼笂 |

### 鍏抽敭瀹炴祴鍙戠幇锛堣秴鍑洪潤鎬佸绾︽姤鍛婏級

1. **`NO_PROXY` 閲岀殑 `[::1]` 浼氳 GenBox 鐨?httpx 瀹㈡埛绔瀯閫犵洿鎺ユ姏閿?*锛坄Invalid port: ':1]'`锛夈€侱SH 瀹夸富鎶?`NODE_USE_ENV_PROXY`/`HTTP_PROXY`/`NO_PROXY` 瀵煎嚭缁欏瓙杩涚▼锛岃€?`NO_PROXY` 鍚?`[::1]`锛汣Python 鎶婂畠鍘熸牱濉炶繘 `getproxies()['no']`锛宧ttpx 0.28 瑙ｆ瀽鍗冲穿銆?*浠讳綍鐪熷疄 provider 閮戒細琚繖涓潙鎷︿綇**锛屼笉鍙槸 mock銆備慨澶嶆柟寮忎笌澶嶇幇璁板綍瑙?[docs/local-dev.md](docs/local-dev.md)銆?2. **鏃?key 涔熻兘瀹屾暣楠岃瘉閾捐矾**锛氱粰 GenBox 娉ㄥ唽涓€涓湰鍦?OpenAI 鍏煎鍋囧浘搴婏紙`scripts/mock-openai-image.py`锛夛紝灏辫兘鎶?鎻掍欢 鈫?GenBox 鈫?provider 鈫?鍥惧簱 鈫?鎻掍欢涓嬭浇"鏁存潯璺窇閫氥€?3. 鍥剧墖缁撴灉纭疄鍙湁 `local_path`锛堢粷瀵硅矾寰勶級锛屽繀椤荤敤 `basename` 鍘?`/api/gallery/image/{filename}` 鍙栧瓧鑺傦紱`results` 鍙湪缁堟€佸嚭鐜般€?4. 鐢熸垚浠诲姟绾唴瀛橈細杩涚▼閲嶅惎鍚庢棫 `gen_id` 涓€寰?404銆?5. 宸ュ叿杩斿洖鏈湴鏂囦欢璺緞鍚庯紝妯″瀷鍙互鐩存帴鐢?DSH 鍐呯疆鐨?`read_image` 鐪嬪浘鈥斺€旀殏鏃朵笉闇€瑕佽嚜宸卞幓鏋勯€?attachment銆?
### 寰呭姙

- M3 鏀跺熬锛歚genbox_image_upscale`銆乣genbox_image_variations`銆乣genbox_cutout`銆?- M4 瑙嗛锛歚genbox_video_generate`锛堟敞鎰?Gemini 璺緞 POST 鏈€闀块樆濉?300s锛? 璧?`ctx.jobs` 鐨勫悗鍙颁换鍔°€?- M5 濯掍綋搴擄細`genbox_gallery`銆乣genbox_prompt_optimize`銆?- M6 浜や粯锛氭墦鍖呫€佹枃妗ｃ€乣dsh-plugin` topic銆乶pm 鍙戝竷銆?- 涓庣湡瀹?provider 鐨勮仈璋冿紙闇€瑕佺敤鎴锋彁渚?Key 鎴栧湪 GenBox 鐣岄潰閰嶇疆锛夈€?- 瀹夎杩涙湰鏈?`desktop` profile 骞跺湪 DSH GUI 閲屽疄鏈洪獙璇併€?### 绗?3 杞ˉ璁帮紙M3 鏀跺熬 + M4锛?
| 閲岀▼纰?| 缁撹 | 璇佹嵁 |
|---|---|---|
| M3 鏀跺熬 | 鉁?`genbox_image_upscale`锛?12鈫?024锛屾湰鍦?Lanczos锛屾棤闇€ Key锛夈€乣genbox_image_variations` 绔埌绔€氳繃锛沗genbox_cutout` 宸插疄鐜帮紝鏈 checkpoint 鏃惰繑鍥炴竻鏅扮殑 `cutout_model_missing` 鍘熷洜 | `scripts/verify-tools.mjs`銆乣scripts/verify-cutout.mjs` |
| M4 瑙嗛 | 鉁?`genbox_video_generate` 绔埌绔€氳繃锛氭敞鍐屼竴涓?volcengine 鍗忚鐨?mock 瑙嗛 provider锛宍/api/video/generate` 鈫?杞 鈫?鏈嶅姟绔惤鐩?鈫?鎻掍欢涓嬭浇 2080B mp4锛?0.1s锛?| 鍚屼笂 |
| 瀹夎楠岃瘉 | 鉁?鐢?`dsh --profile genbox-dev --from-default-profile web` 寤虹嫭绔?profile锛宍dsh plugin --profile genbox-dev add E:/AI/GenBox-dsh` 瑁呮垚 bundle锛堣嚜鍔ㄨ繘 `dsh.profile.bundles`锛夛紝`--dump-config` 鍑虹幇 `# == dsh-genbox-plugin` 灞傦紝涓?*瀹為檯鍚姩鎴愬姛**锛堟墦鍗?web URL锛屾彃浠?import 鏃犳姤閿欙級 | 瑙佷笅鏂瑰懡浠?|

**"鏀硅棰?鐨勮惤鍦版柟寮?*锛欸enBox 娌℃湁瑙嗛缂栬緫锛屾墍浠ユ湰鎻掍欢鎶婂畠瀹炵幇涓?*鍐嶇敓鎴愬紡鏀硅棰?*鈥斺€擿mode=i2vid`锛堝崟鍙傝€冨浘 + 鏂版彁绀鸿瘝锛変笌 `mode=keyframes`锛堥灏惧抚锛夈€傜湡瑕佸壀杈?鎷兼帴/鍙橀€燂紝灞炰簬鍚庣画 ffmpeg 缂栨帓鎴?GenBox 鑷韩 Video Workbench 钀藉湴鍚庣殑浜嬨€?
**椤哄甫鐨勬満鍣ㄧ骇鏀瑰姩**锛堥兘宸茶褰曞湪 [docs/local-dev.md](docs/local-dev.md)锛夛細
1. 鏂?venv 鐨?`sitecustomize.py` 鍓旈櫎 `NO_PROXY` 閲岀殑 `[::1]`锛堜慨 httpx 宕╂簝锛夈€?2. 鏂板缓 `C:\Users\18722\AppData\Roaming\npm\pnpm.cmd` 杞彂鍒?`corepack pnpm`锛屽洜涓?`dsh plugin` 闇€瑕?PATH 涓婃湁鐪熸鐨?pnpm銆?
**鍓╀綑**锛歁5 `genbox_gallery` / `genbox_prompt_optimize`锛汳6 鎵撳寘涓庡彂甯冿紙npm / `dsh-plugin` topic锛夛紱鐪熷疄 provider 鑱旇皟锛涜杩?`desktop` profile 鐢?GUI 瀹炴満楠岃瘉銆?### 绗?3 杞ˉ璁帮紙M5 + 缂栬緫鍒嗘敮瀹炴祴锛?
| 椤?| 缁撹 |
|---|---|
| `genbox_gallery` | 鉁?鍒楀嚭鏈€杩?5 椤瑰苟澶嶅埗鍒版湰鍦帮紙4 鍥?+ 1 瑙嗛锛夛紱瑙嗛璧?`/api/video/file/{name}`銆佸浘鐗囪蛋 `/api/gallery/image/{name}` |
| `genbox_prompt_optimize` | 鉁?鏃?LLM provider 鏃惰繑鍥?GenBox 鐨勫師鏂囧洖閫€ + `鏈厤缃?LLM Provider`锛岃涓轰笌濂戠害涓€鑷?|
| `mode=inpaint` | 鉁?缁?mock provider 鍔犱笂 `capabilities.inpaint_mask=true` 鍚庣鍒扮閫氳繃锛涙湭鍔犳椂 GenBox 杩斿洖 422 `inpaint_provider_unsupported`锛堣鏄?`mask_data`/`mask_contract` 宸叉纭€佽揪锛?|
| `mode=precision_edit` | 鈿狅笍 琚?GenBox 鐨?`precision_edit_provider_unsupported` 鎷︽埅锛氬畠瑕佹眰"鏄惧紡楠岃瘉杩囩殑鏀瑰浘妯″瀷 + 鍖归厤浼犺緭"锛屾湰鍦?mock 鏃犳硶浼€犮€?*杩欎笉鏄彃浠剁己闄?*锛岃€屾槸 GenBox 鍒绘剰鐨勬巿鏉冮棬妲涳紱鐢ㄧ湡瀹?GPT-image/Gemini 绔偣鏃舵墠鍙兘閫氳繃 |

**缁撹**锛氬伐鍏烽潰锛?0 涓級宸茶鐩栫洰鏍囬噷鐨勭敓鍥俱€佹敼鍥俱€佺敓瑙嗛銆佸獟浣撳簱锛沗鏀硅棰慲 浠?`i2vid`/`keyframes` 鍐嶇敓鎴愬疄鐜般€傚墿涓嬬殑鏄垎鍙戯紙M6锛変笌鐪熷疄 provider 鑱旇皟銆?
### 第 4 轮补记（M6 打包分发）

| 项 | 结论 | 证据 |
|---|---|---|
| tarball 内容 | ✅ `pnpm pack` 产物含 `lib/index.js`、`lib/index.d.ts`、`package.json`、`cordis.patch.yml`、`README.md` | `tar -tzf` |
| tarball 安装 | ✅ 先 `remove` 掉 link 安装，再 `dsh plugin --profile genbox-dev add ./dsh-genbox-plugin-0.1.0.tgz`，包名自动进入 `dsh.profile.bundles` | profile `package.json` |
| 宿主加载 | ✅ 启动时打印 `[genbox] plugin loaded (baseUrl=http://127.0.0.1:8892)` —— 这是宿主真的 import 并执行了 `apply` 的直接证据 | `dsh --profile genbox-dev --port 3096 --no-open` |
| peer 解析 | ✅ profile 的 `node_modules` 里**没有** `@deepseek-ai/dsh-tools` / `schemastery` / `cordis`（pnpm 只报 peer 警告），插件依然加载成功 —— 说明宿主运行时替插件解析了这些包，与官方发布文档描述一致 | 同上 |
| 仓库 | ✅ `git init` + 首次提交（28 个文件，作者沿用全局身份 liwei9745）；`lib/`、`upstream/`、`.genbox-out/`、`*.tgz` 已忽略 | `git log` |
| git 安装路径 | ✅ 增加 `prepare` 脚本并实测可构建出 `lib/`，这是 `dsh plugin add github:...` 能工作的前提 | `pnpm run prepare` |

**新增文档**：[docs/install.md](docs/install.md)（安装三种方式 / 验证命令 / 配置 / 7 条排错），README 重写为可直接对外发布的形态（状态表、安装、工具表、配置、发布清单）。

**仍待用户参与的两件事**：
1. 真实 provider 联调（需要 GenBox 侧配置 API Key；插件侧无需改动）。
2. 装进 `desktop` profile 并用 DSH GUI 实机验证（需重启 DSH NEXT）。

### 第 5 轮（新目标 G4a：非阻塞提交）

- 给 `genbox_image_generate` / `genbox_image_edit` / `genbox_video_generate` 加了 `background: true`：提交后立刻返回 id，不再占着工具调用等几分钟。
- 新增 `genbox_task`：按 id 查询状态、完成后下载结果、也可 `cancel: true` 取消。
- 实测（[scripts/verify-background.mjs](scripts/verify-background.mjs)）：生图 **85ms** 返回 id → `genbox_task(kind=image)` settled `completed` 并落盘 1990B；视频同样 settled 并落盘 2080B mp4。`tsc --noEmit` 干净。

**同轮发现的阻塞项（需要你处理）**：用 `dsh` CLI 跑真实会话时被认证挡住——
`@
dsh: AUTH: Authentication Fails, Your api key: ****ocal is invalid
`@
也就是说：**命令行 profile（包括我开的 3099 实验室）拿到的 API Key 是无效的**；而这个 Desktop 会话本身是正常的。因此"模型 → 工具调用"这一层的端到端验证在当前 CLI 凭据修好之前做不了。可选解法见 [ROADMAP.md](ROADMAP.md)：要么在 CLI 环境配一个有效 Key，要么把插件装进 `desktop` profile 后重启 DSH NEXT（Desktop 的凭据是好的）。

### 第 6 轮（G5a：本地 ffmpeg 视频编辑）

GenBox 没有视频编辑能力，所以这一段由插件自己用本机 ffmpeg 补上：`genbox_video_edit` 支持
`trim / concat / speed / mute / resize / extract_frame`，不依赖 GenBox，也不需要任何 API Key。

实测（[scripts/verify-video-edit.mjs](scripts/verify-video-edit.mjs)）：

`@
test clips will use encoder: libopenh264
trim:   durationSeconds 1.53 (0.5s -> 2s)        FILE-OK
concat: durationSeconds 5.04 (3s + 2s)           FILE-OK
speed:  durationSeconds 1.67 (3s @ 2x)           FILE-OK
mute:   durationSeconds 3                         FILE-OK
resize: 160x120                                   FILE-OK
frame:  edit_frame_*.png 14500B                   FILE-OK
OK
`@

过程中修掉两个真问题：① 本机 ffmpeg 构建**没有 libx264**，于是增加了编码器自动探测
（libx264 → h264_mf → libopenh264 → mpeg4，可用 `videoEncoder` 强制覆盖）；② concat 分支曾把 ffmpeg
跑了两遍（分支内一次、公共尾部又一次），已改为只跑一次并正确清理临时目录。

### 第 7 轮（G5b：视频编辑补齐到 11 个操作）

新增 `crop / volume / replace_audio / burn_subtitles / to_gif`。本机 ffmpeg 带 libass，所以字幕是真烧录
（`subtitles` 滤镜按 cwd 解析路径，代码里把子进程的 cwd 切到字幕文件所在目录再用文件名引用）。

`@
trim 1.53s | concat 5.04s | speed 1.67s | mute 3s | resize 160x120 | crop 160x120@20,20
volume 3.02s | replace_audio 2.07s | burn_subtitles 3s | to_gif 1.5s/38582B | extract_frame PNG
OK (11/11)
`@


### 第 8 轮（G5c：精准改图批注）

GenBox 的 precision_edit 要求"底图 + 批注叠加图 + 批注数组"三件套齐全，且叠加图必须与底图**像素尺寸完全一致**。
插件现在自己把批注画出来：纯 JS 的 PNG 编码器（zlib + CRC32，无原生依赖）+ 箭头/方框/椭圆/画笔 + 编号角标，
坐标从**像素**换算成 GenBox 要的 0..1 归一化值，并按 v3 契约校验（≤100 条、brush 2..1024 点、文本总量 ≤4000、
arrow 端点不可重合、矩形/椭圆必须正尺寸）。

实测：

`@
verify-annotate.mjs : base 320x240 -> overlay 2437B，ffprobe 独立验证 {"width":320,"height":240,"pix_fmt":"rgba"}  OK
verify-precision.mjs: 本地路径守卫 ok / model 守卫 ok
                      envelope passed GenBox input validation -> 停在 precision_edit_provider_unsupported（预期）
`@

**为什么"停在 provider 门槛"就是通过**：GenBox 先校验请求信封（annotation 三件套、尺寸一致性、契约字段），
再校验 provider 授权。如果我们的批注结构有问题，会在**第一步**就报 contract 错误；实际报的是第二步的门槛，
说明信封是合法的。缺少"真实已验证改图模型"是 GenBox 的授权设计，不是插件缺陷。

### 第 9 轮（社区排障：genbox_doctor）

新增自检工具 `genbox_doctor`：一次调用给出"可达性 / 认证模式 / provider 与 Key 就绪度 / 输出目录可写 /
ffmpeg 与 ffprobe"，每条失败都附可执行的修复建议。目的是让社区用户遇到问题时**先自检**，而不是贴一段 HTTP 报错。

实测（[scripts/verify-doctor.mjs](scripts/verify-doctor.mjs)）：

```
健康环境：no blocking problems
  [ok] GenBox reachable / Authentication(dev) / Runtime v2.6.12
  [ok] Providers: 2 enabled, 2 with a key (1 image, 1 video)
  [ok] Output directory writable / ffmpeg / ffprobe
故障环境（baseUrl 指向死端口）：blocking problem found
  [fail] GenBox reachable: cannot reach http://127.0.0.1:9 (fetch failed) + fix 建议
  [fail] Providers
OK
```
