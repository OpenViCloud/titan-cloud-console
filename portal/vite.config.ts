import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// `npm run dev` runs against the dev cluster (local), never against a mock: the API is proxied so the
// browser stays on one origin, and /config.json is the cluster's own, with the API made relative
// (titan-ops features/cloud-console/design.md#portal-config-and-deploy).
const DEV_API = 'http://api.localhost:8080'
const DEV_PORTAL = 'http://portal.localhost:8080'

function devClusterConfig(): Plugin {
  return {
    name: 'dev-cluster-config',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/config.json', async (_req, res) => {
        const app = DEV_PORTAL
        try {
          const cluster = await fetch(app + '/config.json')
          const config = (await cluster.json()) as Record<string, unknown>
          config.apiBaseUrl = ''
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(config))
        } catch (error) {
          res.statusCode = 502
          res.end(`dev cluster unreachable at ${app}/config.json — start it with lima/scripts/up.sh of OpenViCloud/titan-local-cluster (${String(error)})`)
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devClusterConfig()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/v1': { target: DEV_API, changeOrigin: true, ws: true },
    },
  },
})
