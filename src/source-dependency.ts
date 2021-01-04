#!/usr/bin/env node

import glob from 'glob'
import * as fs from 'fs'
import yargs from 'yargs'
import xmldoc from 'xmldoc'
import * as path from 'path'

type DependencyData = {
  dependencies: [string, string][],
  contains: [string, string][]
}

main()

function main () {
  const argv = yargs(process.argv.slice(2))
    // .locale('en')
    .strict()
    .usage('Usage: $0 <target> [options]')
    .options({
      'filter-include': { type: 'string', describe: 'Name filter (regex) to be included' },
      'filter-exclude': { type: 'string', describe: 'Name filter (regex) to be excluded' },
      strip: { type: 'string', describe: 'Common prefix to be stripped to simplify the result' },
      l: { type: 'string', alias: 'language', describe: 'Source code language. Currently support java[default] and python.' },
      t: { type: 'string', alias: 'input-type', describe: 'Input type. one of: "AndroidStudio", "dir"' },
      of: { type: 'string', alias: 'output-format', describe: 'Output format. one of: "dot", "dgml", "js"' },
      'find-cycle': { type: 'boolean', describe: 'Find cycle dependencies' },
      leaf: { type: 'boolean', default: true, describe: 'Strip leaf (i.e. only keep package level dependencies)' }
    }).argv

  const languageInfo : { [id:string] : { sourceExt: string } } = {
    java: { sourceExt: 'java' },
    python: { sourceExt: 'py' }
  }

  // console.log(argv);
  if (argv._.length !== 1) {
    yargs.showHelp()
    return
  }

  const includeFilters = argv['filter-include'] ? [argv['filter-include']].flat().map(v => new RegExp(v, 'g')) : []
  const excludeFilters = argv['filter-exclude'] ? [argv['filter-exclude']].flat().map(v => new RegExp(v, 'g')) : []
  const prefix = argv.strip
  const language = argv.l ? argv.l : 'java'

  const data : DependencyData = {
    dependencies: [],
    contains: []
  }

  if (argv.t === 'AndroidStudio') {
    data.dependencies = generateFromASDA(argv._[0].toString())
  } else {
    const dir = path.resolve(argv._[0].toString())
    const files = glob.sync(`${dir}/**/*.${languageInfo[language].sourceExt}`)
    data.dependencies = analyzeDependencies(dir, files, language)
  }

  data.dependencies = applyFilters(data.dependencies, includeFilters, excludeFilters)
  data.dependencies = data.dependencies.map(v => [trimPrefix(v[0], prefix), trimPrefix(v[1], prefix)])

  if (!argv.leaf) {
    const deps : [string, string][] = data.dependencies.map(v => [parent(v[0]), parent(v[1])])
    data.dependencies = []
    for (const d of deps) {
      const found = data.dependencies.some(v => v[0] === d[0] && v[1] === d[1])
      if (!found) data.dependencies.push(d)
    }
  }

  data.contains = getContains(data.dependencies)

  if (argv['find-cycle']) {
    findCycleDependencies(data)
  } else {
    switch (argv.of) {
      case 'dgml': generateDGML(data); break
      case 'js': generateJS(data); break
      default: generateDependencies(data); break
    }
  }
}

function trimPrefix (s:string, prefix:string|undefined) {
  if (prefix && s.startsWith(prefix)) {
    return s.substr(prefix.length)
  }
  return s
}

function getContains (arr: [string, string][]) {
  const contains: [string, string][] = []
  const processed : { [id: string]: boolean } = {}

  const process = function (name: string) {
    while (!(name in processed)) {
      processed[name] = true
      const parentName = parent(name)
      if (parentName) {
        contains.push([parentName, name])
        name = parentName
      }
    }
  }

  for (const v of arr) {
    process(v[0])
    process(v[1])
  }
  return contains
}

function applyFilters (info: [string, string][], includeFilters: RegExp[], excludeFilters: RegExp[]) {
  return info.filter(v => applyFiltersToStr(v[0], includeFilters, excludeFilters) && applyFiltersToStr(v[1], includeFilters, excludeFilters))
}

function applyFiltersToStr (str: string, includeFilters: RegExp[], excludeFilters: RegExp[]) {
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

function generateDependencies (data: DependencyData) {
  for (const d of data.dependencies) {
    console.log(`${d[0]} -> ${d[1]}`)
  }
}

function parent (s: string) {
  const p = s.lastIndexOf('.')
  if (p >= 0) {
    return s.substr(0, p)
  }
  return ''
}

function generateDGML (data: DependencyData) {
  // node
  const nodes : { [id: string]: number } = {}
  const cnodes : { [id: string]: number } = {}

  const header = '<?xml version="1.0" encoding="utf-8"?>\n<DirectedGraph xmlns="http://schemas.microsoft.com/vs/2009/dgml">\n'
  const tail = '</DirectedGraph>'

  let linkstr = '<Links>\n'
  for (const l of data.contains) {
    linkstr += `  <Link Source="${l[0]}" Target="${l[1]}" Category="Contains" />\n`
    cnodes[l[0]] = 1
  }
  for (const l of data.dependencies) {
    linkstr += `  <Link Source="${l[0]}" Target="${l[1]}" />\n`
    nodes[l[0]] = 1
    nodes[l[1]] = 1
  }
  linkstr += '</Links>\n'

  let nodestr = '<Nodes>\n'
  for (const n in cnodes) {
    nodestr += `  <Node Id="${n}" Label="${n}" Group="Collapsed"/>\n`
  }
  for (const n in nodes) {
    nodestr += `  <Node Id="${n}" Label="${n}"/>\n`
  }
  nodestr += '</Nodes>\n'

  const dgml = header + nodestr + linkstr + tail
  console.log(dgml)
}

function generateJS (data: DependencyData) {
  console.log('const data = ' + JSON.stringify(data, null, 4) + ';')
}

function findCycleDependencies (data: DependencyData) {
  let deps = data.dependencies
  // 首先依次删除所有不依赖其他类的类, 直到删不动为止
  while (true) {
    const d = deps.filter(v => deps.findIndex(u => u[0] === v[1]) >= 0)
    if (d.length === deps.length) {
      break
    }
    deps = d
  }

  if (deps.length === 0) {
    console.log('没有循环依赖.')
    return
  }

  // 此时从一个类开始沿着依赖前进, 必有环
  const indexes = [0]
  while (true) {
    const lastIndex = indexes[indexes.length - 1]
    const i = deps.findIndex(v => v[0] === deps[lastIndex][1])
    indexes.push(i)
    const ii = indexes.findIndex(v => v === i)
    if (ii !== indexes.length - 1) {
      console.log('Circular Dependency:\n' + indexes.slice(ii).map(x => deps[x][0]).join(' -> '))
      break
    }
  }
}

function readFileByLines (file: string) {
  const data = fs.readFileSync(file, 'utf-8')
  return data.split(/\r?\n/)
}

function analyzeDependencies (dir: string, files: string[], language: string) {
  if (language === 'java') {
    return analyzeJavaDependencies(dir, files)
  } else {
    return analyzePythonDependencies(dir, files)
  }
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

function generateFromASDA (androidStudioDepFile: string) {
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
