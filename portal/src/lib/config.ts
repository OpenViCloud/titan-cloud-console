export interface AppConfig {
  keycloakUrl: string
  keycloakRealm: string
  keycloakClientId: string
  apiBaseUrl: string
  // Buying credit shows only when this is the boolean true; absent means off
  // (docs/features/billing/topup/design.md#topup-portal).
  topUpEnabled?: boolean
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
