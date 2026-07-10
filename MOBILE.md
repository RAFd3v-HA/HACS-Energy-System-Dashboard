# Mobile layout in V0.4.2

At viewport widths up to 640 px the renderer switches to a dedicated mobile layout.

- Desktop single-line manifold is replaced visually by a vertical floor stack.
- Floor labels are horizontal and show current load plus today's energy.
- Root areas are full-width cards; Parent/Child hierarchy remains nested.
- Module boards become one column.
- Tabs remain horizontally scrollable.
- Calculation/configuration controls use larger touch targets.
- The magnetic building editor itself remains a technical wide canvas and is horizontally scrollable on mobile rather than shrinking its 12-column coordinate system.

No topology, calculation, or entity configuration is changed by the responsive renderer.
