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
import { chmod, mkdir, readdir, readFile, rm, stat, cp, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
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
  const bytes = await byteSize(path)
  const units = ['B', 'KB', 'MB', 'GB'] as const
  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit += 1
  }
  const digits = value >= 10 || unit === 0 ? 0 : 1
  return `${value.toFixed(digits)} ${units[unit]}`
}

/** Cross-platform replacement for `du`: also works in Windows build shells. */
async function byteSize(path: string): Promise<number> {
  const info = await lstat(path)
  if (!info.isDirectory()) return info.size
  const entries = await readdir(path, { withFileTypes: true })
  const sizes = await Promise.all(entries.map((entry) => byteSize(join(path, entry.name))))
  return sizes.reduce((total, size) => total + size, 0)
}

/**
 * One clean directory per version. Older versions keep their own directories,
 * while rebuilding this version cannot leave stale installers from an earlier
 * run mixed into the result.
 */
async function outputDir(): Promise<string> {
  const dir = join(RELEASE_DIR, conf.version)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  return dir
}

/** Bundle directories can retain artifacts from earlier versions. */
function isCurrentVersionArtifact(name: string): boolean {
  return name.includes(conf.version)
}

/**
 * Release file names are renamed away from whatever `tauri build` produced
 * (Cargo target triples, lowercase-and-arch `.deb` conventions, ...) to one
 * scheme across platforms — a download picker or a PKGBUILD should not have
 * to know what `unknown-linux-gnu` means.
 */
function macArch(): string {
  return process.arch === 'arm64' ? 'arm64' : 'x64'
}

function linuxArch(): string {
  return process.arch === 'arm64' ? 'aarch64' : 'x86_64'
}

function canonicalLinuxName(kind: 'deb' | 'rpm' | 'appimage', arch: string): string {
  const ext = kind === 'appimage' ? 'AppImage' : kind
  return `${conf.productName}_${conf.version}_linux_${arch}.${ext}`
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

function requestedBundleKinds(): Set<string> | null {
  const at = process.argv.indexOf('--bundles')
  if (at === -1 || !process.argv[at + 1]) return null
  const kinds = process.argv[at + 1]
    .toLowerCase()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return kinds.length > 0 ? new Set(kinds) : null
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
  const dmgSource = existsSync(dmgDir)
    ? (await readdir(dmgDir)).find(
        (name) => name.endsWith('.dmg') && isCurrentVersionArtifact(name),
      )
    : undefined
  let dmgTarget: string | undefined
  let dmgName: string | undefined
  if (dmgSource) {
    dmgName = `${conf.productName}_${conf.version}_macOS_${universal ? 'universal' : macArch()}.dmg`
    dmgTarget = join(outDir, dmgName)
    await cp(join(dmgDir, dmgSource), dmgTarget)
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
 * A standalone tarball, for the Linux desktops neither installer format
 * reaches: `.deb`/`.rpm` do not install on Arch, and AppImage needs FUSE a
 * base install may not have. The `usr/...` layout is not incidental — it is
 * what a PKGBUILD expects to `cp -r` straight into `$pkgdir`.
 */
async function packageLinuxTarball(
  outDir: string,
  arch: string,
  binary: string,
): Promise<string | undefined> {
  if (!existsSync(binary)) return undefined

  const stageDir = join(outDir, '.tarball-stage')
  await rm(stageDir, { recursive: true, force: true })
  await mkdir(join(stageDir, 'usr/bin'), { recursive: true })
  await mkdir(join(stageDir, 'usr/share/applications'), { recursive: true })
  await mkdir(join(stageDir, 'usr/share/icons/hicolor/512x512/apps'), { recursive: true })

  await cp(binary, join(stageDir, 'usr/bin', BINARY))
  await chmod(join(stageDir, 'usr/bin', BINARY), 0o755)
  await cp(
    join(ROOT, 'src-tauri/linux/veloread.desktop'),
    join(stageDir, 'usr/share/applications', `${BINARY}.desktop`),
  )
  await cp(
    join(ROOT, 'src-tauri/icons/icon.png'),
    join(stageDir, 'usr/share/icons/hicolor/512x512/apps', `${BINARY}.png`),
  )

  const tarPath = join(outDir, `${conf.productName}_${conf.version}_linux_${arch}.tar.gz`)
  await $`tar -czf ${tarPath} -C ${stageDir} usr`.quiet()
  await rm(stageDir, { recursive: true, force: true })
  return tarPath
}

/**
 * Linux installers, the standalone tarball, and the loose executable either way.
 *
 * `tauri.conf.json` asks for every bundle target, which here means `.deb`,
 * `.rpm` and `.AppImage`. Each needs its own tooling installed, and a machine
 * missing one should still get a build it can run — so a failed bundle step is
 * reported rather than fatal, and the executable is always pointed at.
 */
async function buildLinux() {
  const arch = linuxArch()
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

  const requestedKinds = requestedBundleKinds()
  const kinds = (['deb', 'rpm', 'appimage'] as const).filter(
    (kind) => requestedKinds === null || requestedKinds.has(kind),
  )
  for (const kind of kinds) {
    const dir = join(bundleDir, kind)
    if (!existsSync(dir)) continue
    for (const name of await readdir(dir)) {
      if (!/\.(AppImage|deb|rpm)$/i.test(name) || !isCurrentVersionArtifact(name)) continue
      const destination = join(outDir, canonicalLinuxName(kind, arch))
      await cp(join(dir, name), destination)
      // cp keeps the mode, but an AppImage that is not executable is a puzzle
      // rather than an app.
      if (kind === 'appimage') await chmod(destination, 0o755)
      collected.push(destination)
    }
  }

  const tarball = await packageLinuxTarball(outDir, arch, binary)
  if (tarball) collected.push(tarball)

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
  console.log(`\n▸ ${outDir}`)
  for (const file of collected) {
    console.log(`  ${file.split('/').pop()}   ${await humanSize(file)}`)
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
      if (!/\.(msi|exe)$/i.test(name) || !isCurrentVersionArtifact(name)) continue
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
