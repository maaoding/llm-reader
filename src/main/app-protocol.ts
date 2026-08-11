import { readFile, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import { protocol } from 'electron'

const CONTENT_SECURITY_POLICY = [
  "default-src 'self' blob:",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-src 'self' blob:",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'llm-reader',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: false,
        bypassCSP: false
      }
    }
  ])
}

function response(body: BodyInit | null, status: number, contentType = 'text/plain; charset=utf-8'): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': contentType,
      'Content-Security-Policy': CONTENT_SECURITY_POLICY,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    }
  })
}

export async function installAppProtocol(rendererRoot: string): Promise<void> {
  const root = resolve(rendererRoot)
  await protocol.handle('llm-reader', async (request) => {
    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return response('Bad request', 400)
    }
    if (url.hostname !== 'app' || request.method !== 'GET') return response('Not found', 404)

    let requestedPath: string
    try {
      requestedPath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
    } catch {
      return response('Bad request', 400)
    }
    const candidate = resolve(root, requestedPath)
    const pathWithinRoot = relative(root, candidate)
    if (!pathWithinRoot || pathWithinRoot.startsWith('..') || isAbsolute(pathWithinRoot)) {
      return response('Not found', 404)
    }

    try {
      const fileInfo = await stat(candidate)
      if (!fileInfo.isFile()) return response('Not found', 404)
      const bytes = await readFile(candidate)
      return response(bytes, 200, MIME_TYPES[extname(candidate).toLowerCase()] ?? 'application/octet-stream')
    } catch {
      return response('Not found', 404)
    }
  })
}
