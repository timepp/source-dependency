import * as path from "https://deno.land/std@0.198.0/path/mod.ts"
import * as fs from "https://deno.land/std@0.180.0/fs/mod.ts"
import * as flags from "https://deno.land/std@0.198.0/flags/mod.ts"
import * as json5 from "https://deno.land/x/json5@v1.0.0/mod.ts"
import * as color from "https://deno.land/std@0.208.0/fmt/colors.ts";
import * as ls from './language-service.ts'
import * as util from './util.ts'
import { DependencyData, generateOutput, getAllGenerators } from './generator.ts'

const defaultConfig = {
  excludeWellKnownAuxiliaryFolders: true,
  inputFilters: new Array<string>(),
  excludeExternal: false,
  resultFilters: new Array<string>(),
  inputPathMapping: new Array<string>(),
  prefix: '',
  language: 'typescript',
  target: '.',
  outputFormat: 'plain',
  outputFile: '',
  configFile: '',
  forceShowingPathDependency: false,
  depth: '',
  check: false,
  debug: false
}

const configDescription: {[P in keyof typeof defaultConfig]: [/*doc*/string, /*alias*/string]} = {
  excludeWellKnownAuxiliaryFolders: ['exclude `.git` and `node_modules`', ''],
  inputFilters: ['input filters, prefix `-` for exclude filters', 'if'],
  inputPathMapping: ['input path mapping, e.g. `a=b` means replace `a` with `b` in input paths', 'ipm'],
  excludeExternal: ['exclude external dependencies', ''],
  resultFilters: ['result filters', 'rf'],
  prefix: ['prefix', 'p'],
  language: [`languages, all supported languages are: ${ls.getSupportedLanguages().join(',')}`, 'l'],
  target: ['target, can be a file or a folder', ''],
  outputFormat: ['output format, see below section for description', 'f'],
  outputFile: ['output file', 'o'],
  forceShowingPathDependency: ['force showing path dependency', ''],
  depth: ['depth', ''],
  check: ['check', ''],
  configFile: ['config file', 'c'],
  debug: ['output debug information', 'd']
}

function showHelp() {
  console.log('Usage: sd [options] [target]')
  console.log('Options:')
  for (const k in configDescription) {
    const kk = k as keyof typeof configDescription
    const v = configDescription[kk] as [string, string]
    const flag = v[1] ? ` (${v[1]})` : ''
    console.log(`%c${kk}%c${flag}:`, 'font-weight: bold; color: blue', 'color: blue', v[0])
  }
  console.log('Output formats:')
  for (const g of getAllGenerators()) {
    console.log(`  %c${g.name.padStart(8)}`, 'font-weight: bold; color: green', g.description)
  }
}

const args = flags.parse(Deno.args, {
  collect: Object.keys(defaultConfig).filter(v => Array.isArray(defaultConfig[v as keyof typeof defaultConfig])),
  alias: Object.fromEntries(Object.entries(configDescription).map(v => [v[1][1], v[0]])) as {[k: string]: string},
}) as unknown as typeof defaultConfig & {_: string[], h?: boolean, help?: boolean}

if (args._.length > 0) {
  args.target = args._[0].toString()
}

if (args.debug) {
  console.log('args: ', args)
}
if (args.h || args.help) {
  showHelp()
  Deno.exit(0)
}

const fileConfig = args.configFile? json5.parse(Deno.readTextFileSync(args.configFile)): { }
const c: typeof defaultConfig = { ...defaultConfig, ...fileConfig, ...args }

// deno-lint-ignore no-explicit-any
function debugOutput (...data: any[]) {
  if (c.debug) console.log(...data)
}

function writeControlMsg(msg: string) {
  Deno.stderr.writeSync(new TextEncoder().encode(color.brightBlue(msg + '\n')))
}

debugOutput('config: ', c)

const pathFilters = parseFilters(c.inputFilters)
if (c.excludeWellKnownAuxiliaryFolders) {
  pathFilters.excludeFilters.push(/\b\.git\b/, /\bnode_modules\b/)
}
const resultTextFilters = parseFilters(c.resultFilters)
const strictMatching = false

const data: DependencyData = {
  dependencies: {},
  flatDependencies: [],
  contains: {},
  flatContains: []
}

const targetIsFile = Deno.statSync(c.target).isFile
const dir = targetIsFile ? path.dirname(c.target) : c.target
const exts = ls.getLanguageExtensions(c.language)

if (targetIsFile) {
  debugOutput('searching directory: ', dir)
  debugOutput('target is file: ', c.target)
} else {
  debugOutput('searching directory: ', dir)
  debugOutput('path filters: ', pathFilters)
  debugOutput('file exts: ', exts)
}

const files = targetIsFile ? [c.target] 
  : [...fs.walkSync(dir, { 
      includeDirs: false, 
      skip: pathFilters.excludeFilters, 
      match: pathFilters.includeFilters.length > 0 ? pathFilters.includeFilters : undefined,
      exts
     })].map(v => v.path.replaceAll('\\', '/'))
const relativeFiles = files.map(v => path.relative(dir, v).replaceAll('\\', '/'))
writeControlMsg(`processing ${files.length} files...`)

const pathResolver = (s: string) => {
  for (const m of c.inputPathMapping) {
    const [a, b] = m.split('=')
    if (s.startsWith(a)) {
      return b + s.slice(a.length)
    }
  }
  return s
}

const dependencyInfo = ls.parse(path.resolve(dir), relativeFiles, c.language, !c.excludeWellKnownAuxiliaryFolders, 
  strictMatching, pathFilters, pathResolver, (c, t) => writeControlMsg(`processing progress: ${c} / ${t}`))

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
  const cycles = util.findCycleDependencies(data.flatDependencies)
  if (cycles.length > 0) {
    console.log('cycles found:')
    for (const cycle of cycles) {
      console.log(cycle.join(' -> '))
    }
    Deno.exit(1)
  } else {
    console.log('no cycles found')
    Deno.exit(0)
  }
} else {
  const result = generateOutput(c.outputFormat, data)
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

function stripByDepth (s: string, depth: number, separator: string) {
  if (depth === 0) return s
  const arr = s.split(separator)
  return arr.slice(0, depth).join(separator)
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
