export interface AppConfig {
  keycloakUrl: string
  keycloakRealm: string
  keycloakClientId: string
  apiBaseUrl: string
}

let _config: AppConfig | null = null

export async function loadConfig(): Promise<AppConfig> {
  const res = await fetch('/config.json')
  _config = await res.json()
  return _config!
}

export function getConfig(): AppConfig {
  if (!_config) throw new Error('Config not loaded')
  return _config
}

export function setConfig(config: AppConfig): void {
  _config = config
}
