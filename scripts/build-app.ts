#!/usr/bin/env bun
/**
 * Package the desktop app.
 *
 * `tauri build` on its own is almost enough. This wrapper exists for the parts
 * that bite in practice: a stale disk image left mounted by an interrupted run
 * makes the next one fail at the very end, after the Rust release build has
 * already been paid for; and the artifacts land four directories deep under a
 * path that changes as soon as you pass `--target`.
 *
 *   bun run app:build              # this machine's architecture
 *   bun run app:build -- --universal   # one binary for Intel and Apple silicon
 */
import { $ } from 'bun'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat, cp } from 'node:fs/promises'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const TAURI_CONF = join(ROOT, 'src-tauri/tauri.conf.json')
const TARGET_DIR = join(ROOT, '.local/target')
const RELEASE_DIR = join(ROOT, '.local/release')

const universal = process.argv.includes('--universal')
const target = universal ? 'universal-apple-darwin' : undefined

const conf = JSON.parse(await readFile(TAURI_CONF, 'utf8')) as {
  version: string
  productName: string
}

/**
 * An interrupted `bundle_dmg.sh` leaves its scratch image mounted, and the next
 * run fails on the last step with only "failed to run bundle_dmg.sh" to go on.
 */
async function detachStaleDiskImages() {
  const volumes = existsSync('/Volumes') ? await readdir('/Volumes') : []
  for (const volume of volumes.filter((name) => name.startsWith('dmg.'))) {
    console.log(`  detaching stale volume /Volumes/${volume}`)
    await $`hdiutil detach ${join('/Volumes', volume)} -force`.nothrow().quiet()
  }
}

async function humanSize(path: string): Promise<string> {
  const output = await $`du -sh ${path}`.text()
  return output.split('\t')[0].trim()
}

/** Distribution needs a Developer ID signature; a local build has none. */
async function signature(appPath: string): Promise<string> {
  const result = await $`codesign -dv ${appPath}`.nothrow().quiet()
  const text = result.stderr.toString()
  const authority = text.match(/^Authority=(.+)$/m)?.[1]
  if (authority) return authority
  return text.includes('adhoc') ? 'ad-hoc (not distributable)' : 'unsigned'
}

console.log(`\n▸ ${conf.productName} ${conf.version}${universal ? ' (universal)' : ''}\n`)

await detachStaleDiskImages()

const args = ['tauri', 'build', ...(target ? ['--target', target] : [])]
const build = Bun.spawnSync(['bunx', ...args], { cwd: ROOT, stdio: ['inherit', 'inherit', 'inherit'] })
if (build.exitCode !== 0) process.exit(build.exitCode ?? 1)

const bundleDir = join(TARGET_DIR, target ?? '', 'release/bundle')
const appSource = join(bundleDir, 'macos', `${conf.productName}.app`)
if (!existsSync(appSource)) {
  console.error(`\n✗ expected a bundle at ${appSource}`)
  process.exit(1)
}

// One directory per version, so an older build is still there to fall back to
// and the path never depends on which --target produced it.
const outDir = join(RELEASE_DIR, conf.version)
await mkdir(outDir, { recursive: true })

const appTarget = join(outDir, `${conf.productName}.app`)
await rm(appTarget, { recursive: true, force: true })
await cp(appSource, appTarget, { recursive: true, verbatimSymlinks: true })

const dmgDir = join(bundleDir, 'dmg')
const dmgName = existsSync(dmgDir)
  ? (await readdir(dmgDir)).find((name) => name.endsWith('.dmg'))
  : undefined
let dmgTarget: string | undefined
if (dmgName) {
  dmgTarget = join(outDir, dmgName)
  await cp(join(dmgDir, dmgName), dmgTarget)
}

const arch = (await $`lipo -archs ${join(appTarget, 'Contents/MacOS/veloread')}`.text()).trim()

console.log(`\n▸ ${outDir}`)
console.log(`  ${conf.productName}.app   ${await humanSize(appTarget)}   ${arch}`)
if (dmgTarget) console.log(`  ${dmgName}   ${(await stat(dmgTarget)).size / 1_000_000} MB`.replace(/(\.\d)\d+/, '$1'))
console.log(`  signature: ${await signature(appTarget)}`)
console.log(`\n  open ${appTarget.replace(ROOT, '')}\n`)
