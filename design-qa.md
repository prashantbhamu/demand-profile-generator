# PRISM header design QA

## Evidence

- Source visual truth: `C:\Users\hp\.codex\generated_images\01a00144-aa0c-7353-a60d-6b33754e8c45\exec-5e86b418-2ffd-4cfd-9092-d9ad22f254a5.png`
- Desktop implementation: `C:\Users\hp\.codex\visualizations\2026\08\14\01a00144-aa0c-7353-a60d-6b33754e8c45\prism-ui-qa\implementation-desktop-collapsed.png`
- Desktop expanded state: `C:\Users\hp\.codex\visualizations\2026\08\14\01a00144-aa0c-7353-a60d-6b33754e8c45\prism-ui-qa\implementation-desktop-expanded.png`
- Narrow implementation: `C:\Users\hp\.codex\visualizations\2026\08\14\01a00144-aa0c-7353-a60d-6b33754e8c45\prism-ui-qa\implementation-mobile-collapsed.png`
- Narrow expanded state: `C:\Users\hp\.codex\visualizations\2026\08\14\01a00144-aa0c-7353-a60d-6b33754e8c45\prism-ui-qa\implementation-mobile-expanded.png`
- Full comparison: `C:\Users\hp\.codex\visualizations\2026\08\14\01a00144-aa0c-7353-a60d-6b33754e8c45\prism-ui-qa\comparison-full.png`
- Focused logo comparison: `C:\Users\hp\.codex\visualizations\2026\08\14\01a00144-aa0c-7353-a60d-6b33754e8c45\prism-ui-qa\comparison-focused-logo.png`

## Normalization and state

- Source pixels: 1254 × 1254 at its supplied density. The logo region was cropped for the focused comparison; the source is a standalone lockup rather than a complete application screen.
- Desktop implementation: 1440 × 900 browser pixels, 1440 × 900 CSS viewport, device scale factor 1, light theme, initial upload step, collapsed and expanded wordmark states.
- Narrow implementation: 380 × 822 captured browser pixels at a 390 × 844 CSS viewport, light theme, initial upload step, collapsed and expanded wordmark states.
- The focused comparison aligns the source logo region with the rendered header region. The full comparison evaluates how the lockup integrates with the existing application rather than treating the standalone source as a complete page design.

## Fidelity review

- Fonts and typography: the locally bundled Russo One face closely matches the selected wide geometric wordmark. Weight, tracking, baseline, and navy treatment preserve the selected character; the expanded suffixes deliberately use the existing Manrope UI face for readability. The source uses custom-looking letterforms, so exact glyph identity is not expected under the approved “very close” font decision.
- Spacing and layout rhythm: the mark-to-wordmark ratio, compact horizontal silhouette, subtitle gap, and reserved header height are consistent with the source and existing app. Subtitle, status pill, and workflow card bounding boxes remain unchanged between collapsed and expanded desktop states.
- Colors and visual tokens: navy prism outlines and wordmark, blue input trajectory, and indigo/violet/jade output trajectories match the selected direction and reuse the app's cool palette.
- Image quality and asset fidelity: the canonical asset is transparent vector SVG, with the same prism geometry and palette reused by the interactive header. It remains sharp at desktop and narrow sizes.
- Copy and content: browser title is `PRISM`; the subtitle and the full “Power-demand Reconstruction, Integration and Scaling Model” expansion match the approved wording.

## Interaction and browser checks

- Mouse click expands all five terms together; a second click retracts immediately.
- Auto-retraction occurs after the 600 ms expansion plus the approved 10-second hold.
- Enter expands and Space retracts while the wordmark button is focused.
- Desktop and narrow layouts have no horizontal document overflow.
- The application console contained no warnings or errors.

## Comparison history

1. Initial narrow comparison found a P2 overlap: the expanded `Integration` term ran beneath the status pill.
2. The status pill was moved into its own reserved narrow-screen row without changing the subtitle or workflow-card position.
3. Post-fix evidence in `implementation-mobile-expanded.png` shows all five terms in a controlled two-line layout, with the status pill separated below and zero horizontal overflow.
4. The spec review then found P2 clipping at the 320 px edge case because the three-column first row still used 390 px typography.
5. A compact breakpoint now reduces the mark, type, and term gaps below 360 px. Re-verification at 320 px places the rightmost term at x=282.8 inside the x=289.8 button edge, keeps the status pill separate, and leaves document width at 310 px with no horizontal overflow.

## Findings

- No actionable P0, P1, or P2 differences remain.
- P3: Russo One is a close open-source substitute rather than the source image's custom-looking exact glyph construction. This is acceptable under the approved font-fidelity decision and preserves one consistent treatment across the SVG and UI.

## Implementation checklist

- [x] Canonical transparent SVG matches the selected story and palette.
- [x] Local display font and license are bundled.
- [x] Expansion, immediate reversal, timed retraction, and keyboard activation work.
- [x] Desktop and narrow states preserve surrounding layout.
- [x] Browser console is clean.

final result: passed
