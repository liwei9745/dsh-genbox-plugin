// Read-only evidence board for the GenBox plugin: no model credentials needed.
//   node scripts/lab.mjs   ->  http://127.0.0.1:3098/
import { createServer } from 'node:http'
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, extname, join, resolve, sep } from 'node:path'

const PORT = Number(process.env.LAB_PORT ?? 3098)
const ROOT = resolve(import.meta.dirname, '..')
const OUT_DIR = join(ROOT, '.genbox-out')
const LIB = join(ROOT, 'lib', 'index.js')
const GENBOX = process.env.GENBOX_BASE_URL ?? 'http://127.0.0.1:8892'

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov'])

async function collectLocal(dir, prefix, depth) {
  const found = []
  let entries = []
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return found }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (depth > 0) found.push(...await collectLocal(full, prefix, depth - 1))
      continue
    }
    const ext = extname(entry.name).toLowerCase()
    if (!IMAGE_EXT.has(ext) && !VIDEO_EXT.has(ext)) continue
    const info = await stat(full)
    const relative = full.slice(OUT_DIR.length + 1).split(sep).map(encodeURIComponent).join('/')
    found.push({ name: entry.name, url: '/' + prefix + '/' + relative, size: info.size, mtime: info.mtimeMs, video: VIDEO_EXT.has(ext) })
  }
  return found.sort((a, b) => b.mtime - a.mtime)
}

async function collectTools() {
  try {
    const source = await readFile(LIB, 'utf8')
    const names = new Set()
    const pattern = /name:\s*['"](genbox_[a-z_]+)['"]/g
    let match
    while ((match = pattern.exec(source)) !== null) names.add(match[1])
    return [...names].sort()
  } catch { return [] }
}

async function collectGenbox() {
  try {
    const setup = await fetch(GENBOX + '/api/setup/status').then((r) => r.json())
    const runtime = await fetch(GENBOX + '/api/runtime/status').then((r) => r.json())
    const providers = await fetch(GENBOX + '/api/providers').then((r) => r.json())
    const gallery = await fetch(GENBOX + '/api/gallery?limit=60').then((r) => r.json())
    return { ok: true, setup, runtime, providers: providers.providers ?? [], items: gallery.items ?? [] }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

function mediaCards(entries) {
  if (entries.length === 0) return '<p class="empty">（暂无）</p>'
  return entries.map((item) => {
    const media = item.video
      ? '<video src="' + item.url + '" controls preload="metadata"></video>'
      : '<img loading="lazy" src="' + item.url + '" alt="">'
    return '<figure>' + media + '<figcaption title="' + esc(item.name) + '">' + esc(item.name).slice(0, 42) + '<br><span>' + Math.round(item.size / 1024) + ' KB</span></figcaption></figure>'
  }).join('')
}

function genboxCards(items) {
  const cards = []
  for (const item of items) {
    const name = item.local_path ? basename(item.local_path) : ''
    if (!name) continue
    const isVideo = (item.type === 'video')
    const url = isVideo
      ? GENBOX + '/api/video/file/' + encodeURIComponent(name)
      : GENBOX + '/api/gallery/image/' + encodeURIComponent(name)
    const media = isVideo
      ? '<video src="' + url + '" controls preload="metadata"></video>'
      : '<img loading="lazy" src="' + url + '" alt="">'
    cards.push('<figure>' + media + '<figcaption>' + esc(item.type) + ' · ' + esc(item.model) + '<br><span>' + esc((item.prompt ?? '').slice(0, 40)) + '</span></figcaption></figure>')
  }
  return cards.length > 0 ? cards.join('') : '<p class="empty">（图库里还没有素材）</p>'
}

async function render() {
  const [tools, genbox, local] = await Promise.all([collectTools(), collectGenbox(), collectLocal(OUT_DIR, 'out', 3)])
  const providerRows = genbox.ok
    ? genbox.providers.map((p) => '<li>' + esc(p.id) + ' · ' + esc(p.type) + ' · ' + (p.enabled ? 'enabled' : 'disabled') + ' · key: ' + (p.has_key ? 'yes' : 'no') + '</li>').join('')
    : '<li>GenBox 未响应：' + esc(genbox.error) + '</li>'
  const status = genbox.ok
    ? 'GenBox v' + esc(genbox.runtime.version) + ' · ' + esc(genbox.runtime.mode) + ' 模式 · ' + GENBOX + ' · 图库 ' + genbox.items.length + ' 项'
    : 'GenBox 不可达'

  return [
    '<!doctype html><html lang="zh"><head><meta charset="utf-8">',
    '<title>GenBox × DSH 实验室</title>',
    '<style>',
    'body{font:14px/1.6 system-ui,"Segoe UI",sans-serif;margin:0;background:#0f1115;color:#e6e6e6}',
    'header{padding:20px 28px;border-bottom:1px solid #262a33;background:#141821}',
    'h1{margin:0 0 4px;font-size:19px}h2{font-size:15px;margin:26px 28px 10px;color:#9fb3d1}',
    '.sub{margin:0;color:#8b93a1;font-size:13px}',
    'section{margin:0 0 8px}.card{background:#161a22;border:1px solid #242a35;border-radius:10px;margin:0 28px;padding:14px 16px}',
    'ul{margin:6px 0;padding-left:18px}li{margin:2px 0}',
    '.tools{columns:3;list-style:none;padding:0}.tools li{font-family:ui-monospace,Consolas,monospace;font-size:12.5px}',
    '.grid{display:flex;flex-wrap:wrap;gap:12px}figure{margin:0;width:150px}',
    'img,video{width:150px;height:110px;object-fit:cover;border-radius:8px;background:#0b0d11;border:1px solid #242a35}',
    'figcaption{font-size:11.5px;color:#8b93a1;margin-top:5px;word-break:break-all}figcaption span{color:#5f6672}',
    'pre{background:#0b0d11;border:1px solid #242a35;border-radius:8px;padding:12px;overflow:auto;font-size:12.5px}',
    '.empty{color:#5f6672;margin:6px 0}',
    '</style></head><body>',
    '<header><h1>GenBox × DSH 实验室</h1><p class="sub">只展示证据，不需要模型凭据 · ' + status + '</p></header>',
    '<h2>1. GenBox provider</h2><div class="card"><ul>' + providerRows + '</ul></div>',
    '<h2>2. 插件注册的工具（' + tools.length + ' 个）</h2><div class="card"><ul class="tools">' + tools.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul></div>',
    '<h2>3. GenBox 图库素材</h2><div class="card"><div class="grid">' + genboxCards(genbox.ok ? genbox.items : []) + '</div></div>',
    '<h2>4. 本地产物 .genbox-out（' + local.length + ' 个）</h2><div class="card"><div class="grid">' + mediaCards(local.slice(0, 60)) + '</div></div>',
    '<h2>5. 复现命令</h2><div class="card"><pre>cd E:\\AI\\GenBox-dsh',
    'node scripts/verify-tools.mjs        # 生图/改图/超分/变体/视频（需 GenBox 8892 + mock 8899）',
    'node scripts/verify-background.mjs   # 非阻塞提交 + genbox_task',
    'node scripts/verify-video-edit.mjs   # 本地 ffmpeg 剪辑（不需要 GenBox）',
    'node scripts/verify-media.mjs        # 图库 + 提示词优化</pre></div>',
    '<p class="sub" style="margin:20px 28px 40px">DSH 会话页在 3099（需要模型凭据）；GenBox 工作台在 8892。</p>',
    '</body></html>',
  ].join('\n')
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  if (url.pathname === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(await render())
    return
  }
  if (url.pathname.startsWith('/out/')) {
    const relative = decodeURIComponent(url.pathname.slice('/out/'.length))
    const target = resolve(OUT_DIR, relative)
    if (!target.startsWith(OUT_DIR)) { response.writeHead(403).end('forbidden'); return }
    try {
      const body = await readFile(target)
      const ext = extname(target).toLowerCase()
      const type = IMAGE_EXT.has(ext) ? 'image/' + (ext === '.png' ? 'png' : ext.slice(1)) : 'video/' + (ext === '.mov' ? 'quicktime' : ext.slice(1))
      response.writeHead(200, { 'Content-Type': type })
      response.end(body)
    } catch { response.writeHead(404).end('not found') }
    return
  }
  response.writeHead(404).end('not found')
}).listen(PORT, '127.0.0.1', () => console.log('lab board on http://127.0.0.1:' + PORT + '/'))
