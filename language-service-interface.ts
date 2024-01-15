import * as util from './util.ts'

export type PathFilters = {
    includeFilters: RegExp[],
    excludeFilters: RegExp[]
}

export type ParseContext = {
    pathFilters: PathFilters,
    rootDir: string,
    files: string[], // relative to rootDir
    file: string, // relative to rootDir
    subDir: string, // relative to rootDir
    ext: string,
    fileName: string,
    _privateFileContent: string,
    fileContent: () => string,
    lines: () => string[],
    nameResolver: (name: string) => string | null
    // deno-lint-ignore no-explicit-any
    languageOption: any,
    // deno-lint-ignore no-explicit-any
    debugOutput: (...data: any[]) => void
}
export type StringPair = [string, string]
export type Dependencies = {[id:string]: string[]}

export interface LanguageService {
    name: string
    desc?: string
    moduleSeparator?: string
    parse(context: ParseContext): Dependencies
    getResolveCandidates?(f: string): string[]
}

export type DependencyData = {
    dependencies: Dependencies,
    contains: util.RecursiveObject,
    flatDependencies: StringPair[],
    flatContains: StringPair[]
}
