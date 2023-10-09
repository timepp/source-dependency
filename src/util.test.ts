import * as util from './util'

test('hierarchy', () => {
  expect(util.buildHierarchy(['a/b', 'a/b/d', 'a/e', 'f/g'], '/')).toMatchObject({ a: { 'a/b': { 'a/b/d': null }, 'a/e': null }, f: { 'f/g': null } })
})
