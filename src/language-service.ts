import * as fs from 'fs'
import * as path from 'path'
import xmldoc from 'xmldoc'

export type Dependencies = {
  [id: string] : string[]
}

interface LanguageService {
  name() : string
  desc() : string
  exts() : string[]
  moduleSeparator() : string
  parse(dir:string, files: string[]) : Dependencies
}

class JavaLanguageService implements LanguageService {
  name () { return 'java' }
  desc () { return 'java language. direct references are not supported' }
  exts () { return ['java'] }
  moduleSeparator () { return '.' }
  parse (dir: string, files: string[]) {
    const data : Dependencies = {}
    for (const file of files) {
      let packageName = ''
      let name = ''
      const deps : string[] = []

      let r = file.match(/\/([^/]+)\.java/)
      if (r) {
        name = r[1]
      }

      const lines = readFileByLines(file)
      for (const l of lines) {
        r = l.match(/^package (.*);$/)
        if (r) {
          packageName = r[1]
        }

        r = l.match(/^import( static)? (.*);$/)
        if (r) {
          deps.push(r[2])
        }
      }

      const fullName = packageName + '.' + name
      data[fullName] = deps
    }

    return data
  }
}

class PythonLanguageService implements LanguageService {
  name () { return 'python' }
  desc () { return 'python language' }
  exts () { return ['py'] }
  moduleSeparator () { return '.' }
  parse (dir: string, files: string[]) {
    const fileNameToModuleName = function (f: string) {
      return path.relative(dir, f).replace(/\.py$/, '').replace(/\\|\//g, '.')
    }

    const selfModules = files.map(fileNameToModuleName)
    const data : Dependencies = {}
    for (const f of files) {
      const moduleName = fileNameToModuleName(f)
      const packageName = moduleName.split('.').slice(0, -1).join('.')
      const deps : string[] = []
      const lines = readFileByLines(f)
      for (const l of lines) {
        let dependent = ''
        let r = l.match(/^\s*import\s+([^\s]+)\s*$/)
        if (r) dependent = r[1]

        r = l.match(/^\s*from\s+([^\s]+)\s+import.*$/)
        if (r) dependent = r[1]

        r = l.match(/^\s*import\s+([^\s]+)\s+as.*$/)
        if (r) dependent = r[1]

        if (dependent !== '') {
          const fullName = packageName === '' ? dependent : packageName + '.' + dependent
          if (selfModules.indexOf(fullName) >= 0) {
            deps.push(fullName)
          } else {
            deps.push('lib.' + dependent)
          }
        }
      }
      data[moduleName] = deps
    }

    return data
  }
}

class AsdLanguageService implements LanguageService {
  name () { return 'asd' }
  desc () { return 'Android Studio dependency analyzer export format' }
  exts () { return ['xml'] }
  moduleSeparator () { return '.' }
  parse (dir: string, files: string[]) {
    if (files.length === 1) {
      return parseAndroidStudioDepFile(files[0])
    }
    throw Error
  }
}

class CLanguageService implements LanguageService {
  name () { return 'c' }
  desc () { return 'c / c++' }
  exts () { return ['c', 'cpp', 'cxx', 'hpp', 'h', 'cc'] }
  moduleSeparator () { return '/' }
  parse (dir: string, files: string[]) {
    const fileNameToModuleName = function (f: string) {
      return path.relative(dir, f).replace(/\.[^.]+$/, '').replace(/\\|\//g, '/')
    }

    const selfModules = files.map(fileNameToModuleName)
    const data : Dependencies = {}
    for (const f of files) {
      const moduleName = fileNameToModuleName(f)
      const packageName = parent(moduleName, '/')
      const deps : string[] = []
      const lines = readFileByLines(f)
      for (const l of lines) {
        let dependent = ''
        let r = l.match(/^\s*#\s*include\s*<([^\s]+)>\s*$/)
        if (r) dependent = r[1]

        r = l.match(/^\s*#\s*include\s*"([^\s]+)"\s*$/)
        if (r) dependent = r[1]

        if (dependent !== '') {
          dependent = stripExtension(dependent)
          const fullName = cancelDot(packageName === '' ? dependent : packageName + '/' + dependent)
          if (selfModules.indexOf(fullName) >= 0) {
            if (moduleName !== fullName) deps.push(fullName)
          } else {
            deps.push('lib/' + dependent)
          }
        }
      }
      data[moduleName] = deps
    }

    return data
  }
}

class JavascriptLanguageService implements LanguageService {
  name () { return 'javascript' }
  desc () { return 'javascript language. supports `import` and `require`' }
  exts () { return ['js', 'ts', 'mjs', 'cjs', 'vue'] }
  moduleSeparator () { return '/' }
  parse (dir: string, files: string[]) {
    // TODO: "stripExtension" should only strip some known extensions
    const data : Dependencies = {}
    const moduleFiles = files.filter(f => this.exts().indexOf(path.extname(f).slice(1)) >= 0)
    for (const f of moduleFiles) {
      const packageName = path.dirname(f)
      const deps : string[] = []
      const lines = readFileByLines(dir + '/' + f)
      for (const l of lines) {
        let dependent = ''
        let r = l.match(/^\s*import\s+.*\s+from\s+['"]([^'"]+)['"]\s*;?$/)
        if (r) dependent = r[1]

        r = l.match(/(require|import)\s*\(['"]([^'"]+)['"]\)/)
        if (r) dependent = r[2]

        if (dependent !== '') {
          let fullName = cancelDot(packageName === '' ? dependent : packageName + '/' + dependent)
          // TODO: respect webpack alias in config
          if (dependent.startsWith('@/')) {
            fullName = 'src' + dependent.slice(1)
          }

          let resolvedDependent = null
          if (files.indexOf(fullName) >= 0) {
            resolvedDependent = fullName
          }

          if (!resolvedDependent) {
            for (const ext of this.exts()) {
              const testName1 = fullName + '.' + ext
              if (files.indexOf(testName1) >= 0) {
                resolvedDependent = testName1
                break
              }
              const testName2 = joinPath(fullName, 'index.' + ext)
              if (files.indexOf(testName2) >= 0) {
                resolvedDependent = testName2
                break
              }
            }
          }

          if (!resolvedDependent) {
            resolvedDependent = dependent
          }

          deps.push(resolvedDependent)
        }
      }
      data[f] = [...new Set(deps)]
    }

    return data
  }
}

const languageServiceRegistry : LanguageService[] = [
  new JavaLanguageService(),
  new PythonLanguageService(),
  new AsdLanguageService(),
  new CLanguageService(),
  new JavascriptLanguageService()
]

function parseAndroidStudioDepFile (androidStudioDepFile: string) {
  const getClass = function (v: string) {
    const m1 = v.match(/\.jar!\/(.*)\.(class|java)$/)
    if (m1) {
      return m1[1].replace(/\//g, '.')
    }
    const m2 = v.match(/\/com\/(.*)\.java$/)
    if (m2) {
      return m2[1].replace(/\//g, '.')
    }
    return null
  }

  const data : Dependencies = {}
  const content = fs.readFileSync(androidStudioDepFile, 'utf-8')
  const doc = new xmldoc.XmlDocument(content)
  for (const c of doc.children) {
    if (c instanceof xmldoc.XmlElement && c.name === 'file') {
      const c1 = getClass(c.attr.path)
      if (c1 && c.children) {
        const deps = []
        for (const d of c.children) {
          if (d instanceof xmldoc.XmlElement && d.name === 'dependency') {
            const c2 = getClass(d.attr.path)
            if (c2) {
              deps.push(c2)
            }
          }
        }
        data[c1] = deps
      }
    }
  }

  return data
}

function readFileByLines (file: string) {
  const data = fs.readFileSync(file, 'utf-8')
  return data.split(/\r?\n/)
}

function parent (s: string, sp: string = '.') {
  const p = s.lastIndexOf(sp)
  if (p >= 0) {
    return s.substr(0, p)
  }
  return ''
}

function stripExtension (s: string) {
  return s.replace(/[.][a-zA-Z0-9]+$/, '')
}

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

/// equivalent to path.join, but only use '/'
function joinPath (a: string, b: string) {
  return a === '' ? b : a + '/' + b
}

export function getLanguageService (name: string) {
  return languageServiceRegistry.find(s => s.name() === name)
}

export function getLanguageSummary () {
  const maxLanguageNameLength = Math.max(...languageServiceRegistry.map(v => v.name().length))
  return languageServiceRegistry
    .map(v => v.name().padEnd(maxLanguageNameLength) + '  ' + v.desc())
    .join('\n')
}
