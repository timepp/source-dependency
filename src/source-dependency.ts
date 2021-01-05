#!/usr/bin/env node

import glob from 'glob'
import * as fs from 'fs'
import yargs from 'yargs'
import * as path from 'path'
import * as ls from './language-service.js'

type DependencyData = {
  dependencies: [string, string][],
  contains: [string, string][]
}

main()

function main () {
  const args = yargs(process.argv.slice(2))
  const argv = args
    .locale('en')
    .strict()
    .usage('Usage: $0 <target> [options]')
    .epilog('Supported languages: \n\n' + ls.getLanguageSummary())
    .options({
      check: { type: 'boolean', describe: 'check suspicious dependencies such as circles' },
      noleaf: { type: 'boolean', describe: 'Strip leaf (only keep package level dependencies)' },
      include: { type: 'string', describe: 'Name filter (regex) to be included' },
      exclude: { type: 'string', describe: 'Name filter (regex) to be excluded' },
      strip: { type: 'string', describe: 'Common prefix to be stripped to simplify the result' },
      l: { type: 'string', alias: 'language', describe: 'Source code language' },
      f: { type: 'string', alias: 'format', describe: 'Output format. one of: "dot", "dgml", "js"' }
    }).argv

  // console.log(argv);
  if (argv._.length === 0) {
    args.showHelp()
    return
  } else if (argv._.length > 1) {
    console.error('too many targets: only 1 target is supported')
    return
  }

  const target = path.resolve(argv._[0].toString())
  if (!fs.existsSync(target)) {
    console.error(`file not exist: ${target}`)
    return
  }

  const includeFilters = argv.include ? [argv.include].flat().map(v => new RegExp(v, 'g')) : []
  const excludeFilters = argv.exclude ? [argv.exclude].flat().map(v => new RegExp(v, 'g')) : []
  const prefix = argv.strip

  const lang = ls.getLanguageService(argv.l || 'java')
  if (!lang) {
    console.error(`unsupported language: ${argv.l}`)
    return
  }

  const data : DependencyData = {
    dependencies: [],
    contains: []
  }

  if (fs.lstatSync(target).isFile()) {
    data.dependencies = lang.parse(path.dirname(target), [target])
  } else {
    const dir = target
    // to fix glob bug that brace set must contain multiple elements (https://github.com/isaacs/node-glob/issues/383)
    const extPattern = lang.exts().length === 1 ? lang.exts()[0] : `{${lang.exts().join(',')}}`
    const pattern = `${dir}/**/*.${extPattern}`
    const files = glob.sync(pattern)
    data.dependencies = lang.parse(dir, files)
  }

  data.dependencies = applyFilters(data.dependencies, includeFilters, excludeFilters)
  data.dependencies = data.dependencies.map(v => [trimPrefix(v[0], prefix), trimPrefix(v[1], prefix)])

  if (argv.noleaf) {
    const deps : [string, string][] = data.dependencies.map(v => [parent(v[0]), parent(v[1])])
    data.dependencies = []
    for (const d of deps) {
      const found = data.dependencies.some(v => v[0] === d[0] && v[1] === d[1])
      if (!found) data.dependencies.push(d)
    }
  }

  data.contains = getContains(data.dependencies)

  if (argv.cycle) {
    findCycleDependencies(data)
  } else {
    switch (argv.f) {
      case 'dgml': generateDGML(data); break
      case 'js': generateJS(data); break
      case 'dot': generateDot(data); break
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
  } else {
    const q = s.lastIndexOf('/')
    if (q >= 0) {
      return s.substr(0, q)
    }
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

function generateDot (data: DependencyData) {
  const dot = [
    'digraph {',
    data.dependencies.map(v => `"${v[0]}" -> "${v[1]}"`),
    '}'
  ].flat().join('\n')
  console.log(dot)
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
    console.log('No circular dependency.')
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
