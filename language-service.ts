import * as path from "https://deno.land/std@0.198.0/path/mod.ts"
// import xmldoc from 'xmldoc'
import * as util from './util.ts'
import { PathFilters, ParseContext, LanguageService, Dependencies } from './language-service-interface.ts'
import { NpmPackageService } from './language-service-npm.ts'

function matchExt(context: ParseContext, exts: string[]) {
  return exts.indexOf(context.ext) >= 0
}

function matchAll(s: string, pattern: RegExp) {
  if (!pattern.global) throw Error('pattern must be global')
  const result = []
  while (true) {
    const r = pattern.exec(s)
    if (r === null) break
    result.push(r)
  }
  return result
}

class TsLanguageService implements LanguageService {
  name = 'typescript'
  exts = ['.ts', '.tsx']
  parse (context: ParseContext) {
    if (!matchExt(context, this.exts)) return {}
    const matcher = /^\s*(import|export).*?\s+from\s+['"]([^'"]+)['"]\s*;?$/gms
    const deps = matchAll(context.fileContent(), matcher).map(v => v[2])
    return {[context.file]: deps}
  }
  getResolveCandidates (f: string) {
    const candidates = [
      ...this.exts.map(v => f + v),
      ...this.exts.map(v => f + '/index' + v)
    ]
    return candidates
  }
}

class JsLanguageService extends TsLanguageService {
  name = 'javascript'
  exts = ['.js', '.cjs', '.mjs', '.vue']
}

/*
const CsharpLanguageService: LanguageService = {
  name: 'C#',
  exts: ['.cs'],
  moduleSeparator: '.',
  parseSingleLine: function (context: ParseContext) {
    const dependencies = []
    let module = context.file
    let r = context.line.match(/^\s*namespace\s+(.*)\s*$/)
    if (r) {
      module = r[1]
    }
    r = context.line.match(/^\s*using\s+([A-Za-z0-9.]+);$/)
    if (r) {
      dependencies.push(r[1])
    }
    return {[module]: dependencies}
  }
}

const javaLanguageService: LanguageService = {
  name: 'java',
  exts: ['.java'],
  moduleSeparator: '.',
  parseSingleLine: function (context: ParseContext) {
    const dependencies = []
    let module = context.file
    let r = context.line.match(/^package (.*);$/)
    if (r) {
      module = r[1] + '.' + path.parse(context.file).name
    }
    r = context.line.match(/^import( static)? (.*);$/)
    if (r) {
      dependencies.push(r[2])
    }
    return {[module]: dependencies}
  }
}
*/

class CLanguageService implements LanguageService {
  name = 'C'
  exts = ['.c', '.h', '.cpp', '.hpp', '.cxx', '.cc', '.hh', '.m']
  parse (context: ParseContext) {
    if (!matchExt(context, this.exts)) return {}
    const dependencies = []
    // brackets
    {
      const mBracket = /^\s*#\s*include\s*<([^\s]+)>\s*$/gms
      const deps = matchAll(context.fileContent(), mBracket).map(v => v[1])
      dependencies.push(...deps)
    }
    // quotes
    {
      const mQuote = /^\s*#\s*include\s*"([^\s]+)"\s*$/gms
      const deps = matchAll(context.fileContent(), mQuote).map(v => v[1])
      const resolvedDeps = deps.map(v => {
        const subDir = path.dirname(context.file)
        const includePath = subDir + '/' + v
        if (context.files.indexOf(includePath) >= 0) {
          return includePath
        } else {
          return v
        }
      })
      dependencies.push(...resolvedDeps)
    }
    
    return {[context.file]: dependencies}
  }
}

/*
const PythonLanguageService: LanguageService = {
  name: 'python',
  exts: ['.py'],
  parseSingleLine: function (context: ParseContext) {
    const dependencies: string[] = []
    let r = context.line.match(/^\s*import\s+(.*)$/)
    if (r) {
      for (const x of r[1].split(/\s*,\s* /g)) {
        // <module> or <module> as <alias>
        dependencies.push(x.split(/\s+/g)[0])
      }
    }

    r = context.line.match(/\s*from\s+(.*)\s+import\s+.*$/)
    if (r) dependencies.push(r[1])

    r = context.line.match(/.*import_module\s*\(\s*('|")(.*)\1\s*\).*$/)
    if (r) dependencies.push(r[2])

    const deps = dependencies.map(v => v.replaceAll('.', '/') + '.py')
    return {[context.file]: deps}
  }
}
*/

const languageServiceRegistry: LanguageService[] = [
  new JsLanguageService(),
  new TsLanguageService(),
  // javaLanguageService,
  new CLanguageService(),
  // CppLanguageService,
  // PythonLanguageService,
  // CsharpLanguageService,
  NpmPackageService,
  // new RawLanguageService(),
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
  const ls = languageServiceRegistry.find(s => s.name === name)
  if (!ls) {
    throw Error(`unsupported language: ${name}`)
  }
  return ls
}

export function getSupportedLanguages () {
  return languageServiceRegistry.map(v => v.name)
}

export type CallContext = {
  nameResolver: (name: string) => string|null
  progressCallback?: util.ProgressCallback
  // deno-lint-ignore no-explicit-any
  languageOption: any
  // deno-lint-ignore no-explicit-any
  debugOutput: (...data: any[]) => void
}

export function mergeDependencies (d1: Dependencies, d2: Dependencies) {
  const result: Dependencies = {}
  for (const k in d1) {
    result[k] = [...d1[k]]
  }
  for (const k in d2) {
    if (k in result) {
      result[k].push(...d2[k])
    } else {
      result[k] = [...d2[k]]
    }
  }
  return result
}

export function parse (dir: string, files: string[], language: string, strictMatch: boolean, pathFilters: PathFilters, callContext: CallContext) {
  let data: Dependencies = {}
  const context: ParseContext = {
    rootDir: dir,
    files: files,
    file: '',
    subDir: '',
    ext: '',
    fileName: '',
    _privateFileContent: '',
    fileContent: function() {
      if (this._privateFileContent === '') {
        this._privateFileContent = Deno.readTextFileSync(this.rootDir + '/' + this.file)
      }
      return this._privateFileContent
    },
    lines: function() {
      return this.fileContent().split(/\r?\n/)
    },
    pathFilters,
    nameResolver: callContext.nameResolver,
    languageOption: callContext.languageOption,
    debugOutput: callContext.debugOutput
  }

  const resolvePathDependency = (d: string, ls: LanguageService) => {
    const cd = cancelDot(d)
    const resolvedDir = callContext.nameResolver(cd)
    context.debugOutput('dir resolving: ', cd, ' => ', resolvedDir)
    const candidates = ls.getResolveCandidates ? ls.getResolveCandidates(resolvedDir || cd) : []
    return resolvePath(files, context.subDir, [cd, ...candidates], strictMatch)
  }

  callContext.debugOutput('context: ', context)

  const marker = new util.ProgressMarker(files.length, callContext.progressCallback, 100)
  for (const f of files) {
    marker.advance(1)
    context.file = f
    context.subDir = path.dirname(f)
    context.ext = path.extname(f)
    context.fileName = path.basename(f)
    context._privateFileContent = ''

    for (const ls of languageServiceRegistry) {
      if (language && language !== 'all' && ls.name !== language) continue
      const result = ls.parse(context)
      callContext.debugOutput(`${f} ${ls.name}: ${Object.keys(result).length}, ${Object.values(result).flat().length}}`)
      for (const k in result) {
        const deps = result[k]
        result[k] = deps.map(v => {
          const d1 = resolvePathDependency(v, ls)
          if (d1 !== null) return d1
          const dr = callContext.nameResolver(v)
          if (dr !== null) {
            const d2 = resolvePathDependency(dr, ls)
            if (d2 !== null) return d2
          }
          return v
        })
      }
      data = mergeDependencies(data, result)
    }
  }

  context.debugOutput('data: ', data)
  return data
}
