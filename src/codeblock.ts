import { App, MarkdownPostProcessorContext, MarkdownRenderChild, parseYaml, TFile } from "obsidian";
import { Core } from "cytoscape";
import { RelationsSettings } from "./types";
import { buildFullGraph, buildLocalGraph, buildFamilyNeighborhood } from "./graph";
import { renderGraph } from "./render";
import type { GraphCache } from "./graph-cache";

export type EmbedSize = "mini" | "small" | "large";

interface CodeBlockOptions {
	size: EmbedSize;
	depth: number;
	center?: string;
	scope?: "local" | "full";
	tree?: boolean;
	familyGraph?: boolean;  // family view: generation-aligned positioning + Cytoscape
	                        // edges differentiated by relationship type (marriage solid,
	                        // informal partnership dotted, parent→child arrowed).
	                        // Centered on the active/host note's family neighbourhood.
	zoom?: number;
	height?: string;          // overrides the size's default height; e.g. "800px", "60vh"
	labels?: boolean;         // show note name under each node; overrides the global
	                          // showNodeLabels setting for this block only
}

const DEFAULTS: CodeBlockOptions = {
	size: "small",
	depth: 1,
	scope: "local",
};

/**
 * MarkdownRenderChild lets Obsidian manage lifecycle — onunload runs when the rendered
 * block is removed (note closed, switched to edit mode, etc.) so we can dispose Cytoscape.
 */
class RelationsBlockChild extends MarkdownRenderChild {
	private cy: Core | null = null;
	constructor(
		containerEl: HTMLElement,
		private app: App,
		private settings: RelationsSettings,
		private options: ParsedOptions,
		private sourcePath: string,
		private cache: GraphCache | null,
	) {
		super(containerEl);
	}

	onload(): void {
		this.render();
	}

	onunload(): void {
		this.cy?.destroy();
		this.cy = null;
	}

	private render(): void {
		const el = this.containerEl;
		el.empty();

		// Auto-detect: any callout ancestor (ITS infobox, plain callouts, fas-infobox, etc.)
		// gets the compact rendering treatment. The user can still override by explicitly
		// setting size: small or size: large, but if they didn't set a size at all and
		// the block is inside a callout, we promote them to mini.
		const insideCallout = isInsideCallout(el);
		let effectiveSize = this.options.size;
		if (insideCallout && !this.options.sizeExplicit) {
			effectiveSize = "mini";
		}

		// In mini mode, depth is always 1 — the canvas isn't big enough to show more
		// usefully, and the user explicitly asked for "direct neighbors only".
		const effectiveDepth = effectiveSize === "mini" ? 1 : this.options.depth;

		el.addClass("relations-embed");
		el.addClass(`is-${effectiveSize}`);
		if (insideCallout) el.addClass("in-callout");

		// Custom height overrides the size class. Both `height` and `min-height` get
		// set so the size class's min-height (which would otherwise enforce a floor
		// taller than what the user asked for) doesn't override us.
		if (this.options.height) {
			el.style.height = this.options.height;
			el.style.minHeight = this.options.height;
		}

		const canvas = el.createDiv({ cls: "relations-embed-canvas" });

		const hostPath = this.options.center ?? this.sourcePath;
		const hostFile = resolveHostFile(this.app, hostPath, this.sourcePath);

		let graph;
		let highlightId: string | undefined;

		// Family-tree and family-graph both focus on the host note specifically —
		// Family-graph mode focuses on the host note specifically — same logic as
		// the side-panel view: ignore scope/depth, build the host's family
		// neighbourhood. `scope: full` still works as an opt-out for users who
		// want the entire vault's family in one block.
		const useFamilyNeighbourhood = this.options.familyGraph && this.options.scope !== "full";

		if (useFamilyNeighbourhood) {
			if (!hostFile) {
				canvas.createDiv({ cls: "relations-empty", text: "Could not resolve host note for family view." });
				return;
			}
			graph = buildFamilyNeighborhood(this.app, this.settings, hostFile.path, this.cache);
			highlightId = hostFile.path;
		} else if (this.options.scope === "full") {
			graph = buildFullGraph(this.app, this.settings, this.cache);
		} else {
			if (!hostFile) {
				canvas.createDiv({ cls: "relations-empty", text: "Could not resolve host note for local graph." });
				return;
			}
			graph = buildLocalGraph(this.app, this.settings, hostFile.path, effectiveDepth, this.cache);
			highlightId = hostFile.path;
		}

		if (graph.nodes.length === 0) {
			canvas.createDiv({
				cls: "relations-empty",
				text: this.options.scope === "full"
					? "No connected notes found in vault."
					: "No relationships within the chosen depth.",
			});
			return;
		}

		this.cy = renderGraph({
			app: this.app,
			settings: this.settings,
			container: canvas,
			graph,
			highlightId,
			useTreeLayout: this.options.tree,
			familyGraph: this.options.familyGraph,
			compact: effectiveSize === "mini",
			zoomMultiplier: this.options.zoom,
			showLabels: this.options.labels,
		});

		// Legend — every size except mini, and only when settings.showLegend is on.
		// We only show entries for types that actually appear in the rendered graph,
		// so a graph with two relationship types doesn't display nine swatches.
		if (effectiveSize !== "mini" && this.settings.showLegend) {
			const usedTypes = new Set(graph.edges.map((e) => e.type));
			const visibleTypes = this.settings.relationshipTypes.filter((t) => usedTypes.has(t.name));
			if (visibleTypes.length > 0) {
				const legend = el.createDiv({ cls: "relations-legend" });
				renderLegend(legend, visibleTypes);
			}
		}
	}
}

/**
 * Build a legend strip of relationship types into `host`. Used by both code blocks
 * and the side-panel view (re-exported for view.ts to consume).
 */
/**
 * Render a legend listing relationship types with their color swatches and flags.
 * Writes legend items as children of `host`. The caller is responsible for any
 * outer container styling (e.g. `host.toggleClass("is-hidden", …)`).
 *
 * If `clear` is true, the host is emptied first — useful for re-rendering when
 * settings change. Code-block usage typically passes `false` because the host
 * is freshly created.
 */
export function renderLegend(
	host: HTMLElement,
	types: import("./types").RelationshipType[],
	clear = false,
): void {
	if (clear) host.empty();
	for (const t of types) {
		const item = host.createDiv({ cls: "relations-legend-item" });
		const swatch = item.createSpan({ cls: `relations-legend-swatch is-${t.lineStyle}` });
		// For dashed/dotted/double swatches, the visual is built with borders and
		// pseudo-elements in CSS — the color comes from a CSS custom property so a
		// single rule can reference it for foreground/background.
		swatch.style.setProperty("--swatch-color", t.color);
		let label = t.name;
		if (!t.symmetric) label += " →";
		if (t.pair) label += " ⚭";
		if (t.treeLayout) label += " ⊥";
		item.createSpan({ text: label });
	}
}

/**
 * Walk up the DOM looking for a callout ancestor. Obsidian wraps callouts in
 *   <div class="callout" data-callout="infobox">…</div>
 * and ITS / fas-infobox both use this same wrapper class. Other 3rd-party callouts
 * also use it, so this catches every callout-style host the plugin might land in.
 */
function isInsideCallout(el: HTMLElement): boolean {
	// Element.closest matches the receiver too, but the embed div itself is never
	// the callout — it's a child of one if anything — so this is fine.
	return el.closest(".callout") !== null;
}

export function processRelationsBlock(
	app: App,
	settings: RelationsSettings,
	source: string,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	cache: GraphCache | null = null,
): void {
	const options = parseOptions(source);
	const child = new RelationsBlockChild(el, app, settings, options, ctx.sourcePath, cache);
	ctx.addChild(child);
}

interface ParsedOptions extends CodeBlockOptions {
	sizeExplicit: boolean;
}

function parseOptions(source: string): ParsedOptions {
	let parsed: Record<string, unknown> = {};
	try {
		const raw = parseYaml(source);
		if (raw && typeof raw === "object") {
			parsed = raw as Record<string, unknown>;
		}
	} catch {
		// Allow malformed/empty blocks
	}

	const rawSize = parsed["size"];
	const sizeExplicit =
		rawSize === "mini" || rawSize === "small" || rawSize === "large";
	const size: EmbedSize = sizeExplicit ? (rawSize as EmbedSize) : "small";

	let depth = parsed["depth"] as number | undefined;
	if (typeof depth !== "number" || isNaN(depth)) {
		depth = size === "large" ? 3 : 1;
	}
	depth = Math.max(0, Math.min(6, Math.floor(depth)));

	const scope = parsed["scope"] === "full" ? "full" : "local";
	const tree = parsed["tree"] === true;
	// "family-graph" enables the family view: active-note focused, generation-aligned,
	// edges styled by relationship type (marriage solid, informal partnership dotted,
	// parent→child arrowed). Accept kebab-case (preferred) and camelCase aliases.
	const familyGraph = parsed["family-graph"] === true || parsed["familyGraph"] === true;
	const center = typeof parsed["center"] === "string" ? (parsed["center"] as string) : undefined;

	// labels: explicit true/false hides or shows note names for this block,
	// overriding the global setting. Undefined = inherit the setting.
	const labels = typeof parsed["labels"] === "boolean" ? (parsed["labels"] as boolean) : undefined;

	// Zoom: accept a number (1.4) or a string ending in "%" ("140%"). Out-of-range
	// values are clamped to a sensible window — going past 5x mostly hurts.
	let zoom: number | undefined;
	const rawZoom = parsed["zoom"];
	if (typeof rawZoom === "number" && isFinite(rawZoom)) {
		zoom = rawZoom;
	} else if (typeof rawZoom === "string") {
		const s = rawZoom.trim();
		const pct = s.endsWith("%") ? parseFloat(s.slice(0, -1)) / 100 : parseFloat(s);
		if (isFinite(pct)) zoom = pct;
	}
	if (zoom !== undefined) {
		zoom = Math.max(0.1, Math.min(5, zoom));
	}

	// Height: accept a number (pixels) or a CSS-style string ("800px", "60vh", "50%").
	// Plain numbers get "px" appended. Strings are validated to match a known unit
	// pattern — if the user types nonsense, we fall back to the size default.
	let height: string | undefined;
	const rawHeight = parsed["height"];
	if (typeof rawHeight === "number" && isFinite(rawHeight) && rawHeight > 0) {
		height = `${Math.floor(rawHeight)}px`;
	} else if (typeof rawHeight === "string") {
		const s = rawHeight.trim();
		if (/^\d+(\.\d+)?(px|em|rem|vh|vw|%)$/.test(s)) {
			height = s;
		} else if (/^\d+(\.\d+)?$/.test(s)) {
			// Bare number as string — treat as pixels.
			height = `${parseFloat(s)}px`;
		}
	}

	return { ...DEFAULTS, size, depth, scope, tree, familyGraph, center, zoom, height, labels, sizeExplicit };
}

function resolveHostFile(app: App, hostPath: string, sourcePath: string): TFile | null {
	const direct = app.vault.getAbstractFileByPath(hostPath);
	if (direct instanceof TFile) return direct;

	const stripped = hostPath.replace(/^\[\[|\]\]$/g, "");
	const resolved = app.metadataCache.getFirstLinkpathDest(stripped, sourcePath);
	if (resolved instanceof TFile) return resolved;

	const source = app.vault.getAbstractFileByPath(sourcePath);
	if (source instanceof TFile) return source;

	return null;
}
