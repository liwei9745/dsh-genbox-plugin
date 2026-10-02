# GenBox HTTP API 契约报告（面向 Node/TypeScript 客户端）

**分析对象**：`E:\AI\GenBox-dsh\upstream\GenBox`
**主文件**：main.py（406 KB，131 个路由装饰器，18 个 main.py 内 pydantic 模型）
**性质**：只读静态分析（未运行服务、未修改任何仓库文件）。未确认处标注 `[未确认]`。
**版本线索**：镜像标签 2.6.12（docker-compose.yml:3）。

---

## 1. 认证与安全

### 1.1 admin_auth_middleware（main.py:7120-7146）

```python
7120: AUTH_EXEMPT_PATHS = {
7121:     "/api/setup/status",
7122:     "/api/runtime/status",
7123:     "/api/sync/push",
7124:     "/api/sync/push/status",
7125:     "/favicon.ico",
7126: }
7128: @app.middleware("http")
7129: async def admin_auth_middleware(request: Request, call_next):
7131:     if not is_prod_mode():
7132:         return await call_next(request)
7134:     path = request.url.path
7136:     if not path.startswith("/api/"):
7137:         return await call_next(request)
7139:     if path in AUTH_EXEMPT_PATHS:
7140:         return await call_next(request)
7143:     admin_key = request.headers.get("X-Admin-Key", "")
7144:     if not verify_admin_key(admin_key):
7145:         return JSONResponse(status_code=401, content={"error": "未授权，请先登录", "code": "AUTH_REQUIRED"})
```

判定顺序（严格自上而下）：

1. **非生产模式直接放行**：`is_prod_mode()` 为 False 时，所有路径（含全部 `/api/*`）不需要任何认证头。
2. **非 `/api/` 前缀直接放行**：`/`、`/static/*` 等静态资源永远免认证（main.py:9030 挂载 `/static`）。
3. **5 个白名单路径免认证**：`/api/setup/status`、`/api/runtime/status`、`/api/sync/push`、`/api/sync/push/status`、`/favicon.ico`。其中 `/api/sync/push*` 走**独立来源密钥**认证，`X-Admin-Key` 反而被拒（tests/test_sync_push_routes.py:117-143 固化了"/api/gallery 无 key=401、有 key=200"）。
4. 其余全部 `/api/*`（含 GET）要求 `X-Admin-Key` 头，失败返回 **401** `{"error":"未授权，请先登录","code":"AUTH_REQUIRED"}`。

### 1.2 dev 模式与绕过（无 loopback 白名单）

```python
config.py:1367: def is_prod_mode() -> bool:
config.py:1369:     return os.getenv("APP_MODE", "prod").strip().lower() != "dev"
config.py:1371: def verify_admin_key(key: str) -> bool:
config.py:1373:     if not is_prod_mode():
config.py:1374:         return True  # 开发模式免认证
config.py:1375:     stored_hash = get_admin_key_hash()
config.py:1376:     if not stored_hash:
config.py:1377:         return False
config.py:1378:     return secrets.compare_digest(_hash_admin_key(key), stored_hash)
```

- **默认即生产**：`APP_MODE` 未设置时 `is_prod_mode()` 为 True，认证开启。
- **`APP_MODE=dev` 不需要 `X-Admin-Key`，且没有请求级"仅允许 loopback"检查**。middleware 中不存在 `request.client.host` 判断（该变量只出现在生图限流，main.py:4305）。
- **loopback 只在 bind 阶段强制**（main.py:9137-9147）：
  ```python
  9140: resolved_host = "127.0.0.1" if normalized_mode == "dev" else (host or "0.0.0.0")
  9141: uvicorn.run(app, host=resolved_host, port=port, reload=False, use_colors=False)
  ```
  **风险**：若用 `uvicorn main:app --host 0.0.0.0` 绕过 main.py 入口并保留 `APP_MODE=dev`，整个 API 无认证。
- prod 且 `ADMIN_KEY` 为空时启动被阻断：`_require_production_admin_key`（main.py:9128-9134）抛 SystemExit。
- `ADMIN_KEY` 读自 .env（config.py:1356-1358），仅 SHA-256 比对（config.py:1352-1354），常量时间比较。

### 1.3 csrf_protection（main.py:1901-1928）

```python
1904: if request.method in ("POST", "PUT", "DELETE"):
1905:     origin = request.headers.get("origin", "")
1906:     referer = request.headers.get("referer", "")
1907:     source = origin or referer
1908:     if source:
1909:         source_authority = urlsplit(source).netloc.lower()
1910:         request_authority = request.headers.get("host", "").lower()
...
1920:         if not source_authority or (
1921:             source_authority != request_authority
1922:             and source_authority not in allowed_authorities
1923:         ):
1924:             return JSONResponse(status_code=403, content={"error": "CSRF 验证失败", "code": "CSRF_REJECTED"})
1928: return await call_next(request)
```

- **对无 Origin/Referer 头的非浏览器客户端：放行**。`source` 为空则整个校验块跳过。Node/TS 客户端不发这两个头就不会被 CSRF 拦截（tests/test_csrf.py:11-38：同源 200，跨源 403）。
- 校验方式：`Origin/Referer` 的 netloc 必须等于请求 `Host` 头，或在允许集合内。允许集合 = `ALLOWED_ORIGINS` + `GENBOX_LOCAL_URL`/`GENBOX_LOOPBACK_URL` + 硬编码 `http://localhost:8890` 与 `http://127.0.0.1:8890`（1911-1919）。
- 只覆盖 `POST/PUT/DELETE`；**PATCH 不校验**。只比 authority，不比 scheme/path；`Origin: null` 会因 netloc 为空被 403。

### 1.4 CORS（main.py:1846-1860）

```python
1849: GENBOX_PORT = int(os.getenv("GENBOX_PORT", "8891"))
1853: ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", f"{GENBOX_LOCAL_URL},{GENBOX_LOOPBACK_URL}").split(",")
1854: app.add_middleware(CORSMiddleware,
1856:     allow_origins=ALLOWED_ORIGINS,
1857:     allow_credentials=True,
1858:     allow_methods=["GET", "POST", "PUT", "DELETE"],
1859:     allow_headers=["*"])
```

- 默认只允许 `http://localhost:8891` 与 `http://127.0.0.1:8891`；无 `allow_origin_regex`。
- `allow_methods` 不含 PATCH，但仓库有 PATCH 路由（如 main.py:8395）→ 浏览器跨源 PATCH 预检会失败 `[未确认：仅从配置推断]`。
- **中间件顺序（框架语义推断，[未确认]）**：注册顺序 CORS(1854) → security headers(1879) → CSRF(1901) → admin auth(7128)；Starlette `add_middleware` 用 `insert(0)`，故执行顺序为 **admin auth → CSRF → security headers → CORS**。prod 下跨源 `OPTIONS /api/*` 预检会先被 admin middleware 判为未授权并返回 401，浏览器 CORS 预检可能失败。仓库无对应测试。
- 安全响应头（1879-1898）：`X-Content-Type-Options`、`X-Frame-Options: DENY`、CSP、prod 下 HSTS。

### 1.5 端口与启动 / headless

| 项 | 值 | 出处 |
|---|---|---|
| 默认端口 | **8891**（`GENBOX_PORT` 覆盖） | main.py:1849, 9162 |
| 绑定 | dev→`127.0.0.1`；prod→`0.0.0.0` | main.py:9140 |
| 源码启动 | `python main.py` → `run_application()` | main.py:9194-9195, start.ps1:116 |
| 免浏览器 | `GENBOX_NO_BROWSER=1`（仅打包版会尝试开浏览器） | main.py:9178-9189 |
| Docker headless | `GENBOX_NO_BROWSER=1` + `APP_MODE=prod` + `GENBOX_PORT=8891` | Dockerfile:6, docker-compose.yml:8-11 |
| 首次非交互启动 | 自动写入 `APP_MODE=prod` | main.py:9049-9061 |
| .env.example | 用 **8892** 且 `APP_MODE=dev`（模板与代码默认不一致） | .env.example:4-7 |
| 健康检查 | `GET /api/setup/status` | Dockerfile:34-35 |

---

## 2. 图片生成

### 2.1 `POST /api/generate` 请求体：`GenerateRequest`（main.py:241-304）

| 字段 | 类型 | 必填/默认 | 语义 |
|---|---|---|---|
| `prompt` | str | **必填** | 提示词（precision_edit 上限 2000 字符） |
| `providers` | List[str] | `[]` | Provider ID 列表；空=全部启用 image provider（4310-4313） |
| `enhance_prompt` | bool | `False` | 仅 t2i 生效，调 LLM 优化提示词（4368-4372） |
| `llm_provider_id` | str? | `None` | 指定优化用的 LLM Provider |
| `size` | str? | `None` | 形如 `1024x1024`；precision preserve 模式必须为空或 `auto` |
| `quality` | str? | `None` | 质量档，透传上游 |
| `mode` | str | `"t2i"` | `t2i\|i2i\|inpaint\|precision_edit`（非法→422 `invalid_mode`） |
| `image_data` | str? | `None` | base64 或 data URL；i2i/inpaint/precision_edit 的底图 |
| `image_data_list` | List[str] | `[]` | i2i 多参考图；与 `image_data` 同时给出时前者必须等于第 1 张（1224-1229） |
| `mask_data` | str? | `None` | inpaint 遮罩（白色=编辑），必须 PNG 且与底图同尺寸 |
| `mask_contract` | str? | `None` | inpaint 固定 `"genbox-edit-white-v1"`（main.py:339） |
| `annotation_image_data` | str? | `None` | precision_edit 批注叠加图（必须 PNG） |
| `annotation_contract` | str? | `None` | `genbox-annotation-v1/v2/v3`（main.py:344-348） |
| `annotations` | List[dict] | `[]` | 归一化坐标批注（见 3.2） |
| `precision_strategy` | str | `"standard"` | `fine\|standard\|fast` |
| `precision_selection_mode` | str | `"annotation"` | `annotation\|local` |
| `precision_selection_feather` | int/float | `0` | 仅 local 模式，0-64 |
| `precision_size_mode` | str | `"preserve"` | `preserve\|resize`；preserve 不接受任何尺寸 |
| `precision_target_size` | str? | `None` | resize 必填，`WIDTHxHEIGHT` |
| `precision_resize_prompt` | str? | `None` | 配 resize，≤500 字符 |
| `precision_output_size_policy` | str | `"strict"` | `strict\|fit_crop`，仅 resize 接受 |
| `strength` | float | `0.55` | i2i 变换强度 |
| `continuous` / `continuous_id` | bool / str? | `False` / `None` | 连续生图一致性会话 |
| `system_prompt` | str? | `None` | 专业模式系统提示词 |
| `quantities` | dict | `{}` | `{provider_id: 数量}`，clamp 到 1-10（1713-1719） |
| `provider_settings` | dict | `{}` | `{provider_id: {model,size,quality}}`；t2i/i2i 的 model 必须属于该 provider（4322-4336），precision_edit 必填 model |
| `exact_ratio_crop` | bool | `False` | 允许近似画布居中裁切 |
| `upscale_to` | str? | `None` | 生成后本地放大目标尺寸（precision_edit 禁用，1350-1355） |
| `upscale_method` | str | `"lanczos3"` | lanczos3/bicubic/nearest |
| `upscale_ratio` | str | `"original"` | 1:1/16:9/.../original |

输入校验（`_validate_generation_request_inputs`，main.py:1139-1490）：

- t2i 禁止任何图像/遮罩/批注字段（1181-1199）。
- i2i 必须 ≥1 张图，禁止遮罩/批注（1202-1238）。
- inpaint 只接受 1 张底图 + mask，`mask_contract` 精确匹配、底图与遮罩尺寸一致（1460-1490）；provider 必须是 image+enabled+`endpoint_type=openai`+`capabilities.inpaint_mask=true`（1493-1516）。
- 图像负载限制：仅 png/jpeg/webp，≤25 MiB，≤2500 万像素（main.py:420-426, 734-866）；data URL 声明 MIME 必须与真实内容一致。

### 2.2 响应：**异步**，立即返回 gen_id

```python
4491: # 返回 provider_states 让前端立即创建占位卡片
4501: return {"generation_id": gen_id, "status": "queued", "provider_states": provider_states_out}
```

响应：`{generation_id, status:"queued", provider_states:{key:{status,progress,name,log[]}}}`（4492-4501）。gen_id 形如 `gen_0001_ab12cd`（4357）。main.py:1722 的 `GenerateResponse` 只是遗留模型，未作 response_model。

### 2.3 `GET /api/generate/status/{gen_id}`（main.py:4791-4836）

```python
4820: return {
4821:     "generation_id": gen_id,
4822:     "status": status,
4823:     "progress": progress,
4824:     "elapsed_seconds": elapsed,
4825:     "provider_states": provider_states_out,
4826:     "enhanced_prompt": task.get("enhanced_prompt"),
4827:     "llm_error": task.get("llm_error"),
4828:     "continuous_id": task.get("continuous_id"),
4832:     "results": task["results"] if status in ("completed","failed","cancelled") else {},
4833:     "group_timings": {...} if status in ("completed","failed","cancelled") else {},
4836: }
```

- **status 枚举**：`queued | generating | completed | failed | cancelled`（派生逻辑 main.py:2021-2030；起始 generating 见 4566）。failed/cancelled 时 progress 被压到 ≤99（1986-1995）。
- **progress**：0-100 整数，为各 provider 进度平均（1998-2004）；单 provider 后台从 10 起每 2 秒推进到 90（4589-4596）。
- `provider_states[key]` 字段：`status, progress, model, name, color, seq, qty, log[], request_contract, result`（4806-4818）。
- **结果文件获取**：`results` 仅在终态返回，**不含 base64**，只有 `local_path`（绝对文件系统路径）。

```python
4663: state["result"] = {
4664:     "success": res.success, "local_path": res.local_path, "generation_id": res.generation_id,
4667:     "error": res.error, "error_code": ..., "error_details": ..., "metadata": ...,
4671:     "request_contract": request_contract, "warnings": [...],
4673:     "model": pid, "prompt": prompt, "original_prompt": task["original_prompt"],
4676:     "seq": seq, "elapsed_seconds": ..., "started_at": t0, "finished_at": t1,
4680: }
```

→ 客户端取 `Path(local_path).name`，再请求 `GET /api/gallery/image/{filename}`（main.py:5151，仅允许 .png，见 433）拿字节。`request_contract` 含 `model/mode/protocol/profile/route/target_size/request_size/actual_size/final_size`（4514-4553）。
- 未知 gen_id → **404 `{"detail":"任务不存在"}`**（4794-4795）。`image_tasks` 是**纯内存**字典（1965），进程重启后只从 history.jsonl 恢复 `generation_history`（2067-2090），**旧 gen_id 查询会 404**。

### 2.4 `POST /api/generate/cancel/{gen_id}`（main.py:4839-4856）

```python
4842: if not task: raise HTTPException(status_code=404, detail="任务不存在")
4844: status = _refresh_image_task_state(task)
4845: if status in ("completed","failed","cancelled"):
4846:     return {"ok": True, "status": status}      # 幂等：已终态直接返回
4847: status = _mark_image_task_cancelled(gen_id)
4850: handle = image_task_handles.get(gen_id)
4852: if not handle.done(): handle.cancel()
4856: return {"ok": True, "status": status}
```

语义：**幂等、尽力而为**（只能停掉未启动的子任务；已发往上游的请求无法回滚）。**无其他错误码**，唯一失败是 404。

### 2.5 失败与限流

- 无可用 provider → **400**（4315-4316）；速率限制 → **429 `{"detail":"请求过于频繁，请稍后再试"}`**；仅 `/api/generate` 受限，默认 **10 次/分钟/IP**（1935, 4306）。
- 校验错误统一 **422** 且 `detail={code,message,...}`（`_generation_contract_error`，main.py:718-722）。
- 未知名默认被 pydantic 忽略；仅 precision_edit 下形似 precision/annotation 的未知名被显式拒绝（276-304，`precision_unknown_field`）。

---

## 3. 改图 / 精准改图

**结论：所有"改图"能力都由 `POST /api/generate` 通过 `mode` 分流，不存在独立的改图创建路由。** `/api/precision/*` 只有 4 个 **GET**（main.py:5346, 5389, 5439, 5454）；前端也确认走 `/api/generate`（static/js/generate.js:378、static/js/app-all.js:12248）。

| 能力 | 路由 | 关键参数 | 同步/异步 |
|---|---|---|---|
| 图生图 | `POST /api/generate` mode=i2i | image_data/image_data_list, strength | 异步 gen_id |
| 局部重绘 inpaint | 同上 mode=inpaint | image_data+mask_data+mask_contract | 异步 gen_id |
| 精准改图 precision edit | 同上 mode=precision_edit | 见 3.2 | 异步 gen_id |
| 图片变体 | `POST /api/images/variations` | 见 3.4 | **同步**（含 base64） |
| 本地超分 | `POST /api/images/upscale` | 见 3.5 | **同步**（含 base64） |
| 生成后放大 | `/api/generate` 的 upscale_to | Lanczos/Bicubic/Nearest | 随生成任务 |
| 扩图 outpaint | **无路由** | 仅出现在能力词表 `{"edit","inpaint","outpaint","resize"}` | — |

> `outpaint` 在 main.py 中仅出现 2 次（2760-2764 能力枚举注释），**未实现**；仓库中无"扩图"路由。

### 3.1 inpaint 请求/响应

请求 = `GenerateRequest`（必填 `prompt, mode="inpaint", image_data, mask_data, mask_contract="genbox-edit-white-v1"`）；响应与 `/api/generate` 完全一致（4501）。常见错误：`inpaint_mask_required`、`inpaint_mask_contract_unsupported`、`inpaint_image_mask_size_mismatch`、`inpaint_provider_unsupported`（附 `providers:[{id,reason}]`）。

### 3.2 precision_edit 请求信封（main.py:1240-1452）

- 只允许 `image_data` 一张底图；出现 `image_data_list` → 422 `precision_edit_image_data_list_not_allowed`（1241-1246）。
- **批注信封必须三件套齐全或全缺**：`annotation_image_data` + `annotation_contract` + `annotations`（1324-1336）；只给部分 → `precision_resize_annotation_fields_conflict`。
- 三件套全缺 ⇒ `precision_canvas_only=True`，此时**强制** `precision_size_mode="resize"`（1337-1342），且 selection_mode 不能是 local（1343-1348）。
- `annotation_image_data` 必须 PNG 且与底图宽高完全一致（1409-1422）。
- 批注契约 v1/v2/v3（344-348）允许字段（919-938）：

| type | v1 | v2（结构化，需 label） | v3（+ellipse/brush） |
|---|---|---|---|
| arrow | type,x1,y1,x2,y2 | +label,instruction | 同 v2 |
| rectangle | type,x,y,width,height | +label,instruction | 同 v2 |
| ellipse | — | — | type,label,instruction,x,y,width,height |
| brush | — | — | type,label,instruction,points[{x,y}]×2..1024 |
| text | type,x,y,text | +label,instruction | 同 v2 |

- 坐标全为 **0.0-1.0 归一化浮点**（883-898）；矩形/椭圆必须正宽高且不越界（1015-1027）；arrow 两端点不能重合（1008-1014）；label 为正整数且唯一（989-1003）；文本禁 URL/HTML/文件路径（869-880）。
- 上限：≤100 条批注、brush 总点数 ≤4096、单条/总文本 ≤500/4000、prompt ≤2000（355-361）。
- 授权门槛（1664-1710）：provider 必须 image+enabled，且 model 级 `model_capabilities[model].precision_edit=true` 且传输为 openai（或原生 Gemini profile）；否则 422 `precision_edit_provider_unsupported`，附 `providers:[{id,model,reason}]`。
- resize 尺寸授权（1590-1661）：strict 策略要求目标尺寸在该模型显式 `supported_sizes` 中，否则 422 `precision_edit_size_unsupported`。

### 3.3 "精准改图 V4" 的 workflow / versions

> **"V4" 是产品/界面代际名（README.md:30,47；docs/precision-edit-v4-research.md），不是 API 版本。** main.py 中不存在 V4 字样；API 侧契约常量是 `PRECISION_WORKFLOW_SCHEMA = "genbox-precision-workflow-v1"`（main.py:1955）。

- **创建（唯一入口）**：`POST /api/generate`，`mode="precision_edit"`。服务端在 4358-4362 调 `_prepare_precision_workflow_metadata`：
  ```python
  2293: parent = _precision_find_parent_result(source_sha256) if source_sha256 else None
  2296:     workflow_id = _precision_existing_workflow_id(parent_generation_id)
  2301:     workflow_id = f"pw_{uuid.uuid4().hex}"
  2303: return {"schema": PRECISION_WORKFLOW_SCHEMA, "workflow_id": workflow_id, "source_sha256": ...,
  2309:     "input_gallery_filename": ..., "parent_generation_id": ..., "outputs": {}, ...}
  ```
  即：**底图 SHA-256 命中历史结果时自动并入同一 workflow（版本链），否则新建 `pw_<32hex>`**。新 workflow_id **不在创建响应中返回**，只能在终态任务的历史条目 `precision_workflow` 字段（4782-4785）或后续 GET workflows 中读到，客户端需按 `source_sha256` 关联 `[易用性缺口]`。
- **读取**：
  - `GET /api/precision/workflows?date_from&date_to&workflow_id&limit`（5346-5386）：limit 1-200，默认 50；日期 `YYYY-MM-DD`；返回 `{items:[WorkflowProjection], total}`。
  - `GET /api/precision/workflows/{workflow_id}`（5389-5399）：`{workflow}`（额外含 annotation_snapshot）；id 必须匹配 `^pw_[a-f0-9]{32}$`，否则 404。
  - `GET /api/precision/workflows/{wf}/versions/{vid}/thumb`（5439）与 `/image`（5454）：二进制 PNG，返回前清空 PNG 元数据，thumb 缩到 320px。
- **projection 字段**（2477-2506）：`workflow_id, created_at, updated_at, edit_count, thumbnail, summary{edit_count, available_version_count, source_available, latest_size}, versions[], restore{workflow_id, version_id, image_url}`；version 项：`version_id, parent_version_id, kind("source"|"result"), created_at, available, width, height, thumbnail, image_url`；源版本固定 `version_id="original"`（2421-2435）；version_id 形如 `pv_<24hex>`（1957）。
- 版本媒体 URL 是**相对路径**（2433-2434, 2466-2467），客户端需与 base URL 拼接。

### 3.4 `POST /api/images/variations`（main.py:4867-5030）

请求 `VariationRequest`：`image_data`(必填 base64/data URL)、`provider_id=""`、`model=""`、`size="1024x1024"`、`n=1..4`（Field ge/le）。**同步**调上游 `/images/variations`，响应：

```python
5030: return {"success": True, "images": images_out, "model": model_id, "provider_id": provider.id}
5028: images_out.append({"b64_json": b64_data, "local_path": local_path, "provider_id": provider.id})
```

错误：400 无 provider；502 `image_variation_upstream_error` / `image_variation_invalid_response`（带 `validation_code`）。

### 3.5 `POST /api/images/upscale`（main.py:5036-5103）

请求 `UpscaleRequest`：`image_data`(必填)、`target_width=2048`、`target_height=2048`、`method="lanczos3"|"bicubic"|"nearest"`。**纯本地 PIL**，等比缩放到目标框内（原图已满足则不缩放）。
响应：`{success, width, height, original_width, original_height, b64_json, message}`（5095-5103）。**不含 local_path、不落盘**。错误：400 图片数据无效/无法解析，500 缩放失败。

---

## 4. 视频

### 4.1 `POST /api/video/generate` 请求体：`VideoGenerateRequest`（main.py:5635-5651）

| 字段 | 类型 | 默认 | 语义 |
|---|---|---|---|
| `prompt` | str | 必填 | 提示词 |
| `provider_id` | str | `""` | 空=第一个视频 provider；指定但不存在→**404**（5883-5884） |
| `model` | str | `""` | 覆盖 provider 默认模型 |
| `mode` | str | `"ti2vid"` | `ti2vid\|i2vid\|keyframes`（Google 原生校验取值为 ti2vid/i2vid/keyframes，google_video.py:76）；非 Google 协议走 `ti2vid\|keyframes`（5680-5709） |
| `image` | list? | `None` | 数组；元素可为 http URL、`data:*;base64,...`、或以 `/` 开头的本地图库相对路径（5795-5859） |
| `image_role` | str? | `None` | `first_frame\|last_frame\|reference\|first_last`；Google 中 `mode=keyframes` 时强制为 `first_last`（google_video.py:87） |
| `width` / `height` | int | `1152` / `768` | 会被 model-spec 自动降级/适配（5905-5971） |
| `num_frames` | int | `121` | 8n+1 规则；由 duration×fps 重算 |
| `frame_rate` | int | `24` | Google 原生固定 24（google_video.py:80） |
| `num_inference_steps` | int? | `None` | 会按 spec 区间夹紧；Google 原生**不支持**（google_video.py:99） |
| `seed` | int? | `None` | Google 原生不支持（google_video.py:115） |
| `negative_prompt` | str? | `None` | 同上 |
| `duration_seconds` | int? | `None` | 时长秒；Google Veo 必须属于 `[4,6,8]`/veo2 `[5,6,7,8]`（google_video.py:37,111-114） |
| `resolution` | str? | `None` | `360p\|720p\|1080p\|4k`（Google 路径） |
| `aspect_ratio` | str? | `None` | Google 仅支持 `16:9`/`9:16`（google_video.py:84） |

**文生 / 图生 / 首尾帧差异**：

- 纯文生：`mode="ti2vid"`，`image` 必须为空；Google 路径下若给了图会报"请先上传参考图片"的反向校验（google_video.py:86-89）。
- 图生（单图）：`mode="i2vid"` + `image:[1 张]` + `image_role="first_frame"`；Google 要求恰好 1 张（google_video.py:95-96, 124）。
- 首尾关键帧：`mode="keyframes"` + `image:[首帧, 尾帧]`（必须恰好 2 张，google_video.py:93-94, 125-126）；Agnes 协议把多图塞进 `extra_body.image` 并附 `extra_body.mode="keyframes"`（5700-5707）。
- 参考图：`image_role="reference"`，数量上限由 spec 的 `max_image_count`（1 或 3）决定（google_video.py:42,97-98）。
- 图片约束（Google 原生）：data URL、png/jpeg/webp、单张 ≤10 MB、base64 字段 ≤15 MB（google_video.py:49-71）。

### 4.2 响应（main.py:5867-6319 / Google 路径 6322-6374）

通用协议（volcengine / agnes）返回：

```python
6313: return {
6314:     "task_id": task_id, "video_id": video_id,
6315:     "status": task_info["status"],
6316:     "progress": task_info.get("progress", 0),
6317:     "error": task_info.get("error"),
6318:     "video_url": task_info.get("video_url") or None,
6319: }
```

Google 原生路径返回 `{**info}`（6372）即完整 task_info：`task_id, video_id, provider_id, provider_name, model, prompt, mode, status, progress, created_at, start_time, width, height, frame_rate, duration_seconds, video_url, local_path, error, provider_type="google_native"`（6335-6343）。
- **Gemini/Flow2API 类型是"半同步"**：POST 会阻塞读取 SSE，httpx 超时 300s（main.py:6003），完成后立即下载视频；客户端 POST 超时必须 >300s。
- volcengine/agnes 是 **180s 超时**（6067, 6086）后立即返回，后台线程轮询（间隔 15s / 5s，6166, 6256）。

### 4.3 `GET /api/video/status/{task_id}`（main.py:6377-6388）

```python
6382: info = video_tasks[task_id]
6383: elapsed = round(time.time() - info.get("start_time", time.time()), 1)
6384: result = {**info, "elapsed_seconds": elapsed}
6385: if info.get("local_path"):
6386:     fname = Path(info["local_path"]).name
6387:     result["video_url_local"] = f"/api/video/file/{fname}"
6388: return result
```

- 未知 id → **404 `{"detail":"任务 '...' 不存在"}`**。
- **status 不是严格枚举**：本地终态为 `completed / failed / cancelled / timeout`，运行中透传上游取值（`queued`、`running`、`generating`、`downloading`、`succeeded`、`expired` 等，见 6064-6226, google_video.py:357/378/403）。客户端应按"终态集合"判断，不要假设只有 3 个值。
- **结果获取**：优先 `video_url_local`（本地相对 URL，稳定）或 `local_path`（绝对路径）；`video_url` 是上游直链，可能过期/不可访问。下载走 `GET /api/video/file/{filename}`（6391-6395，FileResponse，支持 Range；允许扩展名 `.mp4/.webm/.mov`，main.py:434）。

### 4.4 `GET /api/video/list`（main.py:6398-6404）

```python
6402: active = [v for v in video_tasks.values() if v.get("status") not in ("completed","failed","error","cancelled","timeout")]
6403: all_entries = active + list(reversed(entries[-limit:]))
6404: return {"items": all_entries, "total": len(all_entries)}
```

`limit` 默认 50（无页码/游标）；`items` 是内存中活跃任务 + `storage/video_history.jsonl` 末 `limit` 条（字段同 task_info）。注意 **`total` 是本次返回条数，不是全量总数**。

### 4.5 `GET /api/video/model-specs`（main.py:6436-6440）与 `/api/video/model-spec/{model_name}`

- `/api/video/model-specs` 直接返回 `{spec_key: VideoModelSpec.model_dump()}`，**键是预设名（veo-3、sora、kling-v2、agnes…）而不是真实模型 ID**（config.py:911+）。
- 要按真实模型名查询，用 `GET /api/video/model-spec/{model_name}`，关键词匹配见 providers/__init__.py:875-906（默认回退 agnes 规格）。
- `VideoModelSpec`（config.py:894-907）：

| 字段 | 类型/默认 | 语义 |
|---|---|---|
| `resolutions` | List[str] = ["720p","1080p"] | 支持分辨率档 |
| `duration_options` | List[int] = [5,10] | 时长选项（秒） |
| `fps_options` | List[int] = [24] | FPS 选项 |
| `frame_rule` | str = "" | `"8n+1"\|"4n+1"\|""` |
| `max_frames` / `min_frames` | int = 441 / 9 | 帧数上下限 |
| `inference_steps_range` | List[int]? = None | `[min,max,default]` |
| `supports_negative_prompt` | bool = True | |
| `supports_seed` | bool = True | |
| `supports_image_input` | bool = True | |
| `max_image_count` | int = 1 | 参考图上限 |
| `max_prompt_length` | int = 2000 | |

- 若 `provider_id` 指向 Google 原生 provider，`/api/video/model-spec/{model}` 会改走 `providers/google_video.py:model_spec()`，额外返回 `native_google, family, duration_mode, image_roles`（6421-6431；google_video.py:32-46）。

---

## 5. 媒体库与工具

### 5.1 `GET /api/gallery`（main.py:5139-5142）

```python
5140: async def gallery(limit: int = 50):
5141:     items = _scan_gallery(limit)
5142:     return {"items": items, "total": len(items)}
```

**只有 `limit` 一个参数，没有 offset/page/cursor/search/filter**；图片与视频混在 `items` 里，按 `created_at` 倒序（2654-2655），`total` 是本次返回数。

图片项字段（2607-2621）：`id(=文件 stem), type:"image", model, prompt, local_path, created_at, thumbnail, file_size, source("local"|"cloud"), tags[], source_path, source_deployment, source_created_at`。
视频项字段（2640-2651）：`id, type:"video", model, prompt, local_path, created_at, thumbnail(首帧 jpg), video_url, duration, file_size`。

### 5.2 文件型端点

| 路由 | 行为 |
|---|---|
| `GET /api/gallery/image/{filename}`（5151-5157） | 返回原始字节；**仅允许 **`.png`**（433）且被限制在 GALLERY_DIR 内（508-514）**；支持 Range→206（main.py:704-715）；校验失败 415 `gallery_image_invalid`/`gallery_image_mime_unsupported` |
| `GET /api/gallery/thumb/{filename}`（5145-5148） | 图片缩略；找不到图片时回退视频首帧 `{stem}_thumb.jpg`（577-607）；404 `thumbnail_not_found` |
| `GET /api/gallery/image/{filename}/base64`（5334-5343） | `{"filename":"...","data":"data:image/png;base64,..."}` —— **大 base64**，用于把图送回参考图区 |
| `GET /api/gallery/video-info/{item_id}`（5209-5274） | ffprobe 元数据并缓存到同名 `.json`；返回 `{duration, width, height, size_bytes}`；ffprobe 失败时返回 `{duration:null,width:null,height:null}`；404 `"Video not found"` |
| `DELETE /api/gallery/{item_id}`（5160-5167） | 按 stem 子串匹配删除单图；404 图片不存在 |
| `POST /api/gallery/batch-delete`（5170-5208） | body = **裸字符串数组**（`List[str]`）；返回 `{deleted[],failed[],total_deleted}` |
| `POST /api/gallery/batch-download`（5280-5305） | 返回 ZIP（application/zip），全部不匹配→404 |
| `POST /api/gallery/rename`（5308-5331） | body `{old_id,new_name}`；new_name 仅 `[\w\u4e00-\u9fff]+`；返回 `{ok,old_id,new_id,new_name}`；400/404/409 |
| `GET /api/preview/images`（6452-6474） | 最近 40 张图的 `{filename,data(data URL),prompt,model,created_at}`，**大 base64 批量** |

### 5.3 `POST /api/image-tools/cutout`（main.py:3962-4092）

请求 `CutoutRequest`（307-313，`extra="forbid"`）：`contract`(必填，固定 `genbox-cutout-v1`)、`image_data`(必填)、`adapter`?、`algorithm`?。
响应（4071-4089）：

```python
4071: response = {
4072:     "contract": CUTOUT_CONTRACT, "success": True, "status": "completed",
4075:     "source_preserved": True, "transparent": True, "preview_background": "checkerboard",
4080:     "adapters": executable_adapters, "adapter": result_adapter_id,
4082:     "image_data": "data:image/png;base64," + encoded,
4083:     "filename": Path(local_path).name,
4084:     "gallery_url": f"/api/gallery/image/{quote(Path(local_path).name)}",
4085:     "width": width, "height": height, "elapsed_seconds": ..., "cancel_supported": False,
4089: }
```

- **同步**、含 base64，且已落盘到图库。错误：422 `cutout_contract_unsupported`；适配器错误带 `status_code/to_detail`；500 `cutout_failed`；缺模型时**能力查询** `GET /api/image-tools/cutout/capabilities`（3912-3959）返回 **503** + 原因体。

### 5.4 `POST /api/image-tools/cutout/refine`（main.py:4095-4292）

请求 `CutoutRefineRequest`（324-335，`extra="forbid"`）：`contract`(固定 `genbox-cutout-refine-v1`)、`image_data`、`selection_mask_data`?、`selection_mask_contract`?(固定 `genbox-cutout-selection-mask-v1`)、`feather_radius=0`(0-64)、`restore_mode=False`、`restore_source_image_data`?、`restore_min_alpha=255`、`parent_version_id`?。
约束：选区两字段必须同时给；`restore_mode=true` 要求选区两字段 + `restore_source_image_data`；feather 超出 0-64 → 422 `feather_radius_invalid`；`parent_version_id` 需匹配 `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`。
响应（4266-4292）：`contract, success, status:"completed", operation:"alpha_refine", local_only:true, source_preserved, transparent, preview_background, image_data(data URL), filename, gallery_url, width, height, version_id("cutout-refine-<hex>"), parent_version_id, restore_mode, restore_min_alpha, restore_applied, selection_applied, selection_mask_contract, feather_radius, alpha_changed, alpha_extrema`。

### 5.5 `POST /api/llm/optimize`（main.py:5106-5123）

请求 `LLMOptimizeRequest`：`prompt`(必填)、`llm_provider_id`?。响应：

```python
5117: return {
5118:     "original": req.prompt, "optimized": result["text"],
5119:     "optimized_by_llm": result["optimized"],
5120:     "error": result["error"], "provider": result["provider"],
5121: }
```

空 prompt → 400 `{"detail":"提示词不能为空"}`；LLM 未配置时不报错，`optimized` 等于原文且 `optimized_by_llm=false`、`error` 有说明。

---

## 6. Provider 与模型发现

### 6.1 `GET /api/providers`（main.py:2828-2861）

```python
2834: d = p.model_dump(exclude={"api_key", "api_keys", "endpoints"})
2837: d["has_key"] = bool(p.get_effective_keys() or p.get_active_endpoints())
2839: d["key_count"] = len(p.get_effective_keys())
2841: d["model_capabilities"] = extra.get("model_capabilities", {})
2842: d["precision_size_catalog"] = _public_precision_size_catalog(p)
2846: d["api_key_masked"] = keys[0][:4] + "****" + keys[0][-4:] ...
2856:     ep_dict = {"name": ep.name, "url": ep.url, "model": ..., "enabled": ep.enabled}
2861: return {"providers": providers_data}
```

每个 provider 除 `ProviderConfig` 全字段（config.py:560-580：`id,name,type,model,models,size,quality,enabled,color,display_name,capabilities{},` `precision_edit_profile,skip_proxy,endpoint_type,extra`）外，额外含：`has_key,has_keys,key_count,model_capabilities,precision_size_catalog,api_key_masked,keypool{total_keys,available_keys,keys},endpoints[]`。

**能力声明够不够？部分够。**

- `models[]` + `model` 给出可调模型；`model_capabilities[model]` 给出模型级声明（`precision_edit`、`supported_sizes`、`alias_of`、`operations`、`input_contract`）。
- `precision_size_catalog[model]` 是尺寸能力的权威投影（2783-2823）：`precision_capability{status("ready"|"unknown"), protocol, request_profile, operations, input_contract, output_contract, native_size, size_policy, evidence, dispatch_authorized}` + `declared_sizes`/`strict_selectable_sizes`/`documented_presets`/`native_presets`。**改图/尺寸决策应以此为准**。
- 缺口：① provider 级 `capabilities` 是自由字典 `Dict[str,bool]`，main.py 真正强制检查的只有 `inpaint_mask`（1509）与 `precision_edit`（1521, 2744）；config.py:576 注释里的 `t2i/i2i/i2v` **没有任何代码消费**。② 无视频模型能力清单（只能靠 `/api/video/model-spec/{model}`）。③ 无 "支持哪些 t2i 尺寸" 的通用声明，只有 precision 专用目录。

### 6.2 `GET /api/setup/status`（main.py:3356-3386）

```python
3379: return {
3380:     "app_mode": app_mode,                      # "dev" | "prod"
3381:     "auth_required": app_mode == "prod",
3382:     "needs_provider_setup": not has_configured_provider,
3383:     "has_configured_provider": has_configured_provider,
3384:     "has_enabled_provider": has_enabled_provider,
3385:     "provider_count": len(providers),           # 仅 image/video
3386: }
```

免认证，是客户端启动时探测"要不要带 X-Admin-Key"的首选端点。注意 `provider_count` 只统计 `type in ("image","video")`（3361-3365），不含 llm。
`GET /api/runtime/status`（2682-2698）仅 dev 可用，prod 下 **404**（2686-2687），返回 `service,version,mode,port,started_at,runtime_id,runtime_head,runtime_source`。
辅助端点：`GET /api/providers/test/{id}`（3389-3462，逐端点连通性）、`GET /api/providers/fetch-models/{id}`（3513+）、`POST /api/providers/fetch-models-preview`（3493-3510）。

---

## 7. 给 TypeScript 客户端的注意事项

**命名**：字段与查询参数几乎全为 **snake_case**（`generation_id, image_data, local_path, video_url_local, model_capabilities, precision_target_size, date_from`）。仅 header 是 `X-Admin-Key`（HTTP 大小写不敏感）。注意 `b64_json` 是 snake_case 而非 `b64Json`。

**认证**：先 `GET /api/setup/status` 读 `auth_required`；为 true 时所有 `/api/*` 请求（除 4 个白名单）都要带 `X-Admin-Key`，否则 401 `AUTH_REQUIRED`。`/api/sync/push*` 用另一套来源密钥，不要带 admin key。

**CSRF**：不要发 `Origin`/`Referer`，或确保其 netloc 与请求 Host 一致；否则 POST/PUT/DELETE 可能 403 `CSRF_REJECTED`。PATCH 不受该中间件约束。

**超时与轮询**：

- `POST /api/generate` 与两个 cancel/status 端点都是**秒回**；用 10-30s 超时即可。
- 轮询 `/api/generate/status/{id}` 建议 **1-2s**（服务端单 provider 进度每 2s 跳一次，4589-4596），终态集合 `{completed, failed, cancelled}`。任务只存在于内存，**重启后必须改从 `/api/history` 或 `/api/gallery` 兜底**。
- `POST /api/video/generate` 对 Gemini/Flow2API 类型可能阻塞 **最长 300s**（6003），对 volcengine/agnes 最长 180s（6067/6086）→ 客户端超时应设 ≥300s，或使用支持长连接的 HTTP 客户端。
- 视频轮询 `/api/video/status/{id}` 建议 **2-5s**（上游轮询 5s/15s）。
- 取消：图片 `POST /api/generate/cancel/{id}`（幂等）；视频 `POST /api/video/cancel/{id}`（6443-6449，**只置内存状态，不通知上游**）。

**大 base64（需注意内存）**：`/api/images/upscale`（b64_json）、`/api/images/variations`（每图 b64_json + local_path）、`/api/gallery/image/{f}/base64`、`/api/preview/images`（一次 40 张）、`/api/image-tools/cutout` 与 `/refine`（image_data 为完整 data URL）、`GET /api/precision/.../image`（二进制）。**生成状态端点本身不含 base64**，只有 `local_path`——推荐始终用 `/api/gallery/image/{basename}` 或 `/api/video/file/{basename}` 流式拉取。

**分页**：**没有任何 offset/page/cursor 分页**。仅有 `limit`：`/api/gallery?limit`（默认 50，无上限校验）、`/api/precision/workflows?limit`（1-200，默认 50，配 `total`）、`/api/video/list?limit`（默认 50）、`/api/history?limit`（默认 30）。其余都需客户端自行裁剪。

**错误响应没有统一形状**，共 3 类，客户端需同时兼容：

1. 业务契约错误（最常用）：`HTTP 4xx/5xx` + `{"detail": {"code": "...", "message": "...", ...}}`（main.py:718-722；如 `message` 是中文串）。
2. 中间件错误：`{"error": "...", "code": "AUTH_REQUIRED" | "CSRF_REJECTED"}`（7145, 1926）。
3. 请求校验失败 422：`{"detail": [{"type","loc","msg"}]}`（main.py:1863-1874，**刻意不回显原始 body**）；另有大量端点直接把 `detail` 写成**字符串**（如 `"任务不存在"`、`"图片不存在"`）。
   建议：`const code = typeof d.detail === "object" ? d.detail.code : (d.code ?? null)`。

**限流**：仅 `/api/generate` 有 10 次/分钟/IP 限制（1935），超限 429（字符串 detail）。其他端点无限流。

**其他**：`GET /api/video/model-specs` 的键是预设名而非模型名，客户端应改用 `/api/video/model-spec/{model}`；gallery 只服务 `.png`，视频只服务 `.mp4/.webm/.mov`（433-434）。

**未确认项汇总**：① 中间件实际执行顺序（1.4，基于 Starlette insert(0) 语义推断）；② PATCH 的 CORS 预检失败（基于 allow_methods 配置推断）；③ 无 Origin/Referer 时 CSRF 放行仅由 `if source:` 与 test_csrf.py 佐证，未对真实 Node 客户端实测；④ 各 provider 上游 video status 字符串的完整枚举（上游透传，非本地定义）。

---

*报告生成方式：对 main.py / config.py / providers/__init__.py / providers/google_video.py / image_tools/cutout_refine.py / start.ps1 / Dockerfile / .env.example 及 tests/ 做只读检索与逐段阅读，未执行任何修改。*