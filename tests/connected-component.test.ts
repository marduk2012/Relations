import { describe, it, expect } from "vitest";
import { connectedComponent } from "../src/graph";
import type { GraphEdge, GraphNode, RelationsGraph } from "../src/types";

/**
 * Tests for the connected-component scope, exposed to users as
 * `scope: connected` in a relations code block.
 *
 * The semantics: starting from a focus note, include every note reachable
 * via any edge (in either direction). Stop when no new nodes are found.
 * Edges between included nodes are kept; edges to outsiders are dropped.
 *
 * This sits between `local` (N-hop bounded) and `full` (entire vault) —
 * it shows the whole connected component containing the focus, no more.
 */

function node(id: string): GraphNode {
	return { id, label: id, tags: [], image: null };
}

function edge(source: string, target: string, type = "knows"): GraphEdge {
	return {
		source, target, type,
		color: "#888",
		symmetric: true,
		pair: false,
		lineStyle: "solid",
		genealogy: false,
	};
}

describe("connectedComponent", () => {
	it("returns the whole graph when everything is connected to the focus", () => {
		const graph: RelationsGraph = {
			nodes: [node("A"), node("B"), node("C")],
			edges: [edge("A", "B"), edge("B", "C")],
		};
		const out = connectedComponent(graph, "A");
		expect(out.nodes.map((n) => n.id).sort()).toEqual(["A", "B", "C"]);
		expect(out.edges.length).toBe(2);
	});

	it("excludes nodes in a disconnected component", () => {
		// Two unconnected clusters. From A we should only see A's cluster.
		const graph: RelationsGraph = {
			nodes: [node("A"), node("B"), node("X"), node("Y")],
			edges: [edge("A", "B"), edge("X", "Y")],
		};
		const out = connectedComponent(graph, "A");
		expect(out.nodes.map((n) => n.id).sort()).toEqual(["A", "B"]);
		expect(out.edges.length).toBe(1);
		expect(out.edges[0].source === "A" || out.edges[0].target === "A").toBe(true);
	});

	it("walks edges in both directions (treats edges as undirected)", () => {
		// Directed edges from B → A only. Starting at A we should still reach B
		// because the connected-component walk is undirected.
		const graph: RelationsGraph = {
			nodes: [node("A"), node("B")],
			edges: [{ ...edge("B", "A"), symmetric: false }],
		};
		const out = connectedComponent(graph, "A");
		expect(out.nodes.map((n) => n.id).sort()).toEqual(["A", "B"]);
	});

	it("follows arbitrarily long chains (no hop limit)", () => {
		// Single linear chain A → B → C → D → E. From A we should reach E.
		const graph: RelationsGraph = {
			nodes: [node("A"), node("B"), node("C"), node("D"), node("E")],
			edges: [
				edge("A", "B"), edge("B", "C"), edge("C", "D"), edge("D", "E"),
			],
		};
		const out = connectedComponent(graph, "A");
		expect(out.nodes.map((n) => n.id).sort()).toEqual(["A", "B", "C", "D", "E"]);
	});

	it("ignores edge type when walking — any edge counts as a connection", () => {
		// Different edge types (parent, spouse, friend) all contribute.
		const graph: RelationsGraph = {
			nodes: [node("Wilhelm"), node("Franziska"), node("John"), node("Schoolmate")],
			edges: [
				edge("Wilhelm", "Franziska", "lover"),
				edge("John", "Franziska", "parent"),
				edge("John", "Schoolmate", "friend"),
			],
		};
		const out = connectedComponent(graph, "Wilhelm");
		// Walking lover → Franziska → parent → John → friend → Schoolmate
		expect(out.nodes.map((n) => n.id).sort()).toEqual(["Franziska", "John", "Schoolmate", "Wilhelm"]);
	});

	it("returns just the center when it has no edges", () => {
		// Note exists but has no relationships — should return just that note.
		const graph: RelationsGraph = {
			nodes: [node("Loner"), node("OtherA"), node("OtherB")],
			edges: [edge("OtherA", "OtherB")],
		};
		const out = connectedComponent(graph, "Loner");
		expect(out.nodes.map((n) => n.id)).toEqual(["Loner"]);
		expect(out.edges).toEqual([]);
	});

	it("returns empty when the center isn't in the graph at all", () => {
		// Defensive: the function shouldn't synthesize a node for a missing center.
		const graph: RelationsGraph = {
			nodes: [node("A"), node("B")],
			edges: [edge("A", "B")],
		};
		const out = connectedComponent(graph, "NotInGraph");
		expect(out.nodes).toEqual([]);
		expect(out.edges).toEqual([]);
	});

	it("preserves edges between included nodes but drops cross-boundary edges", () => {
		// Edge from A (in component) to X (not in component) is impossible by
		// definition — but the filter must not include an edge whose other end
		// got excluded somehow. Construct a graph where the filter logic matters:
		// here every edge is between nodes in the same component, so all stay.
		const graph: RelationsGraph = {
			nodes: [node("A"), node("B"), node("C"), node("X")],
			edges: [edge("A", "B"), edge("B", "C")],
		};
		const out = connectedComponent(graph, "A");
		expect(out.nodes.map((n) => n.id).sort()).toEqual(["A", "B", "C"]);
		expect(out.edges.length).toBe(2);
		// X has no incoming or outgoing edges → not reachable → excluded
		expect(out.nodes.some((n) => n.id === "X")).toBe(false);
	});

	it("handles a focus node that connects two otherwise-separate groups", () => {
		// A bridges {B, C} and {X, Y}. Starting from A pulls in everyone.
		// Starting from B without A's bridge would only see {A, B, C, X, Y}.
		const graph: RelationsGraph = {
			nodes: [node("A"), node("B"), node("C"), node("X"), node("Y")],
			edges: [
				edge("A", "B"), edge("B", "C"),
				edge("A", "X"), edge("X", "Y"),
			],
		};
		const out = connectedComponent(graph, "A");
		expect(out.nodes.map((n) => n.id).sort()).toEqual(["A", "B", "C", "X", "Y"]);
	});
});
