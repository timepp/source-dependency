import * as fs from 'fs'
import * as path from 'path'
import xmldoc from 'xmldoc'

interface LanguageService {
  name() : string
  desc() : string
  exts() : string[]
  parse(dir:string, files: string[]) : [string, string][]
}

class JavaLanguageService implements LanguageService {
  name () { return 'java' }
  desc () { return 'treat all import statements as dependencies, direct references without import is not counted' }
  exts () { return ['java'] }
  parse (dir: string, files: string[]) {
    const data : [string, string][][] = []
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
      data.push(deps.map(v => [fullName, v]))
    }

    return data.flat()
  }
}

class PythonLanguageService implements LanguageService {
  name () { return 'python' }
  desc () { return 'treat all import statements as dependencies' }
  exts () { return ['py'] }
  parse (dir: string, files: string[]) {
    const fileNameToModuleName = function (f: string) {
      return path.relative(dir, f).replace(/\.py$/, '').replace(/\\|\//g, '.')
    }

    const selfModules = files.map(fileNameToModuleName)
    const data : [string, string][][] = []
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
      data.push(deps.map(v => [moduleName, v]))
    }

    return data.flat()
  }
}

class AsdLanguageService implements LanguageService {
  name () { return 'asd' }
  desc () { return 'Android Studio dependency analyzer export format. 100% accurate for Android project' }
  exts () { return ['xml'] }
  parse (dir: string, files: string[]) {
    if (files.length === 1) {
      return parseAndroidStudioDepFile(files[0])
    }
    throw Error
  }
}

class CLanguageService implements LanguageService {
  name () { return 'c' }
  desc () { return 'Analyze #include directives' }
  exts () { return ['c', 'cpp', 'cxx', 'hpp', 'h', 'cc'] }
  parse (dir: string, files: string[]) {
    const fileNameToModuleName = function (f: string) {
      return path.relative(dir, f).replace(/\.[^.]+$/, '').replace(/\\|\//g, '.')
    }

    const selfModules = files.map(fileNameToModuleName)
    const data : [string, string][][] = []
    for (const f of files) {
      const moduleName = fileNameToModuleName(f)
      const packageName = moduleName.split('.').slice(0, -1).join('.')
      const deps : string[] = []
      const lines = readFileByLines(f)
      for (const l of lines) {
        let dependent = ''
        let r = l.match(/^\s*#\s*include\s*<([^\s]+)>\s*$/)
        if (r) dependent = r[1]

        r = l.match(/^\s*#\s*include\s*"([^\s]+)"\s*$/)
        if (r) dependent = r[1]

        if (dependent !== '') {
          dependent = dependent.split('.').slice(0, -1).join('.')
          const fullName = packageName === '' ? dependent : packageName + '.' + dependent
          if (selfModules.indexOf(fullName) >= 0) {
            if (moduleName !== fullName) deps.push(fullName)
          } else {
            deps.push('lib.' + dependent)
          }
        }
      }
      data.push(deps.map(v => [moduleName, v]))
    }

    return data.flat()
  }
}

const languageServiceRegistry : LanguageService[] = [
  new JavaLanguageService(),
  new PythonLanguageService(),
  new AsdLanguageService(),
  new CLanguageService()
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

  const deps : [string, string][] = []
  const content = fs.readFileSync(androidStudioDepFile, 'utf-8')
  const doc = new xmldoc.XmlDocument(content)
  for (const c of doc.children) {
    if (c instanceof xmldoc.XmlElement && c.name === 'file') {
      const c1 = getClass(c.attr.path)
      if (c1 && c.children) {
        for (const d of c.children) {
          if (d instanceof xmldoc.XmlElement && d.name === 'dependency') {
            const c2 = getClass(d.attr.path)
            if (c2) {
              deps.push([c1, c2])
            }
          }
        }
      }
    }
  }

  return deps
}

function readFileByLines (file: string) {
  const data = fs.readFileSync(file, 'utf-8')
  return data.split(/\r?\n/)
}

export function getLanguageService (name: string) {
  return languageServiceRegistry.find(s => s.name() === name)
}

export function getLanguageSummary () {
  return languageServiceRegistry
    .map(v => v.name() + '  ' + v.desc())
    .join('\n')
}
