import * as fs from 'fs'
import * as path from 'path'

type LanguageService = {
    name: string,
    exts: string[],
    parse: (dir: string, files: string[]) => [string, string][]
}

export function getAvailableLanguages () : LanguageService[] {
  return [
    {
      name: 'java',
      exts: ['java'],
      parse: analyzeJavaDependencies
    }
  ]
}

function analyzeJavaDependencies (dir: string, files: string[]) {
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

function analyzePythonDependencies (dir: string, files: string[]) {
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

function readFileByLines (file: string) {
  const data = fs.readFileSync(file, 'utf-8')
  return data.split(/\r?\n/)
}

