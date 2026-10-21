import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from 'react-oidc-context'
import { loadConfig } from './lib/config'
import { createOidcConfig } from './lib/auth'
import '@fontsource/be-vietnam-pro/400.css'
import '@fontsource/be-vietnam-pro/500.css'
import '@fontsource/be-vietnam-pro/600.css'
import '@fontsource/be-vietnam-pro/700.css'
import './index.css'
import { App } from './App'

async function bootstrap() {
  const config = await loadConfig()
  const oidcConfig = createOidcConfig(config)

  const root = createRoot(document.getElementById('root')!)
  root.render(
    <StrictMode>
      <AuthProvider {...oidcConfig}>
        <App />
      </AuthProvider>
    </StrictMode>,
  )
}

bootstrap()
