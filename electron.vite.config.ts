import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import { normalizePath, type Plugin } from 'vite'

function developmentReaderReload(): Plugin {
  const appModule = normalizePath(resolve('src/renderer/src/App.tsx'))
  return {
    name: 'reader:development-root-reload',
    apply: 'serve',
    hotUpdate({ file, modules, timestamp }) {
      if (this.environment.config.consumer !== 'client' || normalizePath(file) !== appModule) return

      // The root owns an imperative reader; reload to recreate it after cleanup.
      for (const module of modules) {
        this.environment.moduleGraph.invalidateModule(module, undefined, timestamp, true)
      }
      this.environment.hot.send({ type: 'full-reload', path: '*' })
      return []
    }
  }
}

function developmentHmrCsp(): Plugin {
  return {
    name: 'reader:development-hmr-csp',
    apply: 'serve',
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        const server = context.server
        const address = server?.resolvedUrls?.local[0] ?? server?.resolvedUrls?.network[0]
        const connection = server?.config.server.ws
        if (!server || !address || server.config.server.hmr === false || connection === false) return html

        const websocket = new URL(address)
        const options = connection ?? {}
        websocket.protocol = options.protocol
          ? `${options.protocol}:`
          : websocket.protocol === 'https:' ? 'wss:' : 'ws:'
        if (options.host) websocket.hostname = options.host.includes(':') && !options.host.startsWith('[') ? `[${options.host}]` : options.host
        const port = options.clientPort ?? options.port
        if (port !== undefined) websocket.port = String(port)

        return html.replace(/connect-src 'none'/g, `connect-src 'self' ${websocket.origin}`)
      }
    }
  }
}

export default defineConfig({
  main: {
    build: {
      externalizeDeps: true
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    build: {
      externalizeDeps: true,
      rolldownOptions: {
        output: {
          format: 'cjs',
          entryFileNames: 'index.js'
        }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    base: './',
    build: {
      rolldownOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          extraction: resolve('src/renderer/extraction.html')
        }
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [developmentHmrCsp(), developmentReaderReload(), react()]
  }
})
