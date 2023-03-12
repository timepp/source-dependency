import * as fs from 'fs'
import * as path from 'path'
// import xmldoc from 'xmldoc'
import * as util from './util.js'

type ParseContext = {
  rootDir: string,
  files: string[],
  currentFile: string,
  fileContent: string,
  lineNumber: number,
  line: string
}

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
  moduleHierarchy: util.RecursiveObject,
  moduleSeparator: string
}

interface LanguageService {
  name: string
  exts: string[]
  desc?: string
  moduleSeparator?: string
  parseSingleLine?(context: ParseContext): ParseResult
  parse?(context: ParseContext): ParseResult
  getResolveCandidates?(f: string) : string[]
}

const jsLanguageService: LanguageService = {
  name: 'javascript',
  desc: 'javascript',
  exts: ['.js', '.cjs', '.mjs', '.vue'],
  parseSingleLine: function (context: ParseContext) {
    const dependencies: string[] = []
    let r = context.line.match(/^\s*import\s+.*\s+from\s+['"]([^'"]+)['"]\s*;?$/)
    if (r) dependencies.push(r[1])
    r = context.line.match(/(require|import)\s*\(['"]([^'"]+)['"]\)/)
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

const tsLanguageService: LanguageService = {
  name: 'typescript',
  desc: 'typescript',
  exts: ['.ts', '.tsx'],
  parse: function (context: ParseContext) {
    const matcher = /^\s*import.*?\s+from\s+['"]([^'"]+)['"]\s*;?$/gms
    const deps: string[] = []
    while (true) {
      const r = matcher.exec(context.fileContent)
      if (r === null) break
      deps.push(r[1])
    }
    return { pathDependencies: deps }
  },
  getResolveCandidates: function (f: string) {
    const candidates = [
      ...this.exts.map(v => f + v),
      ...this.exts.map(v => f + '/index' + v)
    ]
    return candidates
  }
}

const CsharpLanguageService: LanguageService = {
  name: 'C#',
  exts: ['.cs'],
  moduleSeparator: '.',
  parseSingleLine: function (context: ParseContext) {
    const dependencies = []
    let module
    let r = context.line.match(/^\s*namespace\s+(.*)\s*$/)
    if (r) {
      module = r[1]
    }
    r = context.line.match(/^\s*using\s+([A-Za-z0-9.]+);$/)
    if (r) {
      dependencies.push(r[1])
    }
    return {
      module: module,
      moduleDependencies: dependencies
    }
  }
}

const javaLanguageService: LanguageService = {
  name: 'java',
  exts: ['.java'],
  moduleSeparator: '.',
  parseSingleLine: function (context: ParseContext) {
    const dependencies = []
    let module
    let r = context.line.match(/^package (.*);$/)
    if (r) {
      module = r[1] + '.' + path.parse(context.currentFile).name
    }
    r = context.line.match(/^import( static)? (.*);$/)
    if (r) {
      dependencies.push(r[2])
    }
    return {
      module: module,
      moduleDependencies: dependencies
    }
  }
}

function parseCLikeLanguage (context: ParseContext) {
  const dependencies = []
  let module
  let r = context.line.match(/^\s*#\s*include\s*<([^\s]+)>\s*$/)
  if (r) dependencies.push(r[1])
  r = context.line.match(/^\s*#\s*include\s*"([^\s]+)"\s*$/)
  if (r) dependencies.push(r[1])
  if (context.lineNumber === 1) {
    const base = util.stripExt(context.currentFile)
    if (context.files.find(f => f !== context.currentFile && util.stripExt(f) === base)) {
      module = base
    } else {
      module = context.currentFile
    }
  }
  return {
    module: module,
    pathDependencies: dependencies
  }
}

const CLanguageService = {
  name: 'C',
  exts: ['.c', '.h'],
  parse: parseCLikeLanguage
}

const CppLanguageService = {
  name: 'C++',
  exts: ['.c', '.cpp', '.h', '.hpp', '.cxx', '.cc', '.hh', '.m'],
  parse: parseCLikeLanguage
}

const PythonLanguageService: LanguageService = {
  name: 'python',
  exts: ['.py'],
  parseSingleLine: function (context: ParseContext) {
    const dependencies: string[] = []
    let r = context.line.match(/^\s*import\s+(.*)$/)
    if (r) {
      for (const x of r[1].split(/\s*,\s*/g)) {
        // `<module>` or `<module> as <alias>`
        dependencies.push(x.split(/\s+/g)[0])
      }
    }

    r = context.line.match(/\s*from\s+(.*)\s+import\s+.*$/)
    if (r) dependencies.push(r[1])

    r = context.line.match(/.*import_module\s*\(\s*('|")(.*)\1\s*\).*$/)
    if (r) dependencies.push(r[2])

    const deps = dependencies.map(v => v.replaceAll('.', '/') + '.py')

    return { pathDependencies: deps }
  }
}

const languageServiceRegistry: LanguageService[] = [
  jsLanguageService,
  tsLanguageService,
  javaLanguageService,
  CLanguageService,
  CppLanguageService,
  PythonLanguageService,
  CsharpLanguageService
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

function resolvePath (files: string[], parent: string, candidates: string[], strictMatch: boolean) {
  for (const c of candidates) {
    const cc = cancelDot(c)
    const pc = joinPath(parent, cc)
    const result = files.find(f => {
      if (strictMatch) {
        return f === pc
      } else {
        return f === cc || f.endsWith('/' + cc)
      }
    })
    if (result) {
      return result
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

export function getSupportedLanguages () {
  return languageServiceRegistry.map(v => v.name)
}

export function parse (dir: string, files: string[], language: string, scanAll: boolean, strictMatch: boolean, progressCallback?: util.ProgressCallback) {
  const ls = languageServiceRegistry.find(s => s.name === language)
  if (!ls) {
    throw Error(`unsupported language: ${language}`)
  }

  const data: DependencyInfo = {
    path2module: {},
    module2path: {},
    pathDependencies: {},
    moduleDependencies: {},
    pathHierarchy: {},
    moduleHierarchy: {},
    moduleSeparator: ls.moduleSeparator || '/'
  }

  const context: ParseContext = {
    rootDir: dir,
    files: files,
    currentFile: '',
    fileContent: '',
    lineNumber: 0,
    line: ''
  }

  const marker = new util.ProgressMarker(files.length, progressCallback)
  for (const f of files) {
    marker.advance(1)
    context.currentFile = f
    const pathDependencies = []
    const moduleDependencies = []
    let module = ''

    const parent = path.dirname(f)
    const ext = path.extname(f)
    if (!scanAll && ls.exts.indexOf(ext) < 0) {
      // not a recognizable source file
      continue
    }

    const fullName = dir + '/' + f
    const content = fs.readFileSync(fullName, 'utf-8')
    context.fileContent = content

    if (ls.parse) {
      const pr = ls.parse(context)
      if (pr.pathDependencies) pathDependencies.push(...pr.pathDependencies)
      if (pr.moduleDependencies) moduleDependencies.push(...pr.moduleDependencies)
      if (pr.module) module = pr.module
    } else if (ls.parseSingleLine) {
      const lines = content.split(/\r?\n/)
      for (let i = 0; i < lines.length; i++) {
        context.line = lines[i]
        context.lineNumber = i + 1
        const pr = ls.parseSingleLine(context)
        if (pr.pathDependencies) pathDependencies.push(...pr.pathDependencies)
        if (pr.moduleDependencies) moduleDependencies.push(...pr.moduleDependencies)
        if (pr.module) module = pr.module
      }
    }

    // resolve dependencies
    if (module) {
      data.path2module[f] = module
      data.module2path[module] = f
    }

    data.pathDependencies[f] = pathDependencies.map(d => {
      const cd = cancelDot(d)
      const candidates = ls.getResolveCandidates ? ls.getResolveCandidates(cd) : []
      return resolvePath(files, parent, [cd, ...candidates], strictMatch) || '*external*/' + d
    })
    if (module) {
      data.moduleDependencies[module] = moduleDependencies
    }
  }

  // path dependencies can be built from module dependencies (if any)
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

  // module dependencies can be built from path dependencies
  for (const p of Object.keys(data.pathDependencies)) {
    const m = data.path2module[p]
    if (m) {
      const modules = data.pathDependencies[p].map(v => data.path2module[v] || v)
      if (modules.length > 0) {
        if (m in data.moduleDependencies) {
          data.moduleDependencies[m].push(...modules)
        } else {
          data.moduleDependencies[m] = modules
        }
      }
    }
  }

  for (const f of Object.keys(data.pathDependencies)) {
    data.pathDependencies[f] = [...new Set(data.pathDependencies[f])]
    util.buildHierarchy([f, ...data.pathDependencies[f]], '/', data.pathHierarchy)
  }

  for (const m of Object.keys(data.moduleDependencies)) {
    const depset = new Set(data.moduleDependencies[m])
    depset.delete(m)
    data.moduleDependencies[m] = [...depset]
    util.buildHierarchy([m, ...data.moduleDependencies[m]], ls.moduleSeparator || '/', data.moduleHierarchy)
  }

  return data
}
