import { LanguageService, ParseContext } from './language-service-interface.ts'
import * as util from './util.ts'
import * as path from "https://deno.land/std@0.198.0/path/mod.ts"

type PackageDependencies = { [key: string]: string[] }

let globalContext: ParseContext | null = null

function getGlobalContext() {
    if (!globalContext) {
        throw new Error('globalContext is not set')
    }
    return globalContext
}

function debugOutput(...data: unknown[]) {
    const context = getGlobalContext()
    context.debugOutput(...data)
}

export const NpmPackageService: LanguageService = {
    name: 'npm',
    exts: ['.json'], // we look only into `package.json`
    desc: `parse npm project that has package.json, 
           by default we look into lock files (yarn.lock or package-lock.json), if they are not found, we parse package.json directly.
           to force parse package.json directly: set \`forceIgnoreLockFiles\` to true, set \`devDependencies\` to true to include devDependencies during parsing.
           `,
    parse: function (context: ParseContext) {
        type LanguageOption = {
            getDependencyFromLockFile?: boolean
            devDependencies?: boolean
        }
        const lo = context.languageOption as LanguageOption
        function getDirectDependency(dir: string): [string, string, string[]] {
            if (!util.applyFiltersToStr(dir, context.pathFilters.includeFilters, context.pathFilters.excludeFilters)) {
                return ["filtered", '', []]
            }
            try {
                const pkg = JSON.parse(Deno.readTextFileSync(path.join(dir, 'package.json')))
                const deps = (lo.devDependencies ? pkg.devDependencies : pkg.dependencies) as PackageDependencies || {}
                debugOutput('direct dependencies: ', dir, deps)
                return ["succeeded", pkg.name, Object.keys(deps)]
            } catch (_e) {
                debugOutput('failed to parse package.json: ', dir)
                return ["parseFailed", '', []]
            }
        }
        const getAllPossibleDependencyDirs = (dir: string, dep: string) => {
            const result: string[] = []
            const resolvedDir = context.nameResolver(dep)
            if (resolvedDir) {
                result.push(resolvedDir)
            }
            const parts = dir.split(path.SEP_PATTERN)
            while (parts.length > 0) {
                result.push(path.join(...parts, 'node_modules', dep))
                parts.pop()
            }
            return result
        }
        const getFirstUnprocessedDependency = (deps: PackageDependencies) => {
            for (const pkg in deps) {
                for (const dep of deps[pkg]) {
                    if (!deps[dep]) {
                        return dep
                    }
                }
            }
            return null
        }
        const parsePackageJsonDirectly = () => {
            const deps: PackageDependencies = {}
            const dir = path.dirname(path.join(context.rootDir, context.currentFile))
            // const myName = dir.split(path.SEP_PATTERN).pop() as string
            const [r, myName, arr] = getDirectDependency(dir)
            debugOutput(`parse result: ${r}`)
            deps[myName] = arr

            while (true) {
                const dep = getFirstUnprocessedDependency(deps)
                if (!dep) {
                    break
                }
                deps[dep] = []
                const dirs = getAllPossibleDependencyDirs(dir, dep)
                const results: string[] = []
                for (const d of dirs) {
                    const [r, _name, dd] = getDirectDependency(d)
                    results.push(r)
                    if (r === 'succeeded') {
                        debugOutput(`dependency ${dep} resolved in ${d}`)
                        deps[dep] = dd
                        break
                    }
                }
                if (results.every(v => v !== 'succeeded')) {
                    debugOutput(`dependency ${dep} not resolved with following search list: `)
                    dirs.forEach((d, i) => {
                        debugOutput(`  %c[${results[i]}]: %c${d}`, 'color: red', 'color: blue')
                    })
                }
            }
            return deps
        }

        if (!context.currentFile.endsWith('package.json')) return {}
        globalContext = context
        const currentDir = path.dirname(path.join(context.rootDir, context.currentFile))
        debugOutput(`parsing npm project ${currentDir} with options: `, lo)
        let deps: PackageDependencies = {}
        if (lo.getDependencyFromLockFile) {
            const lockFile = path.join(currentDir, 'yarn.lock')
            deps = parseYarnLock(lockFile)
            if (Object.keys(deps).length === 0) {
                const lockFile = path.join(currentDir, 'package-lock.json')
                deps = parsePackageLock(lockFile)
            }
        }

        if (Object.keys(deps).length === 0) {
            debugOutput('parsing package.json directly')
            deps = parsePackageJsonDirectly()
        }

        debugOutput('dependencies: ', deps)
        return { moduleDependencies: deps }
    }
}

function parsePackageLock(path: string) {
    const deps: PackageDependencies = {}
    try {
        debugOutput('parsing npm lock file: ', path)
        const lock = JSON.parse(Deno.readTextFileSync(path))
        for (const p in lock.packages) {
            const pkg = lock.packages[p]
            const name = p || pkg.name
            const depPackages = Object.keys(pkg.dependencies || {})
            deps[name] = depPackages
        }
        debugOutput('direct dependencies: ', path, deps)
        return deps
    } catch (_e) {
        debugOutput('failed to parse npm lock file: ', path)
        return {}
    }
}

function parseYarnLock(path: string) {
    const unquote = (s: string) => s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s
    let lockContent = ''
    try {
        lockContent = Deno.readTextFileSync(path)
    } catch (e) {
        debugOutput('failed to read yarn lock file: ', e)
        return {}
    }
    debugOutput('parsing yarn lock file: ', path)
    const arr = lockContent.split(/\r?\n\r?\n/g).map(v => v.trim()).filter(v => v.length > 0)
    const deps: PackageDependencies = {}
    for (const section of arr) {
        const lines = section.split(/\r?\n/g).map(v => v.trim()).filter(v => v.length > 0)
        if (lines.length === 0 || lines[0].startsWith('#')) continue
        const pkgs = lines[0].split(':')[0].split(',').map(v => unquote(v.trim()))
        const dependenciesIndex = lines.findIndex(v => v.startsWith('dependencies:'))
        const depPackages = (dependenciesIndex < 0) ? [] : lines.slice(dependenciesIndex + 1).map(v => {
            return v.trim().split(' ').map(v => unquote(v.trim())).join('@')
        })
        for (const pkg of pkgs) {
            deps[pkg] = depPackages
        }
    }
    return deps
}
