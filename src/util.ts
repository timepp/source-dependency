import * as fs from 'https://deno.land/std/fs/mod.ts'
import * as path from 'https://deno.land/std/path/mod.ts'

export function regulateSlash (s: string) {
  return s.replace(/\\/g, '/')
}

export function listFilesRecursive (dir: string, includeFilters: RegExp[], excludeFilters: RegExp[]) {
  console.log('listFilesRecursive', dir, includeFilters, excludeFilters)
  return fs.walkSync(dir, { includeDirs: false, skip: excludeFilters, match: includeFilters.length > 0 ? includeFilters : undefined })
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
      if (!(key in o) || o[key] === null) {
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
  for (const key of Object.keys(hierarchy)) {
    if (myName !== undefined) {
      visitor(myName, key)
    }
    const child = hierarchy[key]
    if (child) {
      walkHierarchy(child, visitor, key)
    }
  }
}

export function stripExt (filename: string) {
  const ext = path.extname(filename)
  return ext.length === 0 ? filename : filename.slice(0, -ext.length)
}

export type ProgressCallback = (current: number, total: number) => void
export class ProgressMarker {
  private current = 0
  private total = 0
  private threshold = 0
  private significant = 0
  private callback?: ProgressCallback

  constructor (total: number, callback?: ProgressCallback, threshold?: number) {
    this.total = total
    this.callback = callback
    if (!threshold) this.threshold = Math.floor(this.total / 100)
  }

  advance (delta: number) {
    this.current += delta
    const significant = Math.floor(this.current / this.threshold)
    if (significant !== this.significant) {
      this.significant = significant
      if (this.callback) {
        this.callback(this.current, this.total)
      }
    }
  }
}
