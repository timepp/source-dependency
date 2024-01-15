import * as path from "https://deno.land/std@0.198.0/path/mod.ts"
import * as fs from "https://deno.land/std@0.180.0/fs/mod.ts"
import * as flags from "https://deno.land/std@0.198.0/flags/mod.ts"
import * as json5 from "https://deno.land/x/json5@v1.0.0/mod.ts"
import * as color from "https://deno.land/std@0.208.0/fmt/colors.ts";
import * as ls from './language-service.ts'
import { PathFilters, DependencyData, Dependencies } from "./language-service-interface.ts";
import * as util from './util.ts'
import { generateOutput, getAllGenerators } from './generator.ts'

const defaultConfig = {
  // TODO: remove this, use can set this as input filters per needs
  excludeWellKnownAuxiliaryFolders: true,
  inputFilters: [] as string[],
  excludeExternal: false,
  resultFilters: [] as string[],
  rootNodesFilters: [] as string[],
  inputPathMapping: [] as string[],
  modulePathSeparator: '',
  prefix: '',
  language: '',
  languageOption: '{}',
  target: '.',
  saveParsingResultToFile: '',
  loadParsingResultFromFile: '',
  outputFormat: 'plain',
  outputFile: '',
  configFile: '',
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
  rootNodesFilters: ['filters to pick root nodes', 'nf'],
  modulePathSeparator: ['override language defined module path separator', 's'],
  prefix: ['prefix', 'p'],
  language: [`specify language, if not provided, all languages will be proceeded. All supported languages are: ${ls.getSupportedLanguages().join(',')}`, 'l'],
  languageOption: ['language options, see below section for description', 'lo'],
  target: ['target, can be a file or a folder', ''],
  saveParsingResultToFile: ['save parsing result to file to accelerate parsing stage', 'sr'],
  loadParsingResultFromFile: ['load parsing result from file to accelerate parsing stage. parsing related flags will be ignored when this is set, e.g. input filters', 'lr'],
  outputFormat: ['output format, see below section for description', 'f'],
  outputFile: ['output file', 'o'],
  depth: ['depth', ''],
  check: ['check', ''],
  configFile: ['config file', 'c'],
  debug: ['output debug information', 'd']
}

function showHelp() {
  console.log('Usage: sd [options] [target]')
  console.log()
  console.log('Options:')
  for (const k in configDescription) {
    const kk = k as keyof typeof configDescription
    const v = configDescription[kk] as [string, string]
    const flag = v[1] ? ` (${v[1]})` : ''
    const defaultValue = JSON.stringify(defaultConfig[kk])
    console.log(`  - %c${kk}%c${flag} %c= ${defaultValue}:`, 'font-weight: bold; color: blue', 'color: blue', 'color: grey', v[0])
  }
  console.log()
  console.log('Output formats:')
  const generators = getAllGenerators()
  const maxNameLength = Math.max(...generators.map(v => v.name.length))
  for (const g of getAllGenerators()) {
    console.log(`  - %c${g.name.padEnd(maxNameLength)}`, 'font-weight: bold; color: green', g.description)
  }
}

function parseConfigFile(f: string) {
  try {
    const config = json5.parse(Deno.readTextFileSync(f))
    return config
  } catch (e) {
    writeControlMsg(`failed to parse config file ${f}: ${e}`)
    return {}
  }
}

function parseFromParsingResultFile(f: string) {
  writeControlMsg(`loading parsing result from file ${f}...`)
  const deps = JSON.parse(Deno.readTextFileSync(f))
  return deps as Dependencies
}
function parse(c: typeof defaultConfig) {
  const pathFilters = parseFilters(c.inputFilters)
  if (c.excludeWellKnownAuxiliaryFolders) {
    pathFilters.excludeFilters.push(/\b\.git\b/, /\bnode_modules\b/)
  }
  const languageOption = (typeof c.languageOption === 'string')? json5.parse(c.languageOption): c.languageOption
  const strictMatching = false
  const targetIsFile = Deno.statSync(c.target).isFile
  const dir = targetIsFile ? path.dirname(c.target) : c.target
  
  if (targetIsFile) {
    debugOutput('searching directory: ', dir)
    debugOutput('target is file: ', c.target)
  } else {
    debugOutput('searching directory: ', dir)
    debugOutput('path filters: ', pathFilters)
  }
  
  writeControlMsg(`searching source files...`)
  const files = targetIsFile ? [c.target] 
    : [...fs.walkSync(dir, { 
        includeDirs: false, 
        skip: pathFilters.excludeFilters, 
        match: pathFilters.includeFilters.length > 0 ? pathFilters.includeFilters : undefined
       })].map(v => v.path.replaceAll('\\', '/'))
  const relativeFiles = files.map(v => path.relative(dir, v).replaceAll('\\', '/'))
  writeControlMsg(`processing ${files.length} files...`)
  debugOutput('files: ', relativeFiles)
  
  const pathResolver = (s: string) => {
    for (const m of c.inputPathMapping) {
      const [a, b] = m.split('=')
      if (s.startsWith(a)) {
        return b + s.slice(a.length)
      }
    }
    return s
  }
  
  const callContext = {
    nameResolver: pathResolver,
    progressCallback: (c: number, t: number) => writeControlMsg(`processing progress: ${c} / ${t}`),
    debugOutput,
    languageOption
  }
  
  const deps = ls.parse(path.resolve(dir), relativeFiles, c.language, strictMatching, pathFilters, callContext)
  return deps
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

const fileConfig = args.configFile? parseConfigFile(args.configFile): {}
const c: typeof defaultConfig = { ...defaultConfig, ...fileConfig, ...args }

// deno-lint-ignore no-explicit-any
function debugOutput (...data: any[]) {
  if (c.debug) console.log(...data)
}

function writeControlMsg(msg: string) {
  Deno.stderr.writeSync(new TextEncoder().encode(color.brightBlue(msg + '\n')))
}

debugOutput('config: ', c)

const deps = c.loadParsingResultFromFile? parseFromParsingResultFile(c.loadParsingResultFromFile) : parse(c)
if (c.saveParsingResultToFile) {
  Deno.writeTextFileSync(c.saveParsingResultToFile, JSON.stringify(deps, null, 4))
}

const resultTextFilters = parseFilters(c.resultFilters)
const rootNodesFilters = parseFilters(c.rootNodesFilters)
const data: DependencyData = {
  dependencies: {...deps},
  flatDependencies: [],
  contains: {},
  flatContains: []
}

// `external` means the entity doesn't appear in the key of `dependencies`
// if there is an internal entity which doesn't have a dependency, its dependency array will be empty, 
// this can be used to differentiate `external` and `internal`
for (const k of Object.keys(data.dependencies)) {
  if (c.excludeExternal) {
    data.dependencies[k] = data.dependencies[k].filter(v => v in data.dependencies)
  } else {
    data.dependencies[k] = data.dependencies[k].map(v => v in data.dependencies? v: `*external/${v}`)
  }
}

for (const k of Object.keys(data.dependencies)) {
  if (!applyFilters(k, resultTextFilters)) {
    delete data.dependencies[k]
    continue
  }
  data.dependencies[k] = data.dependencies[k].filter(v => applyFilters(v, resultTextFilters))
}

// apply root nodes filters
const rootNodes = Object.keys(data.dependencies).filter(v => applyFilters(v, rootNodesFilters))
const rootNodesSet = new Set(rootNodes)
let hasNewChanges = true
while (hasNewChanges) {
  const oldSize = rootNodesSet.size
  for (const k of rootNodesSet) {
    if (k in data.dependencies) {
      for (const v of data.dependencies[k]) {
        rootNodesSet.add(v)
      }
    }
  }
  hasNewChanges = rootNodesSet.size !== oldSize
}
for (const k of Object.keys(data.dependencies)) {
  if (!rootNodesSet.has(k)) {
    delete data.dependencies[k]
  }
}

// build flat dependencies
for (const k in data.dependencies) {
  for (const v of data.dependencies[k]) {
    data.flatDependencies.push([k, v])
  }
}

data.flatDependencies = data.flatDependencies.map(v => [trimPrefix(v[0], c.prefix), trimPrefix(v[1], c.prefix)])

let sep = c.modulePathSeparator
if (sep === '') {
  // sep = ls.getLanguageService(c.language).moduleSeparator || '/'
  sep = '/'
}
const moduleSeparator = new RegExp(sep, 'g')
data.contains = util.buildHierarchy(data.flatDependencies.flat(), moduleSeparator)

if (c.depth) {
  const [d1, d2 = 0] = c.depth.split(',').map(v => parseInt(v))
  const deps: [string, string][] = []
  for (const v of data.flatDependencies) {
    const a = stripByDepth(v[0], v[0] in data.dependencies ? d1 : d2, moduleSeparator)
    const b = stripByDepth(v[1], v[1] in data.dependencies ? d1 : d2, moduleSeparator)
    if (a && b && a !== b) deps.push([a, b])
  }
  data.flatDependencies = []
  for (const d of deps) {
    const found = data.flatDependencies.some(v => v[0] === d[0] && v[1] === d[1])
    if (!found) data.flatDependencies.push(d)
  }
}
util.walkHierarchy(data.contains, (a, b) => data.flatContains.push([a, b]))

// collapse single route
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
  if (c.outputFile && c.outputFile !== '') {
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

function stripByDepth (s: string, depth: number, separator: RegExp) {
  if (depth === 0) return s
  let r
  let ss = s
  while (depth > 0 && (r = separator.exec(s))) {
    ss = s.slice(r.index)
    depth--
  }
  return ss
}

function parseFilters (filters: string[]) : PathFilters {
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

function applyFilters (str: string, pf: PathFilters) {
  return util.applyFiltersToStr(str, pf.includeFilters, pf.excludeFilters)
}
