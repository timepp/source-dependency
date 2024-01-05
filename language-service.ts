import * as path from "https://deno.land/std@0.198.0/path/mod.ts"
// import xmldoc from 'xmldoc'
import * as util from './util.ts'
import { PathFilters, ParseContext, LanguageService, DependencyInfo } from './language-service-interface.ts'
import { NpmPackageService } from './language-service-npm.ts'

const rawLanguageService: LanguageService = {
  name: 'raw',
  exts: [],
  desc: 'raw dependency data',
  parse: function (context: ParseContext) {
    return JSON.parse(context.fileContent)
  }
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
    const matcher = /^\s*(import|export).*?\s+from\s+['"]([^'"]+)['"]\s*;?$/gms
    const deps: string[] = []
    while (true) {
      const r = matcher.exec(context.fileContent)
      if (r === null) break
      deps.push(r[2])
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
      moduleDependencies: { module: dependencies }
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
      moduleDependencies: { module: dependencies }
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
  parseSingleLine: parseCLikeLanguage
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
  CsharpLanguageService,
  NpmPackageService,
  rawLanguageService
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
    const pc = path.isAbsolute(cc) ? path.relative(parent, cc) : (cc.startsWith('/')? cc.slice(1) : joinPath(parent, cc))
    const result = files.find(f => {
      if (strictMatch) {
        return f === pc
      } else {
        return f === pc || f === cc || f.endsWith('/' + cc)
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

export function getLanguageExtensions(language: string) {
  return getLanguageService(language)?.exts
}

export type CallContext = {
  nameResolver: (name: string) => string|null
  progressCallback?: util.ProgressCallback
  // deno-lint-ignore no-explicit-any
  languageOption: any
  // deno-lint-ignore no-explicit-any
  debugOutput: (...data: any[]) => void
}

export function parse (dir: string, files: string[], language: string, scanAll: boolean, strictMatch: boolean, pathFilters: PathFilters, callContext: CallContext) {
  const ls = languageServiceRegistry.find(s => s.name === language)
  if (!ls) {
    throw Error(`unsupported language: ${language}`)
  }

  const data: DependencyInfo = {
    path2module: {},
    module2path: {},
    pathDependencies: {},
    moduleDependencies: {},
    moduleSeparator: ls.moduleSeparator || '/'
  }

  const context: ParseContext = {
    rootDir: dir,
    files: files,
    currentFile: '',
    fileContent: '',
    lineNumber: 0,
    line: '',
    pathFilters,
    nameResolver: callContext.nameResolver,
    languageOption: callContext.languageOption,
    debugOutput: callContext.debugOutput
  }

  callContext.debugOutput('context: ', context)

  const marker = new util.ProgressMarker(files.length, callContext.progressCallback)
  for (const f of files) {
    marker.advance(1)
    context.currentFile = f
    const pathDependencies = []
    let module = ''

    const parent = path.dirname(f)
    const ext = path.extname(f)
    if (!scanAll && ls.exts.length > 0 && ls.exts.indexOf(ext) < 0) {
      // not a recognizable source file
      continue
    }

    const fullName = dir + '/' + f
    const content = Deno.readTextFileSync(fullName)
    context.fileContent = content

    if (ls.parse) {
      const pr = ls.parse(context)
      // hacky: special handling of dep language service
      if (ls.name === 'raw') {
        return pr as unknown as DependencyInfo
      }
      if (pr.pathDependencies) pathDependencies.push(...pr.pathDependencies)
      if (pr.moduleDependencies) {
        for (const m of Object.keys(pr.moduleDependencies)) {
          if (m in data.moduleDependencies) {
            data.moduleDependencies[m].push(...pr.moduleDependencies[m])
          } else {
            data.moduleDependencies[m] = pr.moduleDependencies[m]
          }
        }
      }
      if (pr.module) module = pr.module
    } else if (ls.parseSingleLine) {
      const lines = content.split(/\r?\n/)
      for (let i = 0; i < lines.length; i++) {
        context.line = lines[i]
        context.lineNumber = i + 1
        const pr = ls.parseSingleLine(context)
        if (pr.pathDependencies) pathDependencies.push(...pr.pathDependencies)
        if (pr.moduleDependencies) data.moduleDependencies = { ...data.moduleDependencies, ...pr.moduleDependencies }
        if (pr.module) module = pr.module
      }
    }

    // resolve dependencies
    if (module) {
      data.path2module[f] = module
      data.module2path[module] = f
    }

    const resolvePathDependency = (d: string) => {
      const cd = cancelDot(d)
      const resolvedDir = callContext.nameResolver(cd)
      context.debugOutput('dir resolving: ', cd, ' => ', resolvedDir)
      const candidates = ls.getResolveCandidates ? ls.getResolveCandidates(resolvedDir || cd) : []
      return resolvePath(files, parent, [cd, ...candidates], strictMatch)
    }
    data.pathDependencies[f] = pathDependencies.map(d => {
      const d1 = resolvePathDependency(d)
      if (d1 !== null) return d1
      const dr = callContext.nameResolver(d)
      if (dr !== null) {
        const d2 = resolvePathDependency(dr)
        if (d2 !== null) return d2
      }
      return '*external*/' + d
    })
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

  return data
}
