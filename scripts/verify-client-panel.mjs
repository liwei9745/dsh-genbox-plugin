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

const failed = checks.filter((check) => !check.passed)
console.log('')
if (failed.length > 0) {
  console.log('FAIL genbox client panel (' + failed.length + '/' + checks.length + ' failed)')
  process.exitCode = 1
} else {
  console.log('OK (' + checks.length + ' checks)')
}
