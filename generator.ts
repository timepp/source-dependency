import * as util from './util.ts'
import { DependencyData } from './language-service-interface.ts'

const generatorRegistry: { [id: string]: [(data: DependencyData) => string, string] } = {
    dgml: [generateDGML, 'Directed Graph Markup Language, well supported by Visual Studio'],
    js: [generateJS, 'JavaScript'],
    dot: [generateDot, 'Graphviz DOT, commonly used in real world'],
    vis: [generateVisJs, 'A html visualization powered by vis.js'],
    plain: [generatePlain, 'Plain Text'],
    raw: [generateRaw, 'Raw JSON']
}

export function generateOutput(type: string, data: DependencyData) {
    const generator = generatorRegistry[type]
    if (!generator) {
        throw new Error(`Unknown output format: ${type}`)
    }
    return generator[0](data)
}

export function getAllGenerators() {
    return Object.keys(generatorRegistry).map(k => {
        return { name: k, description: generatorRegistry[k][1] }
    })
}

function generatePlain (data: DependencyData) {
    return data.flatDependencies.map(d => `${d[0]} -> ${d[1]}`).join('\n')
}

function generateRaw (data: DependencyData) {
    return JSON.stringify(data.rawInfo, null, 4)
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
    const getSubgraphStatements = function (obj: util.RecursiveObject, depth = 0) {
      if (obj === null) return []
      const arr: string[] = []
      for (const p in obj) {
        if (obj[p] === null) {
          arr.push('"' + p + '"')
        } else {
          const color = theme[depth % theme.length]
          arr.push('subgraph cluster_' + p.replace(/[^a-zA-Z0-9]/g, '_') + ' {')
          arr.push(`style="rounded"; bgcolor="${color}"`)
          arr.push(...getSubgraphStatements(obj[p]!, depth + 1))
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