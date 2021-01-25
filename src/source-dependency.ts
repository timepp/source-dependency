#!/usr/bin/env node

import * as fs from 'fs'
import yargs from 'yargs'
import * as path from 'path'
import * as ls from './language-service.js'
import * as util from './util.js'

type RecursiveObject = {
  [key: string]: any
}

type DependencyData = {
  dependencies: ls.Dependencies,
  flatDependencies: [string, string][],
  contains: RecursiveObject,
  flatContains: [string, string][]
}

main()

function main () {
  const args = yargs(process.argv.slice(2))
  const argv = args
    .locale('en')
    .strict()
    .usage('Usage: $0 <target> [options]')
    .wrap(args.terminalWidth())
    .epilog('Supported languages: \n\n' + ls.getLanguageSummary())
    .options({
      // TODO: group external dependencies together
      I: { array: true, type: 'string', alias: 'include', describe: 'path filters (regex) to include' },
      E: { array: true, type: 'string', alias: 'exclude', describe: 'path filters (regex) to exclude' },
      l: { type: 'string', alias: 'language', describe: 'source code language, see below' },
      check: { type: 'boolean', conflicts: ['f', 'o'], describe: 'check suspicious dependencies such as circles' },
      inner: { type: 'boolean', describe: 'show only inner dependencies' },
      depth: { type: 'string', describe: 'collapse depth on package level' },
      strip: { type: 'string', describe: 'common prefix to be stripped to simplify the result, useful on java projects' },
      f: { type: 'string', alias: 'format', describe: 'output format. one of: "plain", "dot", "dgml", "js"' },
      o: { type: 'string', alias: 'output', describe: 'output file. output format is deduced by ext if not given.' }
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

  const pathFilters = {
    includeFilters: argv.I ? argv.I.map(v => new RegExp(v, 'g')) : [],
    excludeFilters: argv.E ? argv.E.map(v => new RegExp(v, 'g')) : []
  }
  const prefix = argv.strip

  const lang = ls.getLanguageService(argv.l || 'java')
  if (!lang) {
    console.error(`unsupported language: ${argv.l}`)
    return
  }

  const data : DependencyData = {
    dependencies: {},
    flatDependencies: [],
    contains: {},
    flatContains: []
  }

  if (fs.lstatSync(target).isFile()) {
    data.dependencies = lang.parse(path.dirname(target), [target])
  } else {
    const dir = target
    const files = util.listFilesRecursive(dir, pathFilters.includeFilters, pathFilters.excludeFilters)
    data.dependencies = lang.parse(dir, files)
  }

  for (const k of Object.keys(data.dependencies)) {
    for (const v of data.dependencies[k]) {
      if (!argv.inner || v in data.dependencies) {
        data.flatDependencies.push([k, v])
      }
    }
  }

  data.flatDependencies = data.flatDependencies.map(v => [trimPrefix(v[0], prefix), trimPrefix(v[1], prefix)])

  if (argv.depth) {
    const [d1, d2 = 0] = argv.depth.split(',').map(v => parseInt(v))
    const deps : [string, string][] = []
    for (const v of data.flatDependencies) {
      const a = stripByDepth(v[0], v[0] in data.dependencies ? d1 : d2)
      const b = stripByDepth(v[1], v[1] in data.dependencies ? d1 : d2)
      if (a && b && a !== b) deps.push([a, b])
    }
    data.flatDependencies = []
    for (const d of deps) {
      const found = data.flatDependencies.some(v => v[0] === d[0] && v[1] === d[1])
      if (!found) data.flatDependencies.push(d)
    }
  }

  const getObject = function (s: string) : RecursiveObject {
    if (s === '') return data.contains
    const o = getObject(parent(s, lang.moduleSeparator()))
    const n : RecursiveObject = {}
    if (!(s in o)) {
      o[s] = n
    }
    return o[s]
  }

  data.flatContains = getContains(data.flatDependencies, lang.moduleSeparator())
  for (const m of data.flatDependencies.flat()) {
    getObject(parent(m, lang.moduleSeparator()))[m] = {}
  }

  if (argv.check) {
    findCycleDependencies(data)
  } else {
    const format = argv.f || path.extname(argv.o || '').slice(1)
    let result = ''
    switch (format) {
      case 'dgml': result = generateDGML(data); break
      case 'js': result = generateJS(data); break
      case 'dot': result = generateDot(data); break
      default: result = generateDependencies(data); break
    }

    if (argv.o) {
      fs.writeFileSync(argv.o, result, 'utf-8')
    } else {
      console.log(result)
    }
  }
}

function trimPrefix (s:string, prefix:string|undefined) {
  if (prefix && s.startsWith(prefix)) {
    return s.substr(prefix.length)
  }
  return s
}

function getContains (arr: [string, string][], sp: string) {
  const contains: [string, string][] = []
  const processed : { [id: string]: boolean } = {}

  const process = function (name: string) {
    while (!(name in processed)) {
      processed[name] = true
      const parentName = parent(name, sp)
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

function generateDependencies (data: DependencyData) {
  return data.flatDependencies.map(d => `${d[0]} -> ${d[1]}`).join('\n')
}

function parent (s: string, sp: string) {
  const p = s.lastIndexOf(sp)
  if (p >= 0) {
    return s.substr(0, p)
  }
  return ''
}

function stripByDepth (s: string, depth: number) {
  if (depth === 0) return s
  const splitter = s.indexOf('.') >= 0 ? '.' : '/'
  const arr = s.split(/\.|\//)
  return arr.slice(0, depth).join(splitter)
}

function generateDGML (data: DependencyData) {
  // node
  const nodes : { [id: string]: number } = {}
  const parentNodes : { [id: string]: number } = {}

  const header = '<?xml version="1.0" encoding="utf-8"?>\n<DirectedGraph xmlns="http://schemas.microsoft.com/vs/2009/dgml">\n'
  const tail = '</DirectedGraph>'

  let linkStr = '<Links>\n'
  for (const l of data.flatContains) {
    linkStr += `  <Link Source="${l[0]}" Target="${l[1]}" Category="Contains" />\n`
    parentNodes[l[0]] = 1
  }
  for (const l of data.flatDependencies) {
    linkStr += `  <Link Source="${l[0]}" Target="${l[1]}" />\n`
    nodes[l[0]] = 1
    nodes[l[1]] = 1
  }
  linkStr += '</Links>\n'

  let nodeStr = '<Nodes>\n'
  for (const n in parentNodes) {
    nodeStr += `  <Node Id="${n}" Label="${n}" Group="Collapsed"/>\n`
  }
  for (const n in nodes) {
    nodeStr += `  <Node Id="${n}" Label="${n}"/>\n`
  }
  nodeStr += '</Nodes>\n'

  const dgml = header + nodeStr + linkStr + tail
  return dgml
}

function generateJS (data: DependencyData) {
  return 'const data = ' + JSON.stringify(data, null, 4) + ';'
}

function generateDot (data: DependencyData) {
  const getSubgraphStatements = function (obj: any) : any[] {
    if (obj === null) return []
    const arr = []
    for (const p in obj) {
      if (obj[p] === null) {
        arr.push('"' + p + '"')
      } else {
        arr.push('subgraph cluster_' + p.replace(/[^a-zA-Z0-9]/g, '_') + ' {')
        arr.push('style="rounded"; bgcolor="#028d35"')
        arr.push(getSubgraphStatements(obj[p]))
        arr.push('}')
      }
    }
    return arr.flat()
  }
  const dependencyStatements = data.flatDependencies.map(v => `"${v[0]}" -> "${v[1]}"`)
  const subgraphStatements = getSubgraphStatements(data.contains)

  const dot = [
    'digraph {',
    '  overlap=false',
    subgraphStatements,
    dependencyStatements,
    '}'
  ].flat().join('\n')
  return dot
}

function findCycleDependencies (data: DependencyData) {
  let deps = data.flatDependencies
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
