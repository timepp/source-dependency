import { LanguageService, ParseContext } from './language-service-interface.ts'
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
    desc: `parse npm project that has package.json, 
           by default we look into lock files (yarn.lock or package-lock.json), if they are not found, we parse package.json directly.
           to force parse package.json directly: set \`forceIgnoreLockFiles\` to true, set \`devDependencies\` to true to include devDependencies during parsing.
           `,
    parse: function (context: ParseContext) {
        if (context.fileName !== 'package.json') return {}
        type LanguageOption = {
            getDependencyFromLockFile?: boolean
            devDependencies?: boolean
        }
        const lo = context.languageOption as LanguageOption
        const parsePackageJsonDirectly = () => {
            const deps: PackageDependencies = {}
            // const myName = dir.split(path.SEP_PATTERN).pop() as string
            const [r, myName, arr] = getDirectDependency(path.join(context.rootDir, context.file), lo.devDependencies || false)
            debugOutput(`parse result: ${r}`)
            deps[myName] = arr
            return deps
        }

        if (!context.file.endsWith('package.json')) return {}
        globalContext = context
        debugOutput(`parsing npm project ${context.file} with options: `, lo)
        let deps: PackageDependencies = {}
        if (lo.getDependencyFromLockFile) {
            const currentDir = path.dirname(path.join(context.rootDir, context.file))
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
        return deps
    }
}

function getDirectDependency(file: string, devDependencies: boolean): [string, string, string[]] {
    try {
        const pkg = JSON.parse(Deno.readTextFileSync(file))
        const deps = (devDependencies ? pkg.devDependencies : pkg.dependencies) as PackageDependencies || {}
        return ["succeeded", pkg.name, Object.keys(deps)]
    } catch (_e) {
        debugOutput('failed to parse ', file)
        return ["parseFailed", '', []]
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
