import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { URL } from 'node:url'

const root = new URL('../', import.meta.url)
const output = new URL('dist/', root)

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await cp(new URL('site/', root), output, { recursive: true })
await cp(new URL('docs/.vitepress/dist/', root), new URL('docs/', output), { recursive: true })
await cp(new URL('docs/404.html', output), new URL('404.html', output))
await writeFile(new URL('.nojekyll', output), '')
