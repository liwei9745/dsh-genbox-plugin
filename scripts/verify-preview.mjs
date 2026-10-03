// Generated images should reach the conversation as image blocks, not just as a path.
// The attachment service is what makes that possible; a deployment without one must still
// produce files and report paths.
import assert from 'node:assert/strict'
import { apply, Config } from '../lib/index.js'

const CHECKOUT = process.env.GENBOX_TEST_HOME ?? ''
const BASE = process.env.GENBOX_BASE_URL ?? 'http://127.0.0.1:8892'

/** A context shaped like the runtime's: a tool registry plus an optional attachments service. */
function makeContext(options) {
  const tools = new Map()
  const saved = []
  const ctx = {
    tools: { register: (definition) => tools.set(definition.name, definition) },
    get: (key) => (key === 'attachments' && options.wantAttachments === true
      ? { saveImage: async (input) => { saved.push(input); return { attachmentId: 'att_' + saved.length, mediaType: input.mediaType, bytes: input.data.length, width: 2, height: 2, name: input.name } } }
      : undefined),
  }
  return { ctx, tools, saved }
}

const results = []
const check = async (name, fn) => {
  try { await fn(); results.push('  [ok]   ' + name) }
  catch (error) { results.push('  [FAIL] ' + name + ' - ' + String(error.message).slice(0, 200)) }
}

const providers = await fetch(BASE + '/api/providers').then((r) => r.json()).catch(() => null)
if (providers === null) {
  console.log('SKIP verify-preview: GenBox is not answering at ' + BASE)
  process.exit(0)
}
const mock = (providers.providers ?? []).find((p) => p.enabled === true && String(p.id).startsWith('mock'))
if (mock === undefined) {
  console.log('SKIP verify-preview: no enabled mock image provider (enable mock-openai in GenBox)')
  process.exit(0)
}

await check('a generated image is committed as an attachment and rendered as an image block', async () => {
  const { ctx, tools, saved } = makeContext({ wantAttachments: true })
  apply(ctx, Config({ baseUrl: BASE, baseUrlFallbacks: '', previewInChat: true, previewLimit: 4 }))
  const generate = tools.get('genbox_image_generate')
  const value = await generate.execute({ prompt: 'preview wiring', providers: [mock.id], size: '512x512' }, { signal: AbortSignal.timeout(120000) })
  assert.equal(value.status, 'completed', 'the generation itself should succeed')
  assert.ok(Array.isArray(value.previews) && value.previews.length === 1, 'one preview expected, got ' + JSON.stringify(value.previews))
  assert.equal(saved.length, 1, 'the attachment service should have been asked to store one image')
  assert.equal(saved[0].mediaType, 'image/png')
  const blocks = generate.output.render({}, value)
  const images = blocks.filter((block) => block.type === 'image')
  assert.equal(images.length, 1, 'the render output should carry one image block')
  assert.equal(images[0].attachment.attachmentId, 'att_1')
  assert.ok(blocks.some((block) => block.type === 'text'), 'the text summary stays')
})

await check('without an attachment service the tool still produces the file', async () => {
  const { ctx, tools } = makeContext({ wantAttachments: false })
  apply(ctx, Config({ baseUrl: BASE, baseUrlFallbacks: '', previewInChat: true }))
  const generate = tools.get('genbox_image_generate')
  const value = await generate.execute({ prompt: 'no service', providers: [mock.id], size: '512x512' }, { signal: AbortSignal.timeout(120000) })
  assert.equal(value.status, 'completed')
  assert.deepEqual(value.previews, [])
  const blocks = generate.output.render({}, value)
  assert.equal(blocks.filter((b) => b.type === 'image').length, 0)
  assert.match(blocks[0].text, /read_image/, 'the text should still say how to look at it')
})

await check('previewInChat=false keeps every image off the conversation', async () => {
  const { ctx, tools, saved } = makeContext({ wantAttachments: true })
  apply(ctx, Config({ baseUrl: BASE, baseUrlFallbacks: '', previewInChat: false }))
  const generate = tools.get('genbox_image_generate')
  const value = await generate.execute({ prompt: 'previews off', providers: [mock.id], size: '512x512' }, { signal: AbortSignal.timeout(120000) })
  assert.equal(value.status, 'completed')
  assert.equal(saved.length, 0, 'nothing should be committed when the preview is disabled')
  assert.deepEqual(value.previews, [])
})

console.log(results.join('\n'))
const failed = results.filter((line) => line.includes('[FAIL]')).length
console.log(failed === 0 ? 'OK (' + results.length + ' checks)' : 'FAILED (' + failed + ' of ' + results.length + ')')
process.exitCode = failed === 0 ? 0 : 1
