import { describe, it, expect } from "vitest";
import cytoscape from "cytoscape";
import { applyGenerationLayout } from "../src/family-tree";
import type { GraphEdge, GraphNode, RelationsGraph } from "../src/types";

/**
 * Tests for the soft-adjacency step (9c) which pulls lover-only single-parent
 * units next to their anchor figure in the family-tree layout.
 *
 * The motivating scenario:
 *   - Wilhelm is married to Theodora (5 shared children).
 *   - Wilhelm has lovers Franziska and Helena (one child each).
 *   - Affair-child rule places Franziska's child under Franziska only,
 *     Helena's child under Helena only — both are single-parent units.
 *   - Without 9c, Franziska's unit and Helena's unit would be placed at the
 *     start of the partner row (because they're "root" units with no
 *     genealogical upstream), far from Wilhelm.
 *   - With 9c, they shift to slots immediately to the right of Wilhelm,
 *     stacked in the order they appear in the soft-adjacency map.
 */

function node(id: string): GraphNode {
	return { id, label: id, tags: [], image: null };
}

function genealogyEdge(child: string, parent: string): GraphEdge {
	return {
		source: child,
		target: parent,
		type: "parent",
		color: "#b45309",
		symmetric: false,
		pair: false,
		lineStyle: "solid",
		genealogy: true,
	};
}

function pairEdge(a: string, b: string, type: string = "spouse"): GraphEdge {
	return {
		source: a,
		target: b,
		type,
		color: "#d946ef",
		symmetric: true,
		pair: true,
		lineStyle: "double",
		genealogy: false,
	};
}

function loverEdge(a: string, b: string): GraphEdge {
	return {
		source: a,
		target: b,
		type: "lover",
		color: "#f472b6",
		symmetric: true,
		pair: false,
		lineStyle: "dashed",
		genealogy: false,
	};
}

function buildCy(graph: RelationsGraph): cytoscape.Core {
	const elements: cytoscape.ElementDefinition[] = [];
	for (const n of graph.nodes) {
		elements.push({ data: { id: n.id, label: n.label } });
	}
	for (const e of graph.edges) {
		elements.push({
			data: {
				id: `${e.source}__${e.type}__${e.target}`,
				source: e.source,
				target: e.target,
			},
		});
	}
	return cytoscape({ elements, headless: true });
}

function positions(cy: cytoscape.Core): Record<string, { x: number; y: number }> {
	const result: Record<string, { x: number; y: number }> = {};
	cy.nodes().forEach((n) => {
		result[n.id()] = n.position();
	});
	return result;
}

describe("soft-adjacency layout (lover positioning)", () => {
	it("places a lone lover adjacent to the anchor on the same row", () => {
		// Wilhelm has wife Theodora (one child Maria) and one lover Franziska
		// (one child John). After 9c, Franziska should sit at the same Y as
		// Wilhelm, to his right (informal partners go right per convention).
		const graph: RelationsGraph = {
			nodes: [
				node("Wilhelm"),
				node("Theodora"),
				node("Maria"),
				node("Franziska"),
				node("John"),
			],
			edges: [
				pairEdge("Wilhelm", "Theodora"),
				loverEdge("Wilhelm", "Franziska"),
				genealogyEdge("Maria", "Wilhelm"),
				genealogyEdge("Maria", "Theodora"),
				genealogyEdge("John", "Wilhelm"),
				genealogyEdge("John", "Franziska"),
			],
		};
		const cy = buildCy(graph);
		applyGenerationLayout(cy, graph);
		const p = positions(cy);
		// Same row as Wilhelm
		expect(p["Franziska"].y).toBe(p["Wilhelm"].y);
		// To Wilhelm's right
		expect(p["Franziska"].x).toBeGreaterThan(p["Wilhelm"].x);
	});

	it("keeps the lover's child directly beneath them after shifting", () => {
		// John's column should align with Franziska's column after 9c shifts
		// her to Wilhelm's right.
		const graph: RelationsGraph = {
			nodes: [
				node("Wilhelm"),
				node("Theodora"),
				node("Franziska"),
				node("John"),
			],
			edges: [
				pairEdge("Wilhelm", "Theodora"),
				loverEdge("Wilhelm", "Franziska"),
				genealogyEdge("John", "Wilhelm"),
				genealogyEdge("John", "Franziska"),
			],
		};
		const cy = buildCy(graph);
		applyGenerationLayout(cy, graph);
		const p = positions(cy);
		// John lives at Franziska's X, one generation lower
		expect(p["John"].x).toBeCloseTo(p["Franziska"].x, 0);
		expect(p["John"].y).toBeGreaterThan(p["Franziska"].y);
	});

	it("stacks multiple lovers to the right of the anchor in declaration order", () => {
		// Wilhelm has Theodora (wife), Franziska (lover, declared first), and
		// Helena (lover, declared second). Franziska should sit closer to
		// Wilhelm than Helena does. Both same row as Wilhelm.
		const graph: RelationsGraph = {
			nodes: [
				node("Wilhelm"),
				node("Theodora"),
				node("Franziska"),
				node("Helena"),
				node("John"),
				node("Alena"),
			],
			edges: [
				pairEdge("Wilhelm", "Theodora"),
				loverEdge("Wilhelm", "Franziska"),
				loverEdge("Wilhelm", "Helena"),
				genealogyEdge("John", "Wilhelm"),
				genealogyEdge("John", "Franziska"),
				genealogyEdge("Alena", "Wilhelm"),
				genealogyEdge("Alena", "Helena"),
			],
		};
		const cy = buildCy(graph);
		applyGenerationLayout(cy, graph);
		const p = positions(cy);
		// Both lovers on Wilhelm's row
		expect(p["Franziska"].y).toBe(p["Wilhelm"].y);
		expect(p["Helena"].y).toBe(p["Wilhelm"].y);
		// Both to Wilhelm's right
		expect(p["Franziska"].x).toBeGreaterThan(p["Wilhelm"].x);
		expect(p["Helena"].x).toBeGreaterThan(p["Wilhelm"].x);
		// Franziska closer than Helena (declared first → first slot)
		expect(p["Franziska"].x).toBeLessThan(p["Helena"].x);
		// Each child directly below their mother
		expect(p["John"].x).toBeCloseTo(p["Franziska"].x, 0);
		expect(p["Alena"].x).toBeCloseTo(p["Helena"].x, 0);
	});

	it("does not move a paired-couple unit that happens to also be lovers", () => {
		// Edge case: if A and B are flagged both as spouses (pair) AND lovers
		// (symmetric non-pair), the pair flag wins — they're treated as a
		// married couple, not adjusted by 9c. The soft-adjacency step skips
		// pair edges entirely when building its adjacency map.
		const graph: RelationsGraph = {
			nodes: [node("A"), node("B"), node("Kid")],
			edges: [
				pairEdge("A", "B"),
				loverEdge("A", "B"), // redundant declaration, should be ignored by softAdjacency
				genealogyEdge("Kid", "A"),
				genealogyEdge("Kid", "B"),
			],
		};
		const cy = buildCy(graph);
		applyGenerationLayout(cy, graph);
		const p = positions(cy);
		// Kid still has both parents (no affair rule fires — they're paired)
		// and sits below them; A and B are at the same y.
		expect(p["A"].y).toBe(p["B"].y);
		expect(p["Kid"].y).toBeGreaterThan(p["A"].y);
	});

	it("does not adjust lovers that have their own family with their own spouse", () => {
		// Lover with a spouse of their own — has a 2-parent unit, not a
		// single-parent unit. 9c only repositions single-parent units, so
		// this case is left alone (it's handled by the existing multi-marriage
		// fallback in step 9b).
		const graph: RelationsGraph = {
			nodes: [
				node("Wilhelm"),
				node("Theodora"),
				node("Franziska"),
				node("Otho"),
				node("John"),
				node("Sara"),
			],
			edges: [
				pairEdge("Wilhelm", "Theodora"),
				pairEdge("Franziska", "Otho"),
				loverEdge("Wilhelm", "Franziska"),
				// John = Wilhelm + Franziska (affair child, both married elsewhere)
				genealogyEdge("John", "Wilhelm"),
				genealogyEdge("John", "Franziska"),
				// Sara = Franziska + Otho (Franziska's marriage child)
				genealogyEdge("Sara", "Franziska"),
				genealogyEdge("Sara", "Otho"),
			],
		};
		const cy = buildCy(graph);
		applyGenerationLayout(cy, graph);
		const p = positions(cy);
		// Franziska is married to Otho — they're a pair-unit. The lover
		// signal shouldn't override their married placement.
		expect(p["Franziska"].y).toBe(p["Otho"].y);
	});

	it("clears the anchor's married-child subtree before placing the lover", () => {
		// Regression: previously the lover was placed at anchor.x + spouseGap,
		// which collided with the right side of the anchor's bottom row when
		// the anchor had a child with their own spouse (e.g. Elisabeth +
		// Theodal Laurel sitting at the right edge of Wilhelm + Theodora's
		// kids). The lover's child column would land on top of that married
		// spouse's column. Fix: place the lover past the entire anchor
		// subtree's right edge.
		const graph: RelationsGraph = {
			nodes: [
				node("Wilhelm"),
				node("Theodora"),
				node("Elisabeth"),       // Wilhelm+Theodora's child
				node("Theodal"),         // Elisabeth's husband
				node("Franziska"),       // Wilhelm's lover
				node("John"),            // Franziska + Wilhelm child
			],
			edges: [
				pairEdge("Wilhelm", "Theodora"),
				pairEdge("Elisabeth", "Theodal"),
				loverEdge("Wilhelm", "Franziska"),
				genealogyEdge("Elisabeth", "Wilhelm"),
				genealogyEdge("Elisabeth", "Theodora"),
				genealogyEdge("John", "Wilhelm"),
				genealogyEdge("John", "Franziska"),
			],
		};
		const cy = buildCy(graph);
		applyGenerationLayout(cy, graph);
		const p = positions(cy);
		// John must not collide horizontally with Theodal — they're on the
		// same row (one generation below Wilhelm) and need clearance.
		const NODE_CLEARANCE = 100; // any value less than spouseGap or nodeWidth would indicate overlap
		expect(Math.abs(p["John"].x - p["Theodal"].x)).toBeGreaterThan(NODE_CLEARANCE);
		// Franziska likewise must clear Theodal's column on the partner row.
		// (Both Franziska and Theodal aren't strictly on the same row — Franziska
		// is on the partner row, Theodal is on the child row — but Franziska's
		// X is what determines John's X, so the same check via John suffices.)
	});

	it("places affair child's spouse on the correct generation row", () => {
		// Scenario: Wilhelm (gen 2) and his lover Franziska (gen 0) had a
		// daughter Elisabeth (an affair child). Elisabeth married Theodal
		// Laurel. Elisabeth + Theodal should appear on the row below Wilhelm
		// (gen 3), shifted right under Franziska — not on the row below
		// Franziska's natural gen-0 placement (which would put them at gen 1,
		// above Wilhelm).
		//
		// The bug this guards against: when the affair rule drops Wilhelm
		// from Elisabeth's effective parents, Elisabeth would inherit only
		// Franziska's gen-0 anchor and end up at gen 1 — above where her
		// father Wilhelm sits. Fix: generation propagation uses raw declared
		// parents (both), while layout grouping uses the affair-filtered set.
		const graph: RelationsGraph = {
			nodes: [
				node("Joseph"), node("Mathilda"),   // gen 0
				node("Friedhelm"), node("Angelika"), // gen 1
				node("Wilhelm"), node("Theodora"),   // gen 2
				node("Franziska"),                   // gen 0 (no parents)
				node("Elisabeth"), node("Theodal"),  // gen 3
			],
			edges: [
				pairEdge("Joseph", "Mathilda"),
				pairEdge("Angelika", "Friedhelm"),
				pairEdge("Wilhelm", "Theodora"),
				pairEdge("Elisabeth", "Theodal"),
				loverEdge("Wilhelm", "Franziska"),
				genealogyEdge("Friedhelm", "Joseph"),
				genealogyEdge("Friedhelm", "Mathilda"),
				genealogyEdge("Wilhelm", "Friedhelm"),
				genealogyEdge("Wilhelm", "Angelika"),
				// Elisabeth is daughter of Wilhelm + Franziska (affair child)
				genealogyEdge("Elisabeth", "Wilhelm"),
				genealogyEdge("Elisabeth", "Franziska"),
			],
		};
		const cy = buildCy(graph);
		applyGenerationLayout(cy, graph);
		const p = positions(cy);
		// Elisabeth's Y must be greater than Wilhelm's (Elisabeth is gen 3,
		// Wilhelm is gen 2 — i.e. Elisabeth is BELOW Wilhelm in the tree).
		expect(p["Elisabeth"].y).toBeGreaterThan(p["Wilhelm"].y);
		// And Theodal sits on the same row as Elisabeth (her spouse).
		expect(p["Theodal"].y).toBe(p["Elisabeth"].y);
		// Franziska sits on Wilhelm's row (soft-adjacency pulled her there).
		expect(p["Franziska"].y).toBe(p["Wilhelm"].y);
	});
});
