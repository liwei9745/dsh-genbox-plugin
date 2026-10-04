/**
 * GenBox inside DSH NEXT — client half.
 *
 * Registers a native right-sidebar tab kind ("genbox") whose body hosts the real
 * GenBox web UI in an Electron <webview>. Desktop guests are leased from the
 * main process (dshDesktop.browser.acquire); plain <iframe> cannot work because
 * GenBox answers with \`X-Frame-Options: DENY\` and \`frame-ancestors 'none'\`.
 *
 * Hand-written bundle: the shell materializes it through window.__ModuleLoader__,
 * so it must be a single script that only *registers* a factory.
 */
window.__ModuleLoader__.load({
	id: "dsh-genbox-plugin",
	factory: (require) => {
		const React = require("react")
		const jsx = require("react/jsx-runtime")

		/** Tab type id, body-slot key and registry identity. */
		const GENBOX_ID = "dsh-genbox-plugin"
		/** Tab kind this plugin owns. */
		const GENBOX_KIND = "genbox"
		/** Where the address the panel opens by default lives. */
		const DEFAULT_URL = "http://127.0.0.1:8892/"
		const STORAGE_KEY = "dsh.genbox-panel.address.v1"

		/** Read the last address the user opened, falling back to the default. */
		function storedAddress() {
			try {
				const value = globalThis.localStorage?.getItem(STORAGE_KEY)
				if (typeof value === "string" && value.trim() !== "") return value
			} catch {}
			return DEFAULT_URL
		}

		/** Persist an address; storage failures must never break the panel. */
		function rememberAddress(value) {
			try {
				globalThis.localStorage?.setItem(STORAGE_KEY, value)
			} catch {}
		}

		/** Normalize a typed address into a navigable http(s) URL, or undefined. */
		function normalizeAddress(raw) {
			const value = String(raw ?? "").trim()
			if (value === "") return void 0
			const candidate = /^https?:\/\//iu.test(value) ? value : "http://" + value
			try {
				const url = new URL(candidate)
				return url.protocol === "http:" || url.protocol === "https:" ? url.href : void 0
			} catch {
				return void 0
			}
		}

		/** The Electron carrier that approves sidebar webview guests, when present. */
		function desktopBridge() {
			const carrier = globalThis.dshDesktop
			return carrier?.protocolVersion === 1 ? carrier.browser : void 0
		}

		/**
		 * One leased GenBox guest inside a DOM host.
		 * @param host - container that receives the guest element.
		 * @param address - initial http(s) address.
		 * @returns a handle with navigate(), reload(), dispose() and the element.
		 */
		function mountGuest(host, address) {
			const bridge = desktopBridge()
			if (bridge === void 0) return { kind: "unsupported" }
			const element = document.createElement("webview")
			element.setAttribute("allowpopups", "")
			element.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;background:#101014"
			host.append(element)
			const states = {
				lease: void 0,
				current: address,
				ready: false,
				disposed: false,
				queue: address,
			}
			const release = () => {
				const lease = states.lease
				states.lease = void 0
				if (lease !== void 0) bridge.release(lease).catch(() => {})
			}
			const navigate = (url) => {
				states.current = url
				states.queue = url
				if (!states.ready) return
				states.queue = void 0
				element.loadURL(url).catch(() => {})
			}
			/** Acquire the lease, then attach: the main process reads the lease from src. */
			const start = async () => {
				try {
					const reservation = await bridge.acquire("genbox-panel:" + states.current)
					if (states.disposed) {
						await bridge.release(reservation.lease).catch(() => {})
						return
					}
					states.lease = reservation.lease
					element.setAttribute("name", reservation.lease)
					element.setAttribute("partition", reservation.partition)
					element.setAttribute("src", "about:blank#" + reservation.lease)
					element.addEventListener("dom-ready", () => {
						states.ready = true
						navigate(states.queue ?? states.current)
					}, { once: true })
					if (element.isConnected !== true) host.append(element)
				} catch (error) {
					element.remove()
					states.error = error
				}
			}
			const dispose = () => {
				states.disposed = true
				release()
				element.remove()
			}
			start()
			return { kind: "webview", element, navigate, reload: () => element.reload?.(), dispose }
		}

		/** Panel body: address bar plus the embedded GenBox UI. */
		function GenBoxBody(props) {
			const [address, setAddress] = React.useState(storedAddress)
			const [draft, setDraft] = React.useState(address)
			const [status, setStatus] = React.useState("")
			const hostRef = React.useRef(null)
			const guestRef = React.useRef(null)
			const desktop = desktopBridge() !== void 0
			React.useEffect(() => {
				const host = hostRef.current
				if (host === null) return
				const guest = mountGuest(host, address)
				guestRef.current = guest
				if (guest.kind === "unsupported") setStatus("此环境不允许嵌入网页：DSH 桌面端才支持内置 GenBox 面板。")
				return () => {
					guestRef.current = null
					guest.dispose?.()
				}
			}, [])
			const go = (raw) => {
				const url = normalizeAddress(raw)
				if (url === void 0) {
					setStatus("请输入 http(s) 地址")
					return
				}
				setStatus("")
				setAddress(url)
				setDraft(url)
				rememberAddress(url)
				const guest = guestRef.current
				if (guest?.navigate !== void 0) guest.navigate(url)
				else if (guest?.kind === "webview") {
					guest.element?.remove()
					const host = hostRef.current
					if (host !== null) guestRef.current = mountGuest(host, url)
				}
			}
			return jsx.jsxs("div", {
				"data-genbox-panel": "root",
				style: {
					display: "flex",
					flexDirection: "column",
					height: "100%",
					minHeight: 0,
					background: "#101014",
				},
				children: [
					jsx.jsxs("div", {
						"data-genbox-panel": "bar",
						style: {
							display: "flex",
							alignItems: "center",
							gap: "6px",
							padding: "6px 8px",
							borderBottom: "1px solid rgba(255,255,255,0.12)",
							fontSize: "12px",
						},
						children: [
							jsx.jsx("span", { style: { opacity: 0.7 }, children: "GenBox" }),
							jsx.jsx("input", {
								value: draft,
								onChange: (event) => setDraft(event.target.value),
								onKeyDown: (event) => {
									if (event.key === "Enter") go(draft)
								},
								spellCheck: false,
								"data-genbox-panel": "address",
								style: {
									flex: 1,
									minWidth: 0,
									background: "rgba(255,255,255,0.06)",
									border: "1px solid rgba(255,255,255,0.12)",
									borderRadius: "4px",
									color: "inherit",
									padding: "3px 6px",
									font: "inherit",
								},
							}),
							jsx.jsx("button", { type: "button", onClick: () => go(draft), children: "前往" }),
							jsx.jsx("button", {
								type: "button",
								onClick: () => guestRef.current?.reload?.(),
								children: "刷新",
							}),
							jsx.jsx("button", {
								type: "button",
								onClick: () => globalThis.open?.(address, "_blank"),
								children: "在系统浏览器中打开",
							}),
						],
					}),
					status === "" ? null : jsx.jsx("div", {
						"data-genbox-panel": "status",
						style: { padding: "6px 8px", fontSize: "12px", opacity: 0.75 },
						children: status,
					}),
					desktop ? null : jsx.jsx("div", {
						"data-genbox-panel": "unsupported",
						style: { padding: "10px 12px", fontSize: "12px", lineHeight: 1.6, opacity: 0.85 },
						children: "GenBox 面板需要 DSH 桌面端（Electron）才能内嵌；浏览器里请用「在系统浏览器中打开」。",
					}),
					jsx.jsx("div", {
						ref: hostRef,
						"data-genbox-panel": "host",
						style: { position: "relative", flex: 1, minHeight: 0 },
					}),
				],
			})
		}

		/** Panel tab title. */
		function GenBoxTitle() {
			return jsx.jsx("span", { "data-genbox-panel": "title", children: "GenBox" })
		}

		/** The tab type this plugin contributes. */
		const definition = {
			id: GENBOX_ID,
			kind: GENBOX_KIND,
			multiple: false,
			priority: "extension",
			title: () => "GenBox",
			guide: [
				{
					id: "open",
					commandId: "genbox.open",
					order: 40,
					title: () => "GenBox",
					description: () => "在侧边栏内直接使用 GenBox 生图 / 改图 / 生视频 / 改视频",
				},
			],
		}

		/**
		 * Contribute the GenBox tab and its shortcut.
		 * @param ctx - client-side cordis context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.sidebarRightTabs.register(definition), "genbox: tab type")
			ctx.effect(
				() =>
					ctx.slots.inject("sidebar.right.pane.tab", () =>
						ctx.slots.register(
							{ name: "sidebar.right.pane.tab", key: GENBOX_ID },
							GenBoxBody,
						),
					),
				"genbox: tab body",
			)
			ctx.effect(
				() =>
					ctx.slots.inject("sidebar.right.pane.tab.title", () =>
						ctx.slots.register(
							{ name: "sidebar.right.pane.tab.title", key: GENBOX_ID },
							GenBoxTitle,
						),
					),
				"genbox: tab title",
			)
			ctx.inject(["shortcuts"], (scope) => {
				scope.effect(
					() =>
						scope.shortcuts.register({
							id: "genbox.open",
							label: () => "GenBox",
							aliases: ["genbox", "open genbox panel"],
							defaults: {
								"desktop:macos": { code: "KeyG", modifiers: ["primary", "shift"] },
								"desktop:windows": { code: "KeyG", modifiers: ["primary", "shift"] },
								"desktop:linux": { code: "KeyG", modifiers: ["primary", "shift"] },
								"web:macos": { code: "KeyG", modifiers: ["primary", "alt"] },
								"web:windows": { code: "KeyG", modifiers: ["primary", "alt"] },
							},
							regions: ["page", "editable", "terminal"],
							modals: [],
							resolve: ({ target: element }) => {
								const target = scope.sidebarRight.commandTarget(element)
								if (target === void 0) return { status: "blocked", reason: "请先打开一个会话" }
								return {
									status: "handled",
									run: () => {
										scope.sidebarRight.openTabFromTarget(GENBOX_KIND, target)
									},
								}
							},
						}),
					"genbox: open shortcut",
				)
			})
		}

		/** Services this plugin's apply() touches. */
		function inject() {
			return ["slots", "sidebarRight", "sidebarRightTabs"]
		}

		const exports = { apply, inject }
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })
		return exports
	},
})
