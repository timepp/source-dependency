import * as fs from 'fs'
import * as path from 'path'
// import xmldoc from 'xmldoc'
import * as util from './util.js'

type ParseResult = {
  module?: string,
  pathDependencies?: string[]
  moduleDependencies?: string[]
}

export type DependencyInfo = {
  path2module: { [id: string]: string }
  module2path: { [id: string]: string }
  pathDependencies: { [id: string]: string[] }
  moduleDependencies: { [id: string]: string[] }
  pathHierarchy: util.RecursiveObject,
  moduleHierarchy: util.RecursiveObject
}

interface LanguageService {
  name: string
  exts: string[]
  desc?: string
  moduleSeparator?: string
  parse(dir: string, files: string[], f: string, fileContent: string, lineNumber: number, line: string): ParseResult
  getResolveCandidates?(f: string) : string[]
}

const jsLanguageService: LanguageService = {
  name: 'javascript',
  desc: 'javascript',
  exts: ['.js', '.cjs', '.mjs', '.vue'],
  parse: function (rootDir: string, files: string[], f: string, fileContent: string, lineNumber: number, line: string) {
    const dependencies: string[] = []
    let r = line.match(/^\s*import\s+.*\s+from\s+['"]([^'"]+)['"]\s*;?$/)
    if (r) dependencies.push(r[1])
    r = line.match(/(require|import)\s*\(['"]([^'"]+)['"]\)/)
    if (r) dependencies.push(r[2])
    return { pathDependencies: dependencies }
  },
  getResolveCandidates: function (f: string) {
    const candidates = [
      ...this.exts.map(v => f + v),
      ...this.exts.map(v => f + '/index' + v)
    ]
    return candidates
  }
}

const javaLanguageService: LanguageService = {
  name: 'java',
  exts: ['.java'],
  parse: function (dir: string, files: string[], f: string, fileContent: string, lineNumber: number, line: string) {
    const dependencies = []
    let module
    let r = line.match(/^package (.*);$/)
    if (r) {
      module = r[1] + '.' + path.parse(f).name
    }
    r = line.match(/^import( static)? (.*);$/)
    if (r) {
      dependencies.push(r[2])
    }
    return {
      module: module,
      moduleDependencies: dependencies
    }
  }
}

const languageServiceRegistry: LanguageService[] = [
  jsLanguageService,
  javaLanguageService
]

/**
 * cancelDot('a/b/c/../../e/./f') => 'a/e/f'
 */
function cancelDot (s: string) {
  const components = s.split('/')
  const r = []
  for (const c of components) {
    if (c === '.') {
      // ignore
    } else if (c === '..') {
      r.pop()
    } else {
      r.push(c)
    }
  }
  return r.join('/')
}

function resolvePath (files: string[], candidates: string[]) {
  for (const c of candidates) {
    const f = cancelDot(c)
    if (files.indexOf(f) >= 0) {
      return f
    }
  }
  return null
}

/// equivalent to path.join, but only use '/'
function joinPath (a: string, b: string) {
  return a === '' ? b : a + '/' + b
}

export function getLanguageService (name: string) {
  return languageServiceRegistry.find(s => s.name === name)
}

export function getLanguageSummary () {
  const maxLanguageNameLength = Math.max(...languageServiceRegistry.map(v => v.name.length))
  return languageServiceRegistry
    .map(v => v.name.padEnd(maxLanguageNameLength) + '  ' + v.desc)
    .join('\n')
}

export function parse (dir: string, files: string[], language?: string) {
  const data: DependencyInfo = {
    path2module: {},
    module2path: {},
    pathDependencies: {},
    moduleDependencies: {},
    pathHierarchy: {},
    moduleHierarchy: {}
  }

  for (const f of files) {
    const pathDependencies = []
    const moduleDependencies = []
    let module = ''
    const parent = path.dirname(f)
    const ext = path.extname(f)
    const ls = language
      ? languageServiceRegistry.find(s => s.name === language)
      : languageServiceRegistry.find(s => s.exts.indexOf(ext) >= 0)
    if (ls === undefined) {
      // not a recognizable source file
      continue
    }

    const fullName = dir + '/' + f
    const content = fs.readFileSync(fullName, 'utf-8')
    const lines = content.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const info = ls.parse(dir, files, f, content, i + 1, lines[i])
      if (info.pathDependencies) {
        for (const d of info.pathDependencies) {
          const basename = joinPath(parent, cancelDot(d))
          const candidates = ls.getResolveCandidates ? ls.getResolveCandidates(basename) : []
          const resolvedPath = resolvePath(files, [basename, ...candidates]) || '*external*/' + d
          pathDependencies.push(resolvedPath)
        }
      }
      if (info.moduleDependencies) {
        moduleDependencies.push(...info.moduleDependencies)
        util.buildHierarchy(info.moduleDependencies, ls.moduleSeparator || '/', data.moduleHierarchy)
      }
      // resolve dependencies
      if (info.module) {
        module = info.module
        data.path2module[f] = info.module
        data.module2path[info.module] = f
      }
    }

    data.pathDependencies[f] = pathDependencies
    data.moduleDependencies[module] = moduleDependencies
  }

  // file dependencies can be built from module dependencies (if any)
  for (const d of Object.keys(data.moduleDependencies)) {
    const f = data.module2path[d]
    if (f) {
      const paths = data.moduleDependencies[d].map(v => data.module2path[v] || '*external*/*modules*/' + v)
      if (paths.length > 0) {
        if (f in data.pathDependencies) {
          data.pathDependencies[f].push(...paths)
        } else {
          data.pathDependencies[f] = paths
        }
      }
    }
  }

  for (const f of Object.keys(data.pathDependencies)) {
    data.pathDependencies[f] = [...new Set(data.pathDependencies[f])]
    util.buildHierarchy([f, ...data.pathDependencies[f]], '/', data.pathHierarchy)
  }

  return data
}
