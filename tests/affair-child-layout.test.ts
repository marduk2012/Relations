import { describe, it, expect } from "vitest";
import { computeEffectiveParents } from "../src/family-parenting";
import type { GraphEdge, RelationsGraph } from "../src/types";

/**
 * Tests for the affair-child layout helper. The function answers a single
 * question: when a child has two declared parents, which subset should drive
 * the family-tree spatial layout?
 *
 * The bar to clear:
 *   - Married couples' children: both parents preserved (current behaviour).
 *   - Affair scenarios (one parent has a different spouse, the other does
 *     not): drop the married-elsewhere parent — child lays out under the
 *     unmarried parent only.
 *   - Ambiguous scenarios (both married elsewhere, or neither married):
 *     don't try to guess; preserve both parents.
 */

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
		color: "#a855f7",
		symmetric: true,
		pair: true,
		lineStyle: "double",
		genealogy: false,
	};
}

function graphOf(edges: GraphEdge[]): RelationsGraph {
	return { nodes: [], edges };
}

describe("computeEffectiveParents", () => {
	it("preserves both parents when they are married to each other", () => {
		// Standard nuclear family: Maria's parents Wilhelm and Theodora are spouses.
		const g = graphOf([
			pairEdge("Wilhelm", "Theodora"),
			genealogyEdge("Maria", "Wilhelm"),
			genealogyEdge("Maria", "Theodora"),
		]);
		const out = computeEffectiveParents(g);
		expect(out.get("Maria")!.sort()).toEqual(["Theodora", "Wilhelm"]);
	});

	it("drops the married-elsewhere parent in a classic affair scenario", () => {
		// Wilhelm is married to Theodora. He has a child John with Franziska,
		// who has no other partner. John should appear under Franziska only.
		const g = graphOf([
			pairEdge("Wilhelm", "Theodora"),
			genealogyEdge("John", "Wilhelm"),
			genealogyEdge("John", "Franziska"),
		]);
		const out = computeEffectiveParents(g);
		expect(out.get("John")).toEqual(["Franziska"]);
	});

	it("works symmetrically when the lover is listed first", () => {
		// Same scenario but declared in reverse order. The helper must not
		// depend on the order parents appear in the genealogy edges.
		const g = graphOf([
			pairEdge("Wilhelm", "Theodora"),
			genealogyEdge("John", "Franziska"),
			genealogyEdge("John", "Wilhelm"),
		]);
		const out = computeEffectiveParents(g);
		expect(out.get("John")).toEqual(["Franziska"]);
	});

	it("handles multiple lovers of the same person independently", () => {
		// Wilhelm + Theodora are married. Wilhelm also has a child with
		// Franziska AND a child with Helena. Each lover-child should appear
		// under their respective mother only.
		const g = graphOf([
			pairEdge("Wilhelm", "Theodora"),
			genealogyEdge("John", "Wilhelm"),
			genealogyEdge("John", "Franziska"),
			genealogyEdge("Alena", "Wilhelm"),
			genealogyEdge("Alena", "Helena"),
		]);
		const out = computeEffectiveParents(g);
		expect(out.get("John")).toEqual(["Franziska"]);
		expect(out.get("Alena")).toEqual(["Helena"]);
	});

	it("preserves both parents when neither is married to anyone", () => {
		// Co-parents with no declared marriages — informal partnership.
		// Both parents preserved so the existing informal-partnership
		// synthesis can render its dashed bar between them.
		const g = graphOf([
			genealogyEdge("Mira", "Adric"),
			genealogyEdge("Mira", "Borin"),
		]);
		const out = computeEffectiveParents(g);
		expect(out.get("Mira")!.sort()).toEqual(["Adric", "Borin"]);
	});

	it("preserves both parents when both are married to other people", () => {
		// Both Wilhelm (married to Theodora) and Helena (married to Otho) have
		// a child together. No clean "lover anchor" — render both parents and
		// let the user see the awkward reality of the data.
		const g = graphOf([
			pairEdge("Wilhelm", "Theodora"),
			pairEdge("Helena", "Otho"),
			genealogyEdge("Alena", "Wilhelm"),
			genealogyEdge("Alena", "Helena"),
		]);
		const out = computeEffectiveParents(g);
		expect(out.get("Alena")!.sort()).toEqual(["Helena", "Wilhelm"]);
	});

	it("preserves children with a single declared parent", () => {
		// Single-parent children are passed through; nothing to disambiguate.
		const g = graphOf([
			pairEdge("Wilhelm", "Theodora"),
			genealogyEdge("Orphan", "Wilhelm"),
		]);
		const out = computeEffectiveParents(g);
		expect(out.get("Orphan")).toEqual(["Wilhelm"]);
	});

	it("treats children of unpaired co-parents as affair-children when one has a spouse", () => {
		// Wilhelm is married, Franziska is single. Even without an explicit
		// `lover` edge between Wilhelm and Franziska, the affair-child rule
		// fires because the lover/non-lover distinction is structural (one
		// has a spouse-elsewhere, one does not).
		const g = graphOf([
			pairEdge("Wilhelm", "Theodora"),
			genealogyEdge("John", "Wilhelm"),
			genealogyEdge("John", "Franziska"),
		]);
		const out = computeEffectiveParents(g);
		// The rule does not actually require an explicit `lover` edge — the
		// structural signal (Wilhelm has another spouse, Franziska does not)
		// is sufficient. This is by design.
		expect(out.get("John")).toEqual(["Franziska"]);
	});

	it("ignores children with no parents", () => {
		// Founders and orphans have no parent edges; helper should produce
		// no entry for them (caller treats missing as 'no parents').
		const g = graphOf([pairEdge("Wilhelm", "Theodora")]);
		const out = computeEffectiveParents(g);
		expect(out.has("Wilhelm")).toBe(false);
		expect(out.has("Theodora")).toBe(false);
	});

	it("does not invent parents from pair edges alone", () => {
		// A pair edge between two people who have no children should not
		// produce a parent map entry.
		const g = graphOf([pairEdge("A", "B")]);
		const out = computeEffectiveParents(g);
		expect(out.size).toBe(0);
	});
});
