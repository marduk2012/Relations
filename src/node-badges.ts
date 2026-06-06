import { Core, NodeSingular } from "cytoscape";

/**
 * Node badges: small DOM overlays pinned to each node's corners and below it,
 * driven by frontmatter through three configurable property names (top-left
 * icon, top-right icon, subtext).
 *
 * Why DOM overlay rather than the Cytoscape stylesheet:
 *   - Cytoscape gives one label and one background image per node. Three
 *     independently positioned badge slots can't be expressed in that model
 *     without compromise. A DOM layer above the canvas can position anything
 *     anywhere and supports any text styling (italics for subtext, etc.).
 *   - DOM emoji rendering is reliable; canvas-based emoji rendering can be
 *     inconsistent across browsers and platforms.
 *
 * Trade-offs we accept:
 *   - The overlay must redraw on every pan/zoom/node-move event to stay
 *     pinned. We use requestAnimationFrame coalescing inside the redraw
 *     handler to avoid thrashing when many events fire close together.
 *   - DOM nodes don't scale with Cytoscape's zoom. Badges stay constant
 *     screen-size as the user zooms in or out. This is what we want for
 *     readability — emojis at 8px aren't useful — but it does mean the
 *     visual relationship between badge and node changes with zoom.
 *
 * Empty content is the explicit "skip this slot" signal. A node with no
 * topLeftIcon / topRightIcon / subtext gets no DOM nodes at all, keeping the
 * overlay minimal even on large graphs where most nodes have no badges.
 */

/**
 * Set up the badge overlay layer on top of an existing Cytoscape instance.
 * Returns a redraw function the caller can invoke when something has changed
 * that isn't a viewport event (e.g. the host note for the highlight changed,
 * or a different `showLabels` setting is being applied).
 *
 * Pass `enabled = false` to disable the overlay entirely. The overlay's DOM
 * gets emptied and event listeners removed; callers swapping modes can call
 * this with the appropriate enabled state without reinstantiating.
 */
export function setupNodeBadges(
	cy: Core,
	container: HTMLElement,
	enabled: boolean,
): () => void {
	// Find or create the overlay container. The host element is the same
	// container Cytoscape renders into — we lay our own absolute-positioned
	// div over it so badges sit on top of the canvas.
	let overlay = container.querySelector(
		":scope > .relations-node-badges",
	) as HTMLDivElement | null;
	if (!overlay) {
		overlay = document.createElement("div");
		overlay.className = "relations-node-badges";
		Object.assign(overlay.style, {
			position: "absolute",
			inset: "0",
			pointerEvents: "none",
			// Above the canvas (z-index 0) but below the family-connectors
			// SVG overlay (which renders link labels users can click).
			zIndex: "5",
			overflow: "hidden",
		});
		// Cytoscape's container needs to be positioned for our absolute
		// overlay to land in the right coordinate space. If it's already
		// positioned (the parent CSS handles this), getComputedStyle returns
		// the right value; if not, we set it here defensively.
		const cs = window.getComputedStyle(container);
		if (cs.position === "static") {
			container.style.position = "relative";
		}
		container.appendChild(overlay);
	}

	if (!enabled) {
		overlay.innerHTML = "";
		return () => {
			/* disabled mode — no-op redraw */
		};
	}

	// One badge-group div per node id. We reuse divs across redraws to avoid
	// the GC churn of recreating every frame; only content changes touch DOM.
	const groups = new Map<string, BadgeGroup>();

	function ensureGroup(nodeId: string): BadgeGroup {
		const existing = groups.get(nodeId);
		if (existing) return existing;
		const el = document.createElement("div");
		el.className = "relations-node-badge-group";
		Object.assign(el.style, {
			position: "absolute",
			pointerEvents: "none",
			// We position each child relative to the group; the group itself
			// sits at the node's centre in screen coordinates.
			left: "0",
			top: "0",
		});

		const tl = makeBadgeSpan("top-left");
		const tr = makeBadgeSpan("top-right");
		const sub = makeSubtextSpan();

		el.appendChild(tl);
		el.appendChild(tr);
		el.appendChild(sub);
		overlay!.appendChild(el);

		const group: BadgeGroup = { el, tl, tr, sub, lastContent: "" };
		groups.set(nodeId, group);
		return group;
	}

	function redraw() {
		if (!overlay) return;
		const seen = new Set<string>();
		// Read zoom once per frame so every badge in this pass uses the same
		// value. Cytoscape's zoom is stable during a frame but accessing it
		// per-node would be wasteful.
		const zoom = cy.zoom();
		cy.nodes().forEach((node) => {
			const tlText = (node.data("topLeftIcon") as string) || "";
			const trText = (node.data("topRightIcon") as string) || "";
			const subText = (node.data("subtext") as string) || "";
			// Skip nodes with no content entirely — no DOM allocated for them.
			if (!tlText && !trText && !subText) {
				const stale = groups.get(node.id());
				if (stale) {
					stale.el.remove();
					groups.delete(node.id());
				}
				return;
			}
			seen.add(node.id());
			const g = ensureGroup(node.id());

			// Update text only if changed — avoid touching DOM when nothing
			// substantive moved between frames.
			const contentSig = `${tlText}|${trText}|${subText}`;
			if (g.lastContent !== contentSig) {
				g.tl.textContent = tlText;
				g.tr.textContent = trText;
				g.sub.textContent = subText;
				// Show/hide each individually based on content.
				g.tl.style.display = tlText ? "inline-block" : "none";
				g.tr.style.display = trText ? "inline-block" : "none";
				g.sub.style.display = subText ? "block" : "none";
				g.lastContent = contentSig;
			}

			positionGroup(g, node, zoom);
		});

		// GC any groups whose nodes are no longer in the graph (e.g. after a
		// scope change replaced the elements).
		for (const [id, group] of groups) {
			if (!seen.has(id)) {
				group.el.remove();
				groups.delete(id);
			}
		}
	}

	// Coalesce repeated redraw triggers (pan + zoom + position fire together
	// during layout settle) into one rAF tick. Without this we'd do dozens
	// of redraw passes during a single layout animation frame.
	let rafScheduled = false;
	function scheduleRedraw() {
		if (rafScheduled) return;
		rafScheduled = true;
		requestAnimationFrame(() => {
			rafScheduled = false;
			redraw();
		});
	}

	cy.on("pan zoom resize render", scheduleRedraw);
	cy.on("position", "node", scheduleRedraw);
	cy.on("add remove", "node", scheduleRedraw);
	cy.on("data", "node", scheduleRedraw);
	// Layout completion isn't a position event for every node — explicitly
	// listen for it so badges settle into final position when a layout finishes.
	cy.on("layoutstop", scheduleRedraw);

	// Initial paint.
	scheduleRedraw();

	return scheduleRedraw;
}

interface BadgeGroup {
	el: HTMLDivElement;
	tl: HTMLSpanElement;  // top-left icon
	tr: HTMLSpanElement;  // top-right icon
	sub: HTMLSpanElement; // subtext below the node
	lastContent: string;  // signature of last-rendered text content (cheap dirty check)
}

function makeBadgeSpan(corner: "top-left" | "top-right"): HTMLSpanElement {
	const el = document.createElement("span");
	el.className = `relations-node-badge relations-node-badge-${corner}`;
	Object.assign(el.style, {
		position: "absolute",
		// Lift each badge into a small pill so it reads cleanly against the
		// portrait or background. Sized to comfortably hold an emoji or a
		// short abbreviation.
		display: "inline-block",
		fontSize: "14px",
		lineHeight: "1",
		padding: "2px 4px",
		borderRadius: "8px",
		// Use a subtle background pill so the badge is legible against any
		// node colour. var() picks up Obsidian's theme variables — works in
		// light and dark themes without manual tweaking.
		background: "var(--background-primary, #ffffff)",
		border: "1px solid var(--background-modifier-border, #888)",
		color: "var(--text-normal, #000)",
		whiteSpace: "nowrap",
		// Hidden until first redraw assigns content.
		visibility: "visible",
	});
	return el;
}

function makeSubtextSpan(): HTMLSpanElement {
	const el = document.createElement("span");
	el.className = "relations-node-badge relations-node-subtext";
	Object.assign(el.style, {
		position: "absolute",
		display: "block",
		fontSize: "11px",
		fontStyle: "italic",
		lineHeight: "1.2",
		padding: "2px 6px",
		borderRadius: "4px",
		background: "var(--background-primary, #ffffff)",
		color: "var(--text-muted, #888)",
		whiteSpace: "nowrap",
		// Position, centering, and zoom-scale are set in positionGroup() at
		// redraw time — we set `transform` there so we can combine the
		// horizontal centering with the per-frame zoom scale in one transform.
	});
	return el;
}

/**
 * Position a badge group relative to its node's rendered position, scaled
 * uniformly with Cytoscape's current zoom level so badges remain
 * proportional to the portrait at every zoom.
 *
 * Approach: each badge has its natural (zoom = 1) size defined in CSS — font,
 * padding, border radius. At redraw time we apply `transform: scale(z)` with
 * a corner-specific `transform-origin` so the badge anchors to the node
 * corner regardless of how big the scaled badge becomes.
 *
 * To make the anchor math simple, we position the badges using the CSS
 * properties that match the desired anchor:
 *   - Top-left icon: positioned via `right`/`bottom` from the group origin,
 *     so its bottom-right corner sits at the node's top-left. transform-origin
 *     100% 100% then scales away from that corner upward-and-leftward.
 *   - Top-right icon: positioned via `left`/`bottom` (mirror).
 *   - Subtext: positioned via `left` (centred manually with translateX(-50%)),
 *     transform-origin 50% 0% so scaling expands downward from the top edge.
 *
 * Cytoscape's `renderedPosition()` and `renderedWidth/Height()` already give
 * us zoom-correct viewport coordinates, so the node-corner positions don't
 * need additional scaling — only the badge's own visual size does, via the
 * scale transform.
 */
function positionGroup(group: BadgeGroup, node: NodeSingular, zoom: number): void {
	const pos = node.renderedPosition();
	const w = node.renderedWidth();
	const h = node.renderedHeight();
	const halfW = w / 2;
	const halfH = h / 2;

	// Group origin sits at the node centre in screen pixels.
	group.el.style.left = `${pos.x}px`;
	group.el.style.top = `${pos.y}px`;

	// Anchor badges to the ring itself (the visible edge of the circular node)
	// rather than to the bounding-box corner. The ring at the top-left
	// diagonal sits at (-radius·cos45°, -radius·sin45°) from the node centre,
	// which is closer in than the bounding box corner. With this anchoring
	// the badge's inner corner touches the ring at 45°, the body extends
	// out-and-up without floating away from the node.
	//
	// SQRT_HALF ≈ 0.7071 is cos(45°) = sin(45°), the projection of the
	// radius onto each axis at the diagonal.
	const radius = halfW; // node is a circle: width == height
	const SQRT_HALF = 0.7071067811865476;
	const ringX = radius * SQRT_HALF;
	const ringY = radius * SQRT_HALF;

	// Top-left icon: positioned via `right`/`bottom` so its bottom-right
	// corner sits at (-ringX, -ringY) from group origin — exactly on the
	// ring at the top-left diagonal. transform-origin at 100% 100% means
	// scale() expands upward-and-leftward away from that anchor, so the
	// badge body grows outside the node as it scales up.
	group.tl.style.left = "auto";
	group.tl.style.top = "auto";
	group.tl.style.right = `${ringX}px`;
	group.tl.style.bottom = `${ringY}px`;
	group.tl.style.transformOrigin = "100% 100%";
	group.tl.style.transform = `scale(${zoom})`;

	// Top-right icon: mirror — bottom-LEFT corner sits at (ringX, -ringY).
	group.tr.style.right = "auto";
	group.tr.style.top = "auto";
	group.tr.style.left = `${ringX}px`;
	group.tr.style.bottom = `${ringY}px`;
	group.tr.style.transformOrigin = "0% 100%";
	group.tr.style.transform = `scale(${zoom})`;

	// Subtext: centred horizontally beneath the node. Positioned via the
	// bottom of the bounding box (halfH below centre) plus a gap that
	// scales with zoom. The 24px clears the Cytoscape label pill that
	// renders the note name. transform-origin at 50% 0% keeps the
	// top-centre anchored when scale changes — text grows downward and
	// outward symmetrically. translateX(-50%) centres horizontally
	// after scaling.
	const subGap = 24 * zoom;
	group.sub.style.left = `0px`;
	group.sub.style.top = `${halfH + subGap}px`;
	group.sub.style.transformOrigin = "50% 0%";
	group.sub.style.transform = `translateX(-50%) scale(${zoom})`;
}
