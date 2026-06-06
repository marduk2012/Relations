import { describe, it, expect } from "vitest";
import { resolveFrontmatterString } from "../src/graph";

/**
 * Tests for resolveFrontmatterString — the generic helper used by the three
 * node-badge slots (top-left icon, top-right icon, subtext) to extract a
 * trimmed string from a frontmatter property.
 *
 * The contract is intentionally narrow and consistent with resolveRingColor:
 *   - Empty property name → undefined (feature disabled)
 *   - Missing frontmatter / missing property → undefined
 *   - Array values → first element
 *   - Numbers/booleans → stringified
 *   - Whitespace trimmed
 *   - Empty after trim → undefined
 */

describe("resolveFrontmatterString", () => {
	it("returns undefined when the property name is empty", () => {
		expect(resolveFrontmatterString({ title: "Lord" }, "")).toBeUndefined();
	});

	it("returns undefined when the property name is only whitespace", () => {
		expect(resolveFrontmatterString({ title: "Lord" }, "   ")).toBeUndefined();
	});

	it("returns undefined when frontmatter is undefined", () => {
		expect(resolveFrontmatterString(undefined, "title")).toBeUndefined();
	});

	it("returns undefined when the property isn't set", () => {
		expect(resolveFrontmatterString({ other: "x" }, "title")).toBeUndefined();
	});

	it("returns the trimmed string for a normal property value", () => {
		expect(resolveFrontmatterString({ title: "  Lord of Whitehall  " }, "title"))
			.toBe("Lord of Whitehall");
	});

	it("returns the first element of an array-valued property", () => {
		expect(resolveFrontmatterString({ tags: ["lord", "noble"] }, "tags")).toBe("lord");
	});

	it("coerces numeric values to strings", () => {
		expect(resolveFrontmatterString({ level: 42 }, "level")).toBe("42");
	});

	it("coerces boolean values to strings", () => {
		expect(resolveFrontmatterString({ alive: true }, "alive")).toBe("true");
	});

	it("returns undefined for empty-string property value", () => {
		expect(resolveFrontmatterString({ title: "" }, "title")).toBeUndefined();
	});

	it("returns undefined for whitespace-only property value", () => {
		expect(resolveFrontmatterString({ title: "   " }, "title")).toBeUndefined();
	});

	it("returns undefined for null property value", () => {
		expect(resolveFrontmatterString({ title: null }, "title")).toBeUndefined();
	});

	it("returns undefined when property name has untrimmed whitespace but is otherwise blank", () => {
		// resolveFrontmatterString trims property name before lookup.
		expect(resolveFrontmatterString({ title: "Lord" }, "   ")).toBeUndefined();
	});

	it("preserves emoji content exactly", () => {
		// The primary use case for the icon slots.
		expect(resolveFrontmatterString({ weapon: "🗡️" }, "weapon")).toBe("🗡️");
	});

	it("handles multi-codepoint emoji content", () => {
		// Compound emoji with ZWJ and skin tones must survive the round trip.
		const flag = "🏴󠁧󠁢󠁳󠁣󠁴󠁿"; // Scotland flag, multiple codepoints
		expect(resolveFrontmatterString({ origin: flag }, "origin")).toBe(flag);
	});
});
