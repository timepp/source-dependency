import * as path from 'https://deno.land/std/path/mod.ts'
import * as flags from 'https://deno.land/std/flags/mod.ts'
import * as ls from './language-service.ts'
import * as util from './util.ts'

type RecursiveObject = {
  [key: string]: any
}

type DependencyData = {
  dependencies: { [id: string]: string[] },
  flatDependencies: [string, string][],
  contains: RecursiveObject,
  flatContains: [string, string][]
}

type Config = {
  excludeWellKnownAuxiliaryFolders: boolean,
  processingFilters: string[],
  excludeExternal: boolean,
  resultFilters: string[],
  prefix: string,
  language: string,
  target: string, // file or directory
  outputFormat: 'plain' | 'dot' | 'dgml' | 'js' | 'vis',
  outputFile?: string,
  forceShowingPathDependency?: boolean,
  depth?: string,
  check: boolean
}

const defaultConfig: Config = {
  excludeWellKnownAuxiliaryFolders: true,
  processingFilters: [],
  excludeExternal: false,
  resultFilters: [],
  prefix: '',
  language: 'javascript',
  target: '.',
  outputFormat: 'plain',
  check: false
}

const args = flags.parse(Deno.args)
if (args._.length > 0) {
  args.target = args._[0].toString()
}

const fileConfig: Config = args.c? JSON.parse(Deno.readTextFileSync(args.c)): { }
const c: Config = { ...defaultConfig, ...fileConfig, ...args }
console.log('config: ', c)

const pathFilters = parseFilters(c.processingFilters)
if (c.excludeWellKnownAuxiliaryFolders) {
  pathFilters.excludeFilters.push(/\.git/, /^\bnode_modules\b/)
}
const resultTextFilters = parseFilters(c.resultFilters)
const strictMatching = false
const outputFormat = c.outputFormat

const data: DependencyData = {
  dependencies: {},
  flatDependencies: [],
  contains: {},
  flatContains: []
}

const targetIsFile = Deno.statSync(c.target).isFile
const dir = targetIsFile ? path.dirname(c.target) : c.target
const files = targetIsFile ? [path.basename(c.target)] : [...util.listFilesRecursive(dir, pathFilters.includeFilters, pathFilters.excludeFilters)].map(v => v.path.replaceAll('\\', '/'))
const dependencyInfo = ls.parse(path.resolve(dir), files, c.language, !c.excludeWellKnownAuxiliaryFolders, strictMatching, pathFilters, (c, t) => console.log(`processing progress: ${c} / ${t}`))

// use path dependencies currently
data.dependencies = dependencyInfo.pathDependencies

if (Object.keys(dependencyInfo.moduleDependencies).length > 0 && !c.forceShowingPathDependency) {
  data.dependencies = dependencyInfo.moduleDependencies
}

if (c.excludeExternal) {
  for (const k of Object.keys(data.dependencies)) {
    data.dependencies[k] = data.dependencies[k].filter(v => !v.startsWith('*external*'))
  }
  delete data.contains['*external*']
}

for (const k of Object.keys(data.dependencies)) {
  for (const v of data.dependencies[k]) {
    if (util.applyFiltersToStr(k, resultTextFilters.includeFilters, resultTextFilters.excludeFilters) ||
      util.applyFiltersToStr(v, resultTextFilters.includeFilters, resultTextFilters.excludeFilters)) {
      data.flatDependencies.push([k, v])
    }
  }
}

data.flatDependencies = data.flatDependencies.map(v => [trimPrefix(v[0], c.prefix), trimPrefix(v[1], c.prefix)])
data.contains = util.buildHierarchy(data.flatDependencies.flat(), dependencyInfo.moduleSeparator)

if (c.depth) {
  const [d1, d2 = 0] = c.depth.split(',').map(v => parseInt(v))
  const deps: [string, string][] = []
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

let completed = false
while (!completed) {
  completed = true
  const trivial = data.flatContains.find(v => v[0] !== '' && data.flatContains.filter(u => u[0] === v[0]).length === 1 && data.flatDependencies.filter(u => u[0] === v[0] || u[1] === v[0]).length === 0)
  if (trivial) {
    // if has parent, link parent to child directly
    const parent = data.flatContains.find(v => v[1] === trivial[0])
    if (parent) {
      parent[1] = trivial[1]
    }
    trivial[0] = '' // mark deletion
    completed = false
  }
}
data.flatContains = data.flatContains.filter(v => v[0] !== '')

if (c.check) {
  findCycleDependencies(data)
} else {
  let result = ''
  switch (outputFormat) {
    case 'dgml': result = generateDGML(data); break
    case 'js': result = generateJS(data); break
    case 'dot': result = generateDot(data); break
    case 'vis': result = generateVisJs(data); break
    default: result = generateDependencies(data); break
  }

  if (c.outputFile) {
    Deno.writeTextFileSync(c.outputFile, result)
  } else {
    console.log(result)
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
  const getSubgraphStatements = function (obj: RecursiveObject, depth = 0) {
    if (obj === null) return []
    const arr: string[] = []
    for (const p in obj) {
      if (obj[p] === null) {
        arr.push('"' + p + '"')
      } else {
        const color = theme[depth % theme.length]
        arr.push('subgraph cluster_' + p.replace(/[^a-zA-Z0-9]/g, '_') + ' {')
        arr.push(`style="rounded"; bgcolor="${color}"`)
        arr.push(...getSubgraphStatements(obj[p], depth + 1))
        arr.push('}')
      }
    }
    return arr
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
  const template = Deno.readTextFileSync('./vis_template.html')
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

function parseFilters (filters: string[]) : ls.PathFilters {
  const includeFilters : RegExp[] = []
  const excludeFilters : RegExp[] = []
  for (const f of filters) {
    if (f.startsWith('-')) {
      excludeFilters.push(new RegExp(f.slice(1)))
    } else if (f.startsWith('+')) {
      includeFilters.push(new RegExp(f.slice(1)))
    } else {
      includeFilters.push(new RegExp(f))
    }
  }
  return { includeFilters, excludeFilters }
}
