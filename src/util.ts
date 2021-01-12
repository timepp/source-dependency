import * as fs from 'fs'
import * as path from 'path'

export function listFilesRecursive (dir: string, includeFilters: RegExp[], excludeFilters: RegExp[]) {
  const ret: string[] = []
  const walk = function (subDirs: string) {
    const entries = fs.readdirSync(path.join(dir, subDirs))
    for (const e of entries) {
      const f = path.join(subDirs, e)
      if (!applyFiltersToStr(f, includeFilters, excludeFilters)) continue
      const fullName = path.join(dir, f)
      if (fs.lstatSync(fullName).isFile()) {
        ret.push(f)
      } else {
        walk(f)
      }
    }
  }
  walk('')
  return ret
}

export function applyFiltersToStr (str: string, includeFilters: RegExp[], excludeFilters: RegExp[]) {
  if (includeFilters.length > 0) {
    if (!includeFilters.some(v => str.match(v) != null)) {
      return false
    }
  }
  if (excludeFilters.some(v => str.match(v) != null)) {
    return false
  }
  return true
}
