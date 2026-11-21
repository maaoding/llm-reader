import { readFile, readdir, stat } from 'node:fs/promises'
import { URL, fileURLToPath } from 'node:url'
import { extname, join, relative } from 'node:path'
import { parse } from 'parse5'
import console from 'node:console'
import process from 'node:process'

const output = fileURLToPath(new URL('../dist/', import.meta.url))
const origin = 'https://llm-reader.maaoding.icu'
const pages = new Map()
const failures = []

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await visit(path)
    else if (entry.name.endsWith('.html')) {
      const ids = new Set()
      const links = []
      function collect(node) {
        const attrs = Object.fromEntries((node.attrs ?? []).map(({ name, value }) => [name, value]))
        if (attrs.id) ids.add(attrs.id)
        if (['a', 'link'].includes(node.tagName) && attrs.href) links.push(attrs.href)
        if (['img', 'script'].includes(node.tagName) && attrs.src) links.push(attrs.src)
        for (const child of node.childNodes ?? []) collect(child)
      }
      collect(parse(await readFile(path, 'utf8')))
      pages.set(relative(output, path).replaceAll('\\', '/'), { ids, links })
    }
  }
}

await visit(output)
if (!pages.has('index.html') || !pages.has('docs/index.html')) failures.push('Missing homepage or documentation homepage')
if ((await readFile(join(output, 'CNAME'), 'utf8')).trim() !== new URL(origin).hostname) failures.push('Unexpected CNAME')
await stat(join(output, '.nojekyll'))
const sitemap = await readFile(join(output, 'docs/sitemap.xml'), 'utf8')
for (const [, location] of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
  const url = new URL(location)
  const path = decodeURIComponent(url.pathname).replace(/^\//, '').replace(/\/$/, '/index.html')
  if (url.origin !== origin || !path.startsWith('docs/') || !pages.has(path)) failures.push(`Invalid documentation sitemap entry: ${location}`)
}

let checked = 0
for (const [source, { links }] of pages) {
  for (const href of links) {
    const url = new URL(href, `${origin}/${source}`)
    if (url.origin !== origin) continue
    const requested = decodeURIComponent(url.pathname).replace(/^\//, '')
    let target = requested
    try {
      if ((await stat(join(output, target))).isDirectory()) target = join(target, 'index.html').replaceAll('\\', '/')
      if (!(await stat(join(output, target))).isFile()) throw new Error('Not a file')
      if (url.hash && extname(target) === '.html' && !pages.get(target)?.ids.has(decodeURIComponent(url.hash.slice(1)))) {
        failures.push(`${source}: missing fragment in ${href}`)
      }
    } catch {
      failures.push(`${source}: missing file for ${href}`)
    }
    checked++
  }
}

if (failures.length) {
  for (const failure of failures) console.error(failure)
  process.exitCode = 1
} else {
  console.log(`Website checked: ${pages.size} HTML pages, ${checked} local links and assets.`)
}
