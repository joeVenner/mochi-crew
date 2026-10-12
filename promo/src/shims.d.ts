// The plugin's types name the engine's module, which Claude Code provides only to a loaded
// plugin. The promo needs just the shapes the shared modules mention, mirrored from the engine's
// own types; this is not a type-check of the plugin, which `tsc -p plugins/mochi-crew` does.
declare module 'claude-code' {
  export type HookFailure = { readonly kind: 'throw' | 'timeout' | 're-entry'; readonly message?: string }
  // Empty here; the plugin's types/index.d.ts adds its state keys to it.
  export interface PluginState {}
}

declare module '*.wav' {
  const url: string
  export default url
}
