import { UserManager } from 'oidc-client-ts'
import type { AuthProviderProps } from 'react-oidc-context'
import type { AppConfig } from './config'

export let userManager: UserManager

export function createOidcConfig(config: AppConfig): AuthProviderProps {
  userManager = new UserManager({
    authority: `${config.keycloakUrl}/realms/${config.keycloakRealm}`,
    client_id: config.keycloakClientId,
    redirect_uri: window.location.origin,
    automaticSilentRenew: true,
    silent_redirect_uri: window.location.origin,
    post_logout_redirect_uri: window.location.origin,
  })
  return {
    userManager,
    onSigninCallback: () => {
      window.history.replaceState({}, document.title, window.location.pathname)
    },
  }
}
