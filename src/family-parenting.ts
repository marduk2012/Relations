import { RelationsGraph } from "./types";

/**
 * For each child node, computes the set of parents that should drive the
 * family-tree layout — which may be a subset of their declared genealogical
 * parents.
 *
 * The motivation is to keep family-tree views readable when a person has
 * children with multiple partners. A common scenario:
 *
 *   Wilhelm — partner — Theodora                  (5 children together)
 *      \— lover — Franziska Druskin             (1 child: John)
 *       \— lover — Helena Sparr                 (1 child: Alena)
 *
 * John's frontmatter declares `eltern: [Wilhelm, Franziska]`. If the layout
 * tries to place John below BOTH parents simultaneously, Franziska gets
 * dragged adjacent to Wilhelm (already occupied by Theodora) and the
 * connectors snake across the chart.
 *
 * Instead: when a child's two parents include exactly one "spouse-having"
 * parent whose spouse is NOT the other parent — i.e. a clear affair signal —
 * we drop the spouse-having parent from the layout-effective parent set. The
 * child renders as a single-parent child of the lover. The lover sits on the
 * partner row connected by a dashed lover edge to the spouse-having parent;
 * her child drops directly below her in a clean vertical line.
 *
 * The biological parenthood data (both parent edges) is preserved in the
 * graph and still rendered as Cytoscape edges — we only suppress one parent
 * from the orthogonal SVG overlay's layout planning, not from the data.
 *
 * Rules:
 *   - Children with 0 or 1 parents: pass through unchanged.
 *   - Children with 2 parents who are paired (married/partnered to each
 *     other): pass through unchanged. Standard nuclear-family layout.
 *   - Children with 2 parents who are NOT paired to each other, and exactly
 *     ONE of those parents has a pair edge to someone else: the unpaired
 *     parent becomes the sole effective parent. (Affair-child rule.)
 *   - Children with 2 parents who are NOT paired and where BOTH parents have
 *     other spouses: pass through unchanged. No clean "lover anchor"; better
 *     to let the layout show the awkward truth than guess wrong.
 *   - Children with 2 parents who are NOT paired and NEITHER has any pair:
 *     pass through. Treated as informal partnership (existing behaviour).
 *   - Children with 3+ parents: pass through. Should not happen in practice;
 *     the data model isn't designed for it.
 */
export function computeEffectiveParents(graph: RelationsGraph): Map<string, string[]> {
	// Pair adjacency: who is paired with whom (symmetric).
	const pairsOf = new Map<string, Set<string>>();
	for (const e of graph.edges) {
		if (!e.pair) continue;
		if (!pairsOf.has(e.source)) pairsOf.set(e.source, new Set());
		if (!pairsOf.has(e.target)) pairsOf.set(e.target, new Set());
		pairsOf.get(e.source)!.add(e.target);
		pairsOf.get(e.target)!.add(e.source);
	}

	// Raw parent map from genealogy edges (child → list of parents).
	// Genealogy edges always go child → parent, per the data convention.
	const rawParentsOf = new Map<string, string[]>();
	for (const e of graph.edges) {
		if (!e.genealogy) continue;
		if (!rawParentsOf.has(e.source)) rawParentsOf.set(e.source, []);
		rawParentsOf.get(e.source)!.push(e.target);
	}

	const effective = new Map<string, string[]>();
	for (const [child, parents] of rawParentsOf) {
		if (parents.length !== 2) {
			effective.set(child, parents);
			continue;
		}
		const [a, b] = parents;
		const aPairs = pairsOf.get(a) ?? new Set();
		const bPairs = pairsOf.get(b) ?? new Set();

		// Parents paired with each other → standard nuclear family, keep both.
		if (aPairs.has(b)) {
			effective.set(child, parents);
			continue;
		}

		// Look for pair-to-someone-else signal on each side.
		const aHasOtherSpouse = aPairs.size > 0;
		const bHasOtherSpouse = bPairs.size > 0;

		if (aHasOtherSpouse && !bHasOtherSpouse) {
			// A is married to someone else; B is the lover. Drop A.
			effective.set(child, [b]);
		} else if (bHasOtherSpouse && !aHasOtherSpouse) {
			// B is married to someone else; A is the lover. Drop B.
			effective.set(child, [a]);
		} else {
			// Either both married to other people, or neither married — pass through.
			effective.set(child, parents);
		}
	}
	return effective;
}
