#!/usr/bin/env node

import * as fs from 'fs'
import yargs from 'yargs'
import * as path from 'path'
import * as os from 'os'
import open from 'open'
import * as ls from './language-service.js'
import * as util from './util.js'

type RecursiveObject = {
  [key: string]: any
}

type DependencyData = {
  dependencies: { [id: string]: string[] },
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
    .epilog('Supported languages: ' + ls.getSupportedLanguages().join(', '))
    .options({
      I: { array: true, type: 'string', alias: 'include', describe: 'path filters (regex) to include' },
      E: { array: true, type: 'string', alias: 'exclude', describe: 'path filters (regex) to exclude' },
      l: { type: 'string', alias: 'language', required: true, describe: 'source code language, see below' },
      check: { type: 'boolean', conflicts: ['f', 'o', 'v'], describe: 'check suspicious dependencies such as circles' },
      inner: { type: 'boolean', describe: 'show only inner dependencies' },
      v: { type: 'boolean', conflicts: ['f', 'o'], describe: 'create visjs html file in tmp folder and then open it with default program' },
      a: { type: 'boolean', describe: 'scan for all files. ' },
      strict: { type: 'boolean', describe: 'strict match for dependencies' },
      depth: { type: 'string', describe: 'collapse depth on package level' },
      strip: { type: 'string', describe: 'common prefix to be stripped to simplify the result, useful on java projects' },
      f: { type: 'string', alias: 'format', describe: 'output format. one of: "plain", "dot", "dgml", "js", "vis"' },
      o: { type: 'string', alias: 'output', describe: 'output file. output format is deduced by ext if not given.' },
      p: { type: 'boolean', alias: 'pathdep', describe: 'use path dependency even if module dependency is available' }
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
  if (!argv.a) {
    pathFilters.excludeFilters.push(/\b.git\b/, /\bnode_modules\b/)
  }
  const prefix = argv.strip

  const data : DependencyData = {
    dependencies: {},
    flatDependencies: [],
    contains: {},
    flatContains: []
  }

  const targetIsFile = fs.lstatSync(target).isFile()
  const dir = targetIsFile ? path.dirname(target) : target
  const files = targetIsFile ? [target] : util.listFilesRecursive(dir, pathFilters.includeFilters, pathFilters.excludeFilters)
  const dependencyInfo = ls.parse(dir, files, argv.l, argv.a || false, argv.strict || false)

  // use path dependencies currently
  data.dependencies = dependencyInfo.pathDependencies
  data.contains = dependencyInfo.pathHierarchy

  if (Object.keys(dependencyInfo.moduleDependencies).length > 0 && !argv.p) {
    data.dependencies = dependencyInfo.moduleDependencies
    data.contains = dependencyInfo.moduleHierarchy
  }

  if (argv.inner) {
    for (const k of Object.keys(data.dependencies)) {
      data.dependencies[k] = data.dependencies[k].filter(v => !v.startsWith('*external*'))
    }
    delete data.contains['*external*']
  }

  for (const k of Object.keys(data.dependencies)) {
    for (const v of data.dependencies[k]) {
      data.flatDependencies.push([k, v])
    }
  }

  data.flatDependencies = data.flatDependencies.map(v => [trimPrefix(v[0], prefix), trimPrefix(v[1], prefix)])

  if (argv.depth) {
    const [d1, d2 = 0] = argv.depth.split(',').map(v => parseInt(v))
    const deps : [string, string][] = []
    for (const v of data.flatDependencies) {
      const a = stripByDepth(v[0], v[0] in data.dependencies ? d1 : d2, dependencyInfo.moduleSeparator)
      const b = stripByDepth(v[1], v[1] in data.dependencies ? d1 : d2, dependencyInfo.moduleSeparator)
      if (a && b && a !== b) deps.push([a, b])
    }
    data.flatDependencies = []
    for (const d of deps) {
      const found = data.flatDependencies.some(v => v[0] === d[0] && v[1] === d[1])
      if (!found) data.flatDependencies.push(d)
    }
  }

  util.walkHierarchy(data.contains, (a, b) => data.flatContains.push([a, b]))

  let openOutput = null
  if (argv.v) {
    argv.f = 'vis'
    argv.o = path.join(os.tmpdir(), 'source-dependency-temp.html')
    openOutput = argv.o
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
      case 'vis': result = generateVisJs(data); break
      default: result = generateDependencies(data); break
    }

    if (argv.o) {
      fs.writeFileSync(argv.o, result, 'utf-8')
    } else {
      console.log(result)
    }
  }

  if (openOutput) {
    open(openOutput)
  }
}

function trimPrefix (s:string, prefix:string|undefined) {
  if (prefix && s.startsWith(prefix)) {
    return s.substr(prefix.length)
  }
  return s
}

function generateDependencies (data: DependencyData) {
  return data.flatDependencies.map(d => `${d[0]} -> ${d[1]}`).join('\n')
}

function stripByDepth (s: string, depth: number, separator: string) {
  if (depth === 0) return s
  const arr = s.split(separator)
  return arr.slice(0, depth).join(separator)
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
  const theme = ['#ffd0cc', '#d0ffcc', '#d0ccff']
  const getSubgraphStatements = function (obj: any, depth: number = 0) : any[] {
    if (obj === null) return []
    const arr = []
    for (const p in obj) {
      if (obj[p] === null) {
        arr.push('"' + p + '"')
      } else {
        const color = theme[depth % theme.length]
        arr.push('subgraph cluster_' + p.replace(/[^a-zA-Z0-9]/g, '_') + ' {')
        arr.push(`style="rounded"; bgcolor="${color}"`)
        arr.push(getSubgraphStatements(obj[p], depth + 1))
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

function generateVisJs (data: DependencyData) {
  const nodeNames = [...new Set(data.flatDependencies.flat())]
  const nodes = nodeNames.map(v => { return { id: v, label: v, shape: 'box' } })
  const edges = data.flatDependencies.map(v => { return { from: v[0], to: v[1], arrows: 'to' } })
  const template = fs.readFileSync(new URL('./vis_template.html', import.meta.url), 'utf-8')
  const html = template.replace('__NODES', JSON.stringify(nodes)).replace('__EDGES', JSON.stringify(edges))
  return html
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
