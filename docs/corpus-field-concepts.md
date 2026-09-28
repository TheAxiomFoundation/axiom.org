# Corpus-field concepts

The /axiom landing and the graph launcher share one component — the corpus
field ([src/components/axiom/corpus-field.tsx](../src/components/axiom/corpus-field.tsx),
layout math in [src/lib/axiom/corpus-field.ts](../src/lib/axiom/corpus-field.ts))
— with its own internal vocabulary. This page names the nouns so a reader of
the code, or a contributor to it, doesn't have to reverse-engineer them.

## The field

The open world of every subgraph we serve. Every provision-rooted subtree
the live mirror lists renders as a dot on one pannable, zoomable canvas; a
committed snapshot supplies the sizes and stands in as the corpus when the
mirror is unreachable. Hovering a dot shows its citation.

## Dots

One dot per corpus module (a provision-rooted subtree). Radius grows with
the square root of the module's linked-rule count, capped so an intricate
subtree reads bigger without drowning the field. One-rule modules never
reach a view surface at all (`MIN_VIEW_RULE_COUNT`).

## Dust

Modules whose rules link to nothing corpus-wide (glossary-definition pages:
`linkedRuleCount` 0) render as minimal faint dust (`DUST_RADIUS`) — visible,
never highlighted, never eligible to be a door.

## Doors

Computed entry shortcuts into the field: the top subtrees ranked by size,
with imports weighted and a per-jurisdiction cap so no jurisdiction
monopolizes every door. Pinned doors ride along at their ranked position
outside the count — but dust and non-compiling roots stay banned even when
pinned, because a pin is a promise the door works.

## Clusters and halos

Dots group into jurisdiction clusters, each labeled (`US · Federal`,
`US · CO`). Halos are the faint circular territories drawn around clusters,
painted before the dots that live in them.

## Slabs

The list picker renders its rows in slabs — fixed-size windows
(`LIST_SLAB_SIZE`) appended as the reader scrolls past an
IntersectionObserver sentinel — so thousands of entries never render at
once ([src/components/axiom/graph-viewer/list-entries.ts](../src/components/axiom/graph-viewer/list-entries.ts)).

## Launcher modes

The graph launcher offers two ways to pick a subtree: the field (default)
or the list picker (search plus computed doors). The choice persists per
browser ([src/components/axiom/graph-viewer/launcher-mode.ts](../src/components/axiom/graph-viewer/launcher-mode.ts)).

## The compose viewer, and the journey

On the /axiom landing, clicking a dot or a door zooms the camera into its
territory and mounts the compose viewer in place over the field, with the
URL pushed to the real compose deep link so reload and the back button stay
honest; back unmounts the viewer and the camera pulls back out. Embedded as
the viewer's launcher, the field instead reports the pick to its host
(`onPick`) — the host is already the viewer, so there is no overlay and no
history push. Inside the viewer, the inspector
panel shows the selected rule with its immediate neighborhood
([src/components/axiom/graph-viewer/inspector-mini-graph.tsx](../src/components/axiom/graph-viewer/inspector-mini-graph.tsx));
Escape closes the topmost surface. Reduced-motion preferences skip the
camera animation.

## Where things live

The graph-viewer directory under
[src/components/axiom/graph-viewer/](../src/components/axiom/graph-viewer/)
carries a scoped copy of the standalone
[rulespec-graph-viewer](https://github.com/TheAxiomFoundation/rulespec-graph-viewer)
— see its [README](../src/components/axiom/graph-viewer/README.md) for the
vendoring relationship and the land-fixes-in-both expectation.
