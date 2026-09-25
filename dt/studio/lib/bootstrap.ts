import { type AnyNodeDefinition, nodeRegistry, registerNode } from '@pascal-app/core'
import { builtinPlugin } from '@pascal-app/nodes'

// Registers the built-in node kinds synchronously at import time so the first
// render already sees a populated registry. The `has` guard keeps it idempotent
// under HMR, where this module re-runs but the core registry singleton persists.
for (const def of builtinPlugin.nodes ?? []) {
  const node = def as AnyNodeDefinition
  if (!nodeRegistry.has(node.kind)) registerNode(node)
}
