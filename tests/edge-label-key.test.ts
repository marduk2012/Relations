import { describe, it, expect } from "vitest";
import { edgeLabelKey } from "../src/types";

describe("edgeLabelKey", () => {
	it("preserves direction for asymmetric types", () => {
		// `parent` is asymmetric: A→B (A's parent is B) is distinct from B→A.
		expect(edgeLabelKey("alice", "parent", "bob", false))
			.toBe("alice__parent__bob");
		expect(edgeLabelKey("bob", "parent", "alice", false))
			.toBe("bob__parent__alice");
	});

	it("canonicalises direction for symmetric types", () => {
		// `enemy` is symmetric: a label set from either direction should resolve
		// to the same key, so the label appears on the edge regardless of which
		// note the user opened first.
		expect(edgeLabelKey("alice", "enemy", "bob", true))
			.toBe(edgeLabelKey("bob", "enemy", "alice", true));
	});

	it("sorts symmetric endpoints lexicographically", () => {
		// The exact format isn't part of the public contract, but the
		// alphabetically-earlier endpoint should appear first so the key is
		// deterministic across runs.
		expect(edgeLabelKey("zoe", "ally", "ada", true))
			.toBe("ada__ally__zoe");
	});

	it("includes the relationship type in the key", () => {
		// An `ally` label and an `enemy` label between the same two nodes are
		// distinct (rare in practice but a real possibility).
		expect(edgeLabelKey("a", "ally", "b", true))
			.not.toBe(edgeLabelKey("a", "enemy", "b", true));
	});

	it("handles vault paths as node ids", () => {
		// Node ids in this codebase are full vault paths, which can contain
		// slashes and spaces. The key should still be stable.
		expect(edgeLabelKey("People/Arthur.md", "spouse", "People/Guinevere.md", true))
			.toBe("People/Arthur.md__spouse__People/Guinevere.md");
	});
});
