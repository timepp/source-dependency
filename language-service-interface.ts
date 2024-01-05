import * as util from './util.ts'

export type PathFilters = {
    includeFilters: RegExp[],
    excludeFilters: RegExp[]
}

export type ParseContext = {
    pathFilters: PathFilters,
    rootDir: string,
    files: string[],
    currentFile: string,
    fileContent: string,
    lineNumber: number,
    line: string,
    nameResolver: (name: string) => string | null
    // deno-lint-ignore no-explicit-any
    languageOption: any,
    // deno-lint-ignore no-explicit-any
    debugOutput: (...data: any[]) => void
}

export type ParseResult = {
    // for languages or parse configurations that module is something other than file name
    // if this is omit from result, it will be treated as file name
    module?: string,
    pathDependencies?: string[]
    moduleDependencies?: { [id: string]: string[] }
}

export interface LanguageService {
    name: string
    exts: string[]
    desc?: string
    moduleSeparator?: string
    parseSingleLine?(context: ParseContext): ParseResult
    parse?(context: ParseContext): ParseResult
    getResolveCandidates?(f: string): string[]
}

export type DependencyInfo = {
    path2module: { [id: string]: string }
    module2path: { [id: string]: string }
    pathDependencies: { [id: string]: string[] }
    moduleDependencies: { [id: string]: string[] }
    moduleSeparator: string
}

export type DependencyData = {
    rawInfo: DependencyInfo,
    dependencies: { [id: string]: string[] },
    flatDependencies: [string, string][],
    contains: util.RecursiveObject,
    flatContains: [string, string][]
}