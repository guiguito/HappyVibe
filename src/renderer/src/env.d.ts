/// <reference types="vite/client" />

// §30: injected by electron.vite.config.ts's `define`. Build-time constants, not
// runtime values — there is deliberately no IPC behind either of them, because
// which build you are running is a fact fixed at build time.
declare const __APP_VERSION__: string
declare const __RUNTIME_PINS__: string
