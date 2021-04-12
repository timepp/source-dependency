import * as fs from 'fs'
import * as path from 'path'

export function regulateSlash (s: string) {
  return s.replace(/\\/g, '/')
}

export function listFilesRecursive (dir: string, includeFilters: RegExp[], excludeFilters: RegExp[]) {
  const ret: string[] = []
  const walk = function (subDirs: string) {
    const entries = fs.readdirSync(path.join(dir, subDirs))
    for (const e of entries) {
      const f = path.join(subDirs, e)
      const name = regulateSlash(f)
      if (!applyFiltersToStr(name, includeFilters, excludeFilters)) continue
      const fullName = path.join(dir, f)
      const stat = fs.lstatSync(fullName)
      if (stat.isFile()) {
        ret.push(name)
      } else if (stat.isDirectory()) {
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

export type RecursiveObject = {
  [key: string]: RecursiveObject | null
}

export function buildHierarchy (arr: string[], separator: string, hierarchy: RecursiveObject = {}) {
  for (const s of arr) {
    const parts = s.split(separator)
    let o = hierarchy
    for (let i = 0; i < parts.length; i++) {
      const key = parts.slice(0, i + 1).join(separator)
      if (!(key in o)) {
        if (i === parts.length - 1) {
          o[key] = null
        } else {
          const subObject: RecursiveObject = {}
          o[key] = subObject
        }
      }
      const subObject = o[key]
      if (subObject === null) break
      o = subObject
    }
  }
  return hierarchy
}

export function walkHierarchy (hierarchy: RecursiveObject, visitor: (parent: string, child: string) => void, myName?: string) {
  for (const key in Object.keys(hierarchy)) {
    if (myName !== undefined) {
      visitor(myName, key)
      const child = hierarchy[key]
      if (child) {
        walkHierarchy(child, visitor, key)
      }
    }
  }
}
