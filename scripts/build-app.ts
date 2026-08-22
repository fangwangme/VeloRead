#!/usr/bin/env bun
/**
 * Package the desktop app, on whichever machine you happen to be sitting at.
 *
 * `tauri build` on its own is almost enough. This wrapper exists for the parts
 * that bite in practice: a stale disk image left mounted by an interrupted run
 * makes the next one fail at the very end, after the Rust release build has
 * already been paid for; the artifacts land four directories deep under a path
 * that changes as soon as you pass `--target`; and what "the app" even is
 * differs per platform — a `.app` on macOS, a `.AppImage` or `.deb` on Linux.
 *
 * It builds for the host platform. The product targets macOS, but the work
 * happens wherever the developer is, and a script that only runs on macOS means
 * everyone else cannot build or launch what they just changed.
 *
 *   bun run app:build                  # this machine, this architecture
 *   bun run app:build -- --no-bundle   # just the executable, no installers
 *   bun run app:build -- --universal   # macOS only: Intel + Apple silicon
 */
import { $ } from 'bun'
import { existsSync } from 'node:fs'
import { chmod, mkdir, readdir, readFile, rm, stat, cp } from 'node:fs/promises'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const TAURI_CONF = join(ROOT, 'src-tauri/tauri.conf.json')
const TARGET_DIR = join(ROOT, '.local/target')
const RELEASE_DIR = join(ROOT, '.local/release')

/** The Cargo binary name, from `[package] name` — not the product name. */
const BINARY = 'veloread'

const universal = process.argv.includes('--universal')
const noBundle = process.argv.includes('--no-bundle')

const conf = JSON.parse(await readFile(TAURI_CONF, 'utf8')) as {
  version: string
  productName: string
}

const platform = process.platform
if (universal && platform !== 'darwin') {
  console.error('✗ --universal builds a fat Mach-O binary and only means anything on macOS')
  process.exit(1)
}

async function humanSize(path: string): Promise<string> {
  const output = await $`du -sh ${path}`.text()
  return output.split('\t')[0].trim()
}

/** One directory per version, so an older build is still there to fall back to. */
async function outputDir(): Promise<string> {
  const dir = join(RELEASE_DIR, conf.version)
  await mkdir(dir, { recursive: true })
  return dir
}

/** Runs the build and hands back its exit code; the caller decides what a failure means. */
function runTauriBuild(extra: string[] = []): number {
  const args = ['tauri', 'build', ...extra, ...(noBundle ? ['--no-bundle'] : [])]
  const build = Bun.spawnSync(['bunx', ...args], {
    cwd: ROOT,
    stdio: ['inherit', 'inherit', 'inherit'],
  })
  return build.exitCode ?? 1
}

/** Anything after `--bundles`, so one format can be asked for by name. */
function requestedBundles(): string[] {
  const at = process.argv.indexOf('--bundles')
  return at !== -1 && process.argv[at + 1] ? ['--bundles', process.argv[at + 1]] : []
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

/** Distribution needs a Developer ID signature; a local build has none. */
async function signature(appPath: string): Promise<string> {
  const result = await $`codesign -dv ${appPath}`.nothrow().quiet()
  const text = result.stderr.toString()
  const authority = text.match(/^Authority=(.+)$/m)?.[1]
  if (authority) return authority
  return text.includes('adhoc') ? 'ad-hoc (not distributable)' : 'unsigned'
}

/** Where the plain executable lands, `--target` and all. */
function executablePath(target?: string): string {
  const name = platform === 'win32' ? `${BINARY}.exe` : BINARY
  return join(TARGET_DIR, target ?? '', 'release', name)
}

async function reportExecutable(target?: string) {
  const binary = executablePath(target)
  if (!existsSync(binary)) {
    console.error(`\n✗ expected an executable at ${binary}`)
    process.exit(1)
  }
  console.log(`\n▸ ${conf.productName} ${conf.version}`)
  console.log(`  ${binary.replace(ROOT, '')}   ${await humanSize(binary)}`)
  console.log(`\n  run it:  ${binary.replace(ROOT, './')}\n`)
}

async function buildMacOS() {
  const target = universal ? 'universal-apple-darwin' : undefined
  await detachStaleDiskImages()
  const code = runTauriBuild(target ? ['--target', target] : [])
  if (code !== 0) process.exit(code)
  if (noBundle) return reportExecutable(target)

  const bundleDir = join(TARGET_DIR, target ?? '', 'release/bundle')
  const appSource = join(bundleDir, 'macos', `${conf.productName}.app`)
  if (!existsSync(appSource)) {
    console.error(`\n✗ expected a bundle at ${appSource}`)
    process.exit(1)
  }

  const outDir = await outputDir()
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

  const arch = (await $`lipo -archs ${join(appTarget, `Contents/MacOS/${BINARY}`)}`.text()).trim()

  console.log(`\n▸ ${outDir}`)
  console.log(`  ${conf.productName}.app   ${await humanSize(appTarget)}   ${arch}`)
  if (dmgTarget) {
    console.log(
      `  ${dmgName}   ${(await stat(dmgTarget)).size / 1_000_000} MB`.replace(/(\.\d)\d+/, '$1'),
    )
  }
  console.log(`  signature: ${await signature(appTarget)}`)
  console.log(`\n  open ${appTarget.replace(ROOT, '')}\n`)
}

/**
 * Linux installers, and the loose executable either way.
 *
 * `tauri.conf.json` asks for every bundle target, which here means `.deb`,
 * `.rpm` and `.AppImage`. Each needs its own tooling installed, and a machine
 * missing one should still get a build it can run — so a failed bundle step is
 * reported rather than fatal, and the executable is always pointed at.
 */
async function buildLinux() {
  const code = runTauriBuild(requestedBundles())
  if (noBundle) {
    if (code !== 0) process.exit(code)
    return reportExecutable()
  }

  // A partial failure is the normal case here: AppImage needs `linuxdeploy`,
  // which needs FUSE, which plenty of desktops do not have. The formats that
  // did build are still worth having, and the executable is there regardless —
  // so this reports what came out instead of throwing the whole run away.
  const binary = executablePath()
  if (code !== 0 && !existsSync(binary)) process.exit(code)

  const bundleDir = join(TARGET_DIR, 'release/bundle')
  const outDir = await outputDir()
  const collected: string[] = []

  for (const kind of ['deb', 'rpm', 'appimage'] as const) {
    const dir = join(bundleDir, kind)
    if (!existsSync(dir)) continue
    for (const name of await readdir(dir)) {
      if (!/\.(AppImage|deb|rpm)$/i.test(name)) continue
      const destination = join(outDir, name)
      await cp(join(dir, name), destination)
      // cp keeps the mode, but an AppImage that is not executable is a puzzle
      // rather than an app.
      if (name.endsWith('.AppImage')) await chmod(destination, 0o755)
      collected.push(destination)
    }
  }

  console.log(`\n▸ ${conf.productName} ${conf.version}`)
  if (existsSync(binary)) {
    console.log(`  ${binary.replace(ROOT, '')}   ${await humanSize(binary)}`)
  }
  if (code !== 0) {
    console.log(
      `\n  note: a bundle step failed (exit ${code}). Whatever is listed below did build;`,
    )
    console.log('  ask for one format with:  bun run app:build -- --bundles deb')
  }
  if (collected.length === 0) {
    console.log('\n  no installers were produced — the bundle tooling may be missing.')
    console.log('  The executable above still runs; see docs/usage/build.md.')
  } else {
    console.log(`\n▸ ${outDir}`)
    for (const file of collected) {
      console.log(`  ${file.split('/').pop()}   ${await humanSize(file)}`)
    }
  }

  const appImage = collected.find((file) => file.endsWith('.AppImage'))
  console.log(
    `\n  run it:  ${(appImage ?? binary).replace(ROOT, './')}\n`,
  )
}

async function buildWindows() {
  const code = runTauriBuild()
  if (code !== 0) process.exit(code)
  if (noBundle) return reportExecutable()

  const bundleDir = join(TARGET_DIR, 'release/bundle')
  const outDir = await outputDir()
  const collected: string[] = []
  for (const kind of ['msi', 'nsis'] as const) {
    const dir = join(bundleDir, kind)
    if (!existsSync(dir)) continue
    for (const name of await readdir(dir)) {
      if (!/\.(msi|exe)$/i.test(name)) continue
      await cp(join(dir, name), join(outDir, name))
      collected.push(join(outDir, name))
    }
  }
  console.log(`\n▸ ${conf.productName} ${conf.version}`)
  for (const file of collected) console.log(`  ${file.replace(ROOT, '')}`)
  await reportExecutable()
}

console.log(
  `\n▸ ${conf.productName} ${conf.version} — ${platform}${universal ? ' (universal)' : ''}${
    noBundle ? ' (no bundle)' : ''
  }\n`,
)

if (platform === 'darwin') await buildMacOS()
else if (platform === 'linux') await buildLinux()
else if (platform === 'win32') await buildWindows()
else {
  console.error(`✗ unsupported platform: ${platform}`)
  process.exit(1)
}
