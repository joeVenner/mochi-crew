// The plugin's types name the engine's module, which Claude Code provides only to a loaded
// plugin. The promo needs just the shapes the shared modules mention.
declare module 'claude-code' {
  export type HookFailure = { kind: string; message: string }
  export interface PluginState {}
}

declare module '*.wav' {
  const url: string
  export default url
}
