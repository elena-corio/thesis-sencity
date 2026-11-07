# SenCity sense icons

Eight line icons for the senses, matched in size and weight. Use them everywhere a sense is shown (profile radar, onboarding, place and stretch cards, report).

- 24 x 24 viewBox, stroke `currentColor`, no fill: set the colour with CSS `color`.
- Line weight 1.8. Some icons carry an inner `<g>` with a scale and a compensated stroke width so all eight look the same size and weight. Keep that `<g>` as it is.
- To change the weight for a context, change the outer `stroke-width` on icons without a `<g>` (hearing) and scale the inner value in the same proportion on the others.
- Do not redraw or resize individual icons; they are balanced as a set.

Files, in sense order: sight, hearing, smell, touch, thermal, vestibular, body-awareness (proprioceptive), inner-sensations (interoceptive).
