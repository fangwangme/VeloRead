#!/usr/bin/env bun
/**
 * Install the desktop application to the current user's local environment.
 *
 * On Linux:
 *   - Builds the binary via `bun run app:build -- --no-bundle`
 *   - Installs executable to `~/.local/bin/veloread`
 *   - Installs desktop launcher to `~/.local/share/applications/veloread.desktop`
 *   - Installs icon to `~/.local/share/icons/hicolor/512x512/apps/veloread.png`
 *
 * On macOS:
 *   - Builds the `.app` bundle via `bun run app:build`
 *   - Installs `VeloRead.app` to `~/Applications/`
 */
import { $ } from 'bun'
import { existsSync } from 'node:fs'
import { chmod, cp, mkdir, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const TAURI_CONF = join(ROOT, 'src-tauri/tauri.conf.json')
const TARGET_DIR = join(ROOT, '.local/target')
const BINARY = 'veloread'

const conf = JSON.parse(await readFile(TAURI_CONF, 'utf8')) as {
  version: string
  productName: string
}

const HOME = homedir()
const platform = process.platform

async function installLinux() {
  console.log(`\n▸ Installing ${conf.productName} v${conf.version} for current user (${HOME})...\n`)

  // 1. Build the release binary
  console.log('• Building release binary...')
  const build = Bun.spawnSync(['bun', 'run', 'scripts/build-app.ts', '--', '--no-bundle'], {
    cwd: ROOT,
    stdio: ['inherit', 'inherit', 'inherit'],
  })
  if (build.exitCode !== 0) {
    console.error(`\n✗ Build failed with exit code ${build.exitCode}`)
    process.exit(build.exitCode ?? 1)
  }

  const binarySource = join(TARGET_DIR, 'release', BINARY)
  if (!existsSync(binarySource)) {
    console.error(`\n✗ Compiled executable not found at ${binarySource}`)
    process.exit(1)
  }

  // 2. Prepare user directories
  const binDir = join(HOME, '.local/bin')
  const appsDir = join(HOME, '.local/share/applications')
  const iconDir = join(HOME, '.local/share/icons/hicolor/512x512/apps')

  await mkdir(binDir, { recursive: true })
  await mkdir(appsDir, { recursive: true })
  await mkdir(iconDir, { recursive: true })

  // 3. Copy binary
  const binaryTarget = join(binDir, BINARY)
  console.log(`• Installing binary to ${binaryTarget}`)
  await cp(binarySource, binaryTarget)
  await chmod(binaryTarget, 0o755)

  // 4. Copy .desktop launcher
  const desktopSource = join(ROOT, 'src-tauri/linux/veloread.desktop')
  const desktopTarget = join(appsDir, `${BINARY}.desktop`)
  if (existsSync(desktopSource)) {
    console.log(`• Installing desktop launcher to ${desktopTarget}`)
    await cp(desktopSource, desktopTarget)
  }

  // 5. Copy app icon
  const iconSource = join(ROOT, 'src-tauri/icons/icon.png')
  const iconTarget = join(iconDir, `${BINARY}.png`)
  if (existsSync(iconSource)) {
    console.log(`• Installing icon to ${iconTarget}`)
    await cp(iconSource, iconTarget)
  }

  // 6. Refresh desktop database if tool exists
  await $`update-desktop-database ${appsDir}`.nothrow().quiet()

  console.log(`\n✓ Successfully installed ${conf.productName} v${conf.version} to ~/.local/!`)
  console.log(`\n  Run in terminal:   ${BINARY}`)
  console.log(`  Or launch from:    Application launcher (Rofi / Wofi / App Menu)\n`)

  const pathEnv = process.env.PATH ?? ''
  if (!pathEnv.split(':').includes(binDir)) {
    console.log(`  Note: ${binDir} does not appear in your $PATH.`)
    console.log(`  Add 'export PATH="$HOME/.local/bin:$PATH"' to your shell profile (~/.zshrc or ~/.bashrc).\n`)
  }
}

async function installMacOS() {
  console.log(`\n▸ Installing ${conf.productName} v${conf.version} on macOS...\n`)

  // 1. Build .app bundle
  const build = Bun.spawnSync(['bun', 'run', 'scripts/build-app.ts'], {
    cwd: ROOT,
    stdio: ['inherit', 'inherit', 'inherit'],
  })
  if (build.exitCode !== 0) {
    console.error(`\n✗ Build failed with exit code ${build.exitCode}`)
    process.exit(build.exitCode ?? 1)
  }

  const appSource = join(TARGET_DIR, 'release/bundle/macos', `${conf.productName}.app`)
  if (!existsSync(appSource)) {
    console.error(`\n✗ Built .app bundle not found at ${appSource}`)
    process.exit(1)
  }

  const userAppsDir = join(HOME, 'Applications')
  await mkdir(userAppsDir, { recursive: true })
  const appTarget = join(userAppsDir, `${conf.productName}.app`)

  console.log(`• Copying application to ${appTarget}`)
  await rm(appTarget, { recursive: true, force: true })
  await cp(appSource, appTarget, { recursive: true, verbatimSymlinks: true })

  console.log(`\n✓ Successfully installed ${conf.productName} v${conf.version} to ${appTarget}!\n`)
}

if (platform === 'linux') {
  await installLinux()
} else if (platform === 'darwin') {
  await installMacOS()
} else {
  console.error(`\n✗ install-app is not currently supported on ${platform}`)
  process.exit(1)
}
