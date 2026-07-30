import { access, chmod, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const configDir = path.resolve(scriptDir, "..")
const packageRoot = path.join(configDir, "node_modules", "@phtdacosta", "notifier-hook-darwin-arm64")
const launcherPath = path.join(configDir, "node_modules", "notifier-hook", "index.js")
const bundleRoot = path.join(packageRoot, "NotifierHook.app")
const bundleMacOSDir = path.join(bundleRoot, "Contents", "MacOS")
const bundleResourcesDir = path.join(bundleRoot, "Contents", "Resources")
const bundleInfoPlist = path.join(bundleRoot, "Contents", "Info.plist")
const bundleIconSetDir = path.join(bundleResourcesDir, "AppIcon.iconset")
const bundleIconFile = path.join(bundleResourcesDir, "NotifierHook.icns")
const sourceIconFile = path.join(configDir, "assets", "opencode-logo-dark.png")
const sourceBinary = path.join(packageRoot, "notifier-hook-daemon")
const bundledBinary = path.join(bundleMacOSDir, "notifier-hook-daemon")

async function main() {
  if (process.platform !== "darwin") return

  await access(sourceBinary)
  await access(sourceIconFile)
  await mkdir(bundleMacOSDir, { recursive: true })
  await mkdir(bundleResourcesDir, { recursive: true })
  await copyFile(sourceBinary, bundledBinary)
  await chmod(bundledBinary, 0o755)

  await rm(bundleIconSetDir, { recursive: true, force: true })
  await mkdir(bundleIconSetDir, { recursive: true })

  const iconSizes = [
    [16, 16],
    [32, 32],
    [64, 64],
    [128, 128],
    [256, 256],
    [512, 512],
    [1024, 1024],
  ]

  for (const [width, height] of iconSizes) {
    await execFileAsync("sips", ["-z", String(height), String(width), sourceIconFile, "--out", path.join(bundleIconSetDir, `icon_${width}x${height}.png`)])
    if (width !== 1024) {
      const doubledWidth = width * 2
      const doubledHeight = height * 2
      await execFileAsync("sips", ["-z", String(doubledHeight), String(doubledWidth), sourceIconFile, "--out", path.join(bundleIconSetDir, `icon_${width}x${height}@2x.png`)])
    }
  }

  await execFileAsync("iconutil", ["-c", "icns", bundleIconSetDir, "-o", bundleIconFile])

  const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>notifier-hook-daemon</string>
  <key>CFBundleIconFile</key>
  <string>NotifierHook</string>
  <key>CFBundleIdentifier</key>
  <string>com.opencode.notifier-hook</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>notifier-hook</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
</dict>
</plist>
`
  await writeFile(bundleInfoPlist, infoPlist)

  try {
    await execFileAsync("codesign", ["--force", "--deep", "--sign", "-", bundleRoot])
  } catch (error) {
    console.warn("setup-notifier-hook-bundle: codesign failed", error?.message || error)
  }

  const launcherSource = await readFile(launcherPath, "utf8")
  const needle = "    return path.join(pkgDir, binaryName);"
  const replacement = [
    "    if (process.platform === 'darwin') {",
    "        const bundledBinaryPath = path.join(pkgDir, 'NotifierHook.app', 'Contents', 'MacOS', binaryName);",
    "        try {",
    "            if (require('fs').existsSync(bundledBinaryPath)) {",
    "                return bundledBinaryPath;",
    "            }",
    "        } catch {",
    "            // Fall through to the package-local binary.",
    "        }",
    "    }",
    "    return path.join(pkgDir, binaryName);",
  ].join("\n")

  if (launcherSource.includes(replacement)) return
  if (!launcherSource.includes(needle)) {
    throw new Error("Could not find notifier-hook binary path return statement")
  }

  await writeFile(launcherPath, launcherSource.replace(needle, replacement))
}

main().catch((error) => {
  console.warn("setup-notifier-hook-bundle:", error)
  process.exitCode = 1
})
