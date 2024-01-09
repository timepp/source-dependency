import * as ut from "https://deno.land/std@0.203.0/assert/mod.ts"
import * as util from './util.ts'

Deno.test("util.findCycles", () => {
    const data = [
        ['a', 'b'], ['b', 'c'], ['c', 'a'],
        ['e', 'f'], ['f', 'e'],
        ['g', 'h'], ['h', 'i'], ['i', 'k'], ['k', 'a']
    ]
    ut.assertEquals(util.findCycleDependencies(data), [['a', 'b', 'c', 'a'], ['e', 'f', 'e']])
})

Deno.test('hierarchy', () => {
    let hierarchy = util.buildHierarchy(['a/b', 'a/b/d', 'a/e', 'f/g'], /\//g)
    ut.assertEquals(hierarchy, { a: { 'a/b': { 'a/b/d': {} }, 'a/e': {} }, f: { 'f/g': {} } })
    hierarchy = util.buildHierarchy(['@msteams/components-acc-def'], /[/-]/g)
    ut.assertEquals(hierarchy, { '@msteams': { '@msteams/components': { '@msteams/components-acc': {'@msteams/components-acc-def': {}}}}})
})
