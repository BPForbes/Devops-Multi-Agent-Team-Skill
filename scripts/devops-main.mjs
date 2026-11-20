import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Whether the module at `metaUrl` is the program node was started with. npm links a package's
 * bins (global installs, npx) as symlinks, so both sides are compared as real paths.
 */
export function isMain(metaUrl) {
  if (!process.argv[1]) return false
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(metaUrl))
  } catch {
    return false
  }
}
