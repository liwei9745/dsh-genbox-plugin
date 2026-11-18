#!/usr/bin/env node
/**
 * Client-half contract test: the GenBox sidebar panel.
 *
 * The panel is a browser bundle, so this harness runs it in a minimal fake DOM:
 * window.__ModuleLoader__ captures the registration, a stub require supplies
 * React, and the rendered tree is walked to prove the guest protocol end to end
 * (acquire a lease -> attach about:blank#<lease> -> loadURL on dom-ready).
 *
 * Zero network, zero Electron, zero cost.
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = join(here, '..', 'client', 'client.js')

const checks = []
const ok = (name, condition, detail) => {
  const suffix = condition ? '' : ' — ' + String(detail ?? '')
  checks.push({ name, passed: Boolean(condition) })
  console.log('  [' + (condition ? 'ok' : 'FAIL') + '] ' + name + suffix)
}

/** Minimal React stand-in: state, refs, and effects queued for after commit. */
function createFakeReact(pending) {
  return {
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: (initial) => ({ current: initial ?? null }),
    useEffect: (fn) => { pending.push(fn) },
  }
}

/** jsx/jsxs produce plain descriptors so the test can walk the tree. */
const jsx = (type, props) => ({ type, props: props ?? {} })
const jsxs = (type, props) => ({ type, props: props ?? {} })

/** Depth-first collect of every descriptor carrying the given data attribute. */
function findByAttr(node, attr) {
  const found = []
  const walk = (value) => {
    if (value === null || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(walk); return }
    if (value.props !== undefined) {
      if (value.props[attr] !== undefined) found.push(value)
      walk(value.props.children)
    }
  }
  walk(node)
  return found
}

const source = await readFile(bundlePath, 'utf8')
const registrations = []
globalThis.window = { __ModuleLoader__: { load: (registration) => registrations.push(registration) } }
globalThis.localStorage = { getItem: () => null, setItem: () => {} }

// Execute the bundle exactly as the shell does: it only registers a factory.
new Function('window', source)(globalThis.window)

ok('the bundle registers exactly one module factory', registrations.length === 1, 'got ' + registrations.length)
const registration = registrations[0]
ok('the module id is the package name', registration?.id === 'dsh-genbox-plugin', String(registration?.id))
ok('the factory is a function', typeof registration?.factory === 'function')

const pendingEffects = []
const requireStub = (specifier) => {
  if (specifier === 'react') return createFakeReact(pendingEffects)
  if (specifier === 'react/jsx-runtime') return { jsx, jsxs }
  throw new Error('unexpected require: ' + specifier)
}
const moduleExports = registration.factory(requireStub)
ok('the factory exports apply()', typeof moduleExports?.apply === 'function')
// Regression: cordis reads `inject` as a STATIC array. Exporting a function made
// every ctx.<service> read throw "cannot get property ... without inject", which
// is what bricked the desktop app's web boot in 0.2.0.
const declaredInject = moduleExports?.inject
ok('inject is a static service array', Array.isArray(declaredInject), typeof declaredInject)
ok('inject declares every service apply() touches', Array.isArray(declaredInject) && ['slots', 'sidebarRight', 'sidebarRightTabs'].every((name) => declaredInject.includes(name)), JSON.stringify(declaredInject))

// --- apply() against a recording context --------------------------------------
const effects = []
const recorded = { tabs: [], slots: [], shortcuts: [] }
const right = {
  commandTarget: (element) => element,
  openTabFromTarget: (kind, target) => { recorded.opened = { kind, target } },
}
const baseCtx = {
  effect: (fn) => { effects.push(fn) },
  slots: {
    inject: (_name, fn) => fn(),
    register: (definition, component) => { recorded.slots.push({ definition, component }) },
  },
  sidebarRightTabs: { register: (definition) => { recorded.tabs.push(definition) } },
  sidebarRight: right,
  inject: (_services, fn) => fn({
    effect: (fn2) => { effects.push(fn2) },
    shortcuts: { register: (definition) => { recorded.shortcuts.push(definition) } },
    sidebarRight: right,
  }),
}
// Cordis throws on any ctx.<service> read the inject declaration does not list.
// Enforce the same rule here so an undeclared access fails the suite, not boot.
const strictCtx = new Proxy(baseCtx, {
  get(target, key) {
    if (typeof key === 'string' && !(key in target) && !declaredInject.includes(key)) {
      throw new Error('cannot get property "' + key + '" without inject')
    }
    return Reflect.get(target, key)
  },
})
moduleExports.apply(strictCtx)
for (const effect of effects) effect()

ok('one tab type is registered', recorded.tabs.length === 1)
const tab = recorded.tabs[0] ?? {}
ok('the tab kind is genbox', tab.kind === 'genbox', String(tab.kind))
ok('the tab id is the package name', tab.id === 'dsh-genbox-plugin', String(tab.id))
ok('the tab is a singleton', tab.multiple === false)
ok('a body slot is registered for the tab id', recorded.slots.some((s) => s.definition.name === 'sidebar.right.pane.tab' && s.definition.key === tab.id))
ok('a title slot is registered for the tab id', recorded.slots.some((s) => s.definition.name === 'sidebar.right.pane.tab.title' && s.definition.key === tab.id))
ok('the guide entry points at the open command', tab.guide?.[0]?.commandId === 'genbox.open', String(tab.guide?.[0]?.commandId))
ok('one shortcut is registered', recorded.shortcuts.length === 1)
ok('the shortcut id matches the guide command', recorded.shortcuts[0]?.id === 'genbox.open', String(recorded.shortcuts[0]?.id))
ok('the shortcut refuses without a session', recorded.shortcuts[0]?.resolve({ target: undefined })?.status === 'blocked')
const handled = recorded.shortcuts[0]?.resolve({ target: { sessionId: 's1' } })
ok('the shortcut reports handled with a target', handled?.status === 'handled')
handled?.run()
ok('running the shortcut opens the genbox tab', recorded.opened?.kind === 'genbox', String(recorded.opened?.kind))

// --- the rendered body mounts a leased webview ---------------------------------
const attributes = []
const appended = []
const listeners = new Map()
const guest = {
  isConnected: false,
  style: { cssText: '' },
  setAttribute: (name, value) => { attributes.push([name, value]) },
  addEventListener: (name, fn) => { listeners.set(name, fn) },
  remove: () => {},
  reload: () => { guest.reloaded = true },
  loadURL: async (url) => { guest.loaded = url },
}
globalThis.document = { createElement: (tag) => { guest.tag = tag; return guest } }
let acquiredWorkspace
globalThis.dshDesktop = {
  protocolVersion: 1,
  browser: {
    acquire: async (workspace) => { acquiredWorkspace = workspace; return { lease: 'LEASE-1', partition: 'PART-1' } },
    release: async () => {},
  },
}

const bodySlot = recorded.slots.find((s) => s.definition.name === 'sidebar.right.pane.tab')?.component
const host = {
  appendChild: (element) => { appended.push(element); element.isConnected = true },
  append: (element) => { appended.push(element); element.isConnected = true },
}
const tree = bodySlot({ sessionId: 's1' })
const hostNode = findByAttr(tree, 'data-genbox-panel').find((node) => node.props['data-genbox-panel'] === 'host')
if (hostNode?.props.ref !== undefined) hostNode.props.ref.current = host
for (const effect of pendingEffects) effect()
await new Promise((resolve) => setTimeout(resolve, 0))
await new Promise((resolve) => setTimeout(resolve, 0))

ok('the panel renders an address bar', findByAttr(tree, 'data-genbox-panel').some((n) => n.props['data-genbox-panel'] === 'address'))
ok('a webview element is created on desktop', guest.tag === 'webview', String(guest.tag))
ok('the main process is asked for a lease', typeof acquiredWorkspace === 'string' && acquiredWorkspace.length > 0, String(acquiredWorkspace))
ok('the guest attaches at about:blank#<lease>', attributes.some(([n, v]) => n === 'src' && v === 'about:blank#LEASE-1'), JSON.stringify(attributes))
ok('the guest carries the leased partition', attributes.some(([n, v]) => n === 'partition' && v === 'PART-1'), JSON.stringify(attributes))
ok('the guest is appended into the panel host', appended.includes(guest))
listeners.get('dom-ready')?.()
await new Promise((resolve) => setTimeout(resolve, 0))
ok('dom-ready navigates to the GenBox UI', guest.loaded === 'http://127.0.0.1:8892/', String(guest.loaded))

// --- the DSH shortcut-registry contract ---------------------------------------
// The shell validates every declared default against every other command for
// all six runtime×platform pairs, and throws from inside register(). That throw
// does not just lose the shortcut: it fails this plugin's apply(), and every
// plugin waiting on its services stays pending ("web boot: N entries did not
// activate"). 0.2.1 shipped `web:*` defaults equal to core's `session.rename`
// (primary+alt+G) and bricked the Web boot on every platform. Mirror the check
// here against the core defaults so the next collision fails this suite.
const MODIFIER_ORDER = ['control', 'alt', 'shift', 'meta']
const CORE_SHORTCUT_DEFAULTS = [
  ['session.new', { 'desktop:macos': ['KeyN', ['primary']], 'desktop:windows': ['KeyN', ['primary']], 'desktop:linux': ['KeyN', ['primary']], 'web:macos': ['KeyN', ['primary', 'alt']], 'web:windows': ['KeyN', ['primary', 'alt']] }],
  ['session.search', { 'desktop:macos': ['KeyK', ['primary']], 'desktop:windows': ['KeyK', ['primary']], 'desktop:linux': ['KeyK', ['primary']], 'web:macos': ['KeyK', ['primary', 'alt']], 'web:windows': ['KeyK', ['primary', 'alt']] }],
  ['workspace.add', { 'desktop:macos': ['KeyO', ['primary']], 'desktop:windows': ['KeyO', ['primary']], 'desktop:linux': ['KeyO', ['primary']], 'web:macos': ['KeyO', ['primary', 'alt']], 'web:windows': ['KeyO', ['primary', 'alt']] }],
  ['session.rename', { 'desktop:macos': ['KeyG', ['primary', 'alt']], 'desktop:windows': ['KeyG', ['primary', 'alt']], 'desktop:linux': ['KeyG', ['primary', 'alt']], 'web:macos': ['KeyG', ['primary', 'alt']], 'web:windows': ['KeyG', ['primary', 'alt']] }],
  ['session.fork', { 'desktop:macos': ['KeyF', ['primary', 'alt']], 'desktop:windows': ['KeyF', ['primary', 'alt']], 'desktop:linux': ['KeyF', ['primary', 'alt']], 'web:macos': ['KeyF', ['primary', 'shift']], 'web:windows': ['KeyF', ['primary', 'shift']] }],
  ['session.archive', { 'desktop:macos': ['KeyA', ['primary', 'shift']], 'desktop:windows': ['KeyA', ['primary', 'shift']], 'desktop:linux': ['KeyA', ['primary', 'shift']], 'web:macos': ['KeyA', ['primary', 'alt']], 'web:windows': ['KeyA', ['primary', 'alt']] }],
  ['sidebar.left.toggle', { 'desktop:macos': ['KeyB', ['primary']], 'desktop:windows': ['KeyB', ['primary']], 'desktop:linux': ['KeyB', ['primary']], 'web:macos': ['KeyB', ['primary', 'alt']], 'web:windows': ['KeyB', ['primary', 'alt']] }],
  ['sidebar.right.toggle', { 'desktop:macos': ['KeyB', ['primary', 'alt']], 'desktop:windows': ['KeyB', ['primary', 'alt']], 'desktop:linux': ['KeyB', ['primary', 'alt']], 'web:macos': ['KeyB', ['primary', 'shift']], 'web:windows': ['KeyB', ['primary', 'shift']] }],
  ['workspace.files', { 'desktop:macos': ['KeyP', ['primary']], 'desktop:windows': ['KeyP', ['primary']], 'desktop:linux': ['KeyP', ['primary']], 'web:macos': ['KeyP', ['primary', 'alt']], 'web:windows': ['KeyP', ['primary', 'alt']] }],
  ['workspace.openLocal', { 'desktop:macos': ['KeyO', ['primary', 'alt']], 'desktop:windows': ['KeyO', ['primary', 'alt']], 'desktop:linux': ['KeyO', ['primary', 'alt']], 'web:macos': ['KeyO', ['primary', 'shift']], 'web:windows': ['KeyO', ['primary', 'shift']] }],
  ['browser.new', { 'desktop:macos': ['KeyT', ['primary']], 'desktop:windows': ['KeyT', ['primary']], 'desktop:linux': ['KeyT', ['primary']], 'web:macos': ['KeyT', ['primary', 'alt']], 'web:windows': ['KeyT', ['primary', 'alt']] }],
  ['settings.open', { 'desktop:macos': ['Comma', ['primary']], 'desktop:windows': ['Comma', ['primary']], 'desktop:linux': ['Comma', ['primary']], 'web:macos': ['Comma', ['primary', 'alt']], 'web:windows': ['Comma', ['primary', 'alt']] }],
  ['shortcuts.open', { 'desktop:macos': ['Slash', ['primary']], 'desktop:windows': ['Slash', ['primary']], 'desktop:linux': ['Slash', ['primary']], 'web:macos': ['Slash', ['primary']], 'web:windows': ['Slash', ['primary']], 'web:linux': ['Slash', ['primary']] }],
  ['terminal.new', { 'desktop:macos': ['Backquote', ['control']], 'desktop:windows': ['Backquote', ['control']], 'desktop:linux': ['Backquote', ['control']], 'web:macos': ['Backquote', ['control']], 'web:windows': ['Backquote', ['control']] }],
  ['pane.split', { 'desktop:macos': ['Backslash', ['primary']], 'desktop:windows': ['Backslash', ['primary']], 'desktop:linux': ['Backslash', ['primary']], 'web:macos': ['Backslash', ['primary']], 'web:windows': ['Backslash', ['primary']], 'web:linux': ['Backslash', ['primary']] }],
  ['pane.fullscreen.toggle', { 'desktop:macos': ['Enter', ['primary', 'alt']], 'desktop:windows': ['Enter', ['primary', 'alt']], 'desktop:linux': ['Enter', ['primary', 'alt']], 'web:macos': ['Enter', ['primary', 'alt']], 'web:windows': ['Enter', ['primary', 'alt']] }],
  ['page.close', { 'desktop:macos': ['KeyW', ['primary']], 'desktop:windows': ['KeyW', ['primary']], 'desktop:linux': ['KeyW', ['primary']], 'web:macos': ['KeyW', ['primary', 'alt']], 'web:windows': ['KeyW', ['primary', 'alt']] }],
  ['page.refresh', { 'desktop:macos': ['KeyR', ['primary']], 'desktop:windows': ['KeyR', ['primary']], 'desktop:linux': ['KeyR', ['primary']], 'web:macos': ['KeyR', ['primary', 'alt']], 'web:windows': ['KeyR', ['primary', 'alt']] }],
]

/** dsh-client-shortcuts: resolve `primary` per platform, then order modifiers. */
function normalizeBinding(binding, platform) {
  const [code, modifiers] = Array.isArray(binding) ? binding : [binding.code, binding.modifiers]
  const resolved = new Set(modifiers.map((value) => value === 'primary' ? (platform === 'macos' ? 'meta' : 'control') : value))
  return { code, modifiers: MODIFIER_ORDER.filter((value) => resolved.has(value)) }
}

/** dsh-client-shortcuts: exact modifier set + same physical key. */
const overlaps = (left, right) => left.modifiers.join('+') === right.modifiers.join('+') && left.code === right.code

/** dsh-client-shortcuts: the Web key space is a small, shell-owned whitelist. */
function webBindingAllowed(binding, platform) {
  const modifiers = binding.modifiers
  if (modifiers.length >= 3) return true
  const primary = platform === 'macos' ? 'meta' : 'control'
  if (modifiers.length === 1 && modifiers[0] === primary && ['Comma', 'Backslash', 'Slash'].includes(binding.code)) return true
  if (modifiers.length === 1 && modifiers[0] === 'control' && binding.code === 'Backquote') return true
  return modifiers.length === 2 && modifiers.includes(primary) && (modifiers.includes('alt') || modifiers.includes('shift'))
}

const shortcut = recorded.shortcuts[0] ?? {}
const shortcutProblems = []
for (const runtime of ['desktop', 'web']) {
  for (const platform of ['macos', 'windows', 'linux']) {
    const raw = shortcut.defaults?.[runtime + ':' + platform]
    if (raw === undefined) continue
    const binding = normalizeBinding(raw, platform)
    if (runtime === 'web' && !webBindingAllowed(binding, platform)) shortcutProblems.push(runtime + ':' + platform + ' is outside the Web key space')
    for (const [coreId, coreDefaults] of CORE_SHORTCUT_DEFAULTS) {
      const other = coreDefaults[runtime + ':' + platform]
      if (other !== undefined && overlaps(binding, normalizeBinding(other, platform))) shortcutProblems.push(runtime + ':' + platform + ' collides with core ' + coreId)
    }
  }
}
ok('genbox.open defaults survive the DSH shortcut registry', shortcutProblems.length === 0, shortcutProblems.join('; '))
ok('the desktop shortcut stays Ctrl/Cmd+Shift+G (the documented way in)',
  shortcut.defaults?.['desktop:macos']?.code === 'KeyG' && shortcut.defaults?.['desktop:macos']?.modifiers?.join('+') === 'primary+shift',
  JSON.stringify(shortcut.defaults?.['desktop:macos']))

const failed = checks.filter((check) => !check.passed)
console.log('')
if (failed.length > 0) {
  console.log('FAIL genbox client panel (' + failed.length + '/' + checks.length + ' failed)')
  process.exitCode = 1
} else {
  console.log('OK (' + checks.length + ' checks)')
}
