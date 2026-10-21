import axios from 'axios'
import { User } from 'oidc-client-ts'
import { getConfig } from './config'
import { userManager } from './auth'
import { browserStorage, signinArgs } from '@/i18n/lang'

function getUser(): User | null {
  const { keycloakUrl, keycloakRealm, keycloakClientId } = getConfig()
  const key = `oidc.user:${keycloakUrl}/realms/${keycloakRealm}:${keycloakClientId}`
  const raw = sessionStorage.getItem(key)
  if (!raw) return null
  return User.fromStorageString(raw)
}

export const api = axios.create()

api.interceptors.request.use(config => {
  config.baseURL = getConfig().apiBaseUrl
  const user = getUser()
  if (user?.access_token) {
    config.headers.Authorization = `Bearer ${user.access_token}`
  }
  return config
})

let isRedirecting = false

api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401 && !isRedirecting && userManager) {
      isRedirecting = true
      userManager.signinRedirect(signinArgs(browserStorage()))
    }
    return Promise.reject(err)
  }
)
