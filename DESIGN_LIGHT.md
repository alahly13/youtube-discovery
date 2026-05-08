---
name: Discovery Research Terminal
colors:
  surface: '#f9f9fb'
  surface-dim: '#d9dadc'
  surface-bright: '#f9f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f3f5'
  surface-container: '#edeef0'
  surface-container-high: '#e8e8ea'
  surface-container-highest: '#e2e2e4'
  on-surface: '#1a1c1d'
  on-surface-variant: '#5e3f3c'
  inverse-surface: '#2f3132'
  inverse-on-surface: '#f0f0f2'
  outline: '#936e6b'
  outline-variant: '#e8bcb8'
  surface-tint: '#c0001b'
  primary: '#b7001a'
  on-primary: '#ffffff'
  primary-container: '#e60023'
  on-primary-container: '#fff7f6'
  inverse-primary: '#ffb3ad'
  secondary: '#5340db'
  on-secondary: '#ffffff'
  secondary-container: '#6d5df6'
  on-secondary-container: '#fffbff'
  tertiary: '#5a5a5e'
  on-tertiary: '#ffffff'
  tertiary-container: '#737277'
  on-tertiary-container: '#fcf8fe'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdad7'
  primary-fixed-dim: '#ffb3ad'
  on-primary-fixed: '#410004'
  on-primary-fixed-variant: '#930012'
  secondary-fixed: '#e4dfff'
  secondary-fixed-dim: '#c6c0ff'
  on-secondary-fixed: '#150066'
  on-secondary-fixed-variant: '#3d22c6'
  tertiary-fixed: '#e4e1e7'
  tertiary-fixed-dim: '#c8c5cb'
  on-tertiary-fixed: '#1b1b1f'
  on-tertiary-fixed-variant: '#47464b'
  background: '#f9f9fb'
  on-background: '#1a1c1d'
  surface-variant: '#e2e2e4'
typography:
  display-lg:
    fontFamily: Geist Sans
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Geist Sans
    fontSize: 20px
    fontWeight: '500'
    lineHeight: '1.4'
    letterSpacing: -0.01em
  body-base:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.6'
    letterSpacing: '0'
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.5'
    letterSpacing: '0'
  code-id:
    fontFamily: Geist Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1'
    letterSpacing: 0.02em
  label-caps:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: '1'
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  container-margin: 24px
  gutter: 16px
  content-gap: 12px
  section-padding: 32px
---

## Brand & Style

The visual identity of this design system is anchored in the concept of "Information Clarity." It is a specialized environment for high-stakes analysis, moving away from the consumer-facing vibrancy of YouTube toward a disciplined, research-grade interface. The aesthetic is "SaaS-Modern"—prioritizing density without clutter, and precision over decoration.

The system evokes trust through structural rigor and a "metadata-first" philosophy. It feels advanced yet accessible, utilizing a clean light mode that maximizes legibility for long-duration research sessions. It is designed to feel like a premium tool for 2026, where AI integration is seamless and the focus remains on actionable insights.

## Colors

The palette is engineered for professional endurance. The app background uses a sophisticated off-white (`#F7F7F9`) to reduce eye strain compared to pure white. Main surfaces and data containers utilize `#FFFFFF` to provide clear separation.

- **Refined YouTube Red:** Used sparingly for branding and critical status indicators, ensuring the legacy of the platform is felt without overwhelming the analytical workspace.
- **AI Violet:** Reserved exclusively for generative features, intelligent insights, and automated discovery paths.
- **Muted Gray:** Used for secondary metadata and background fills for chips, providing a subtle hierarchy that allows high-density data to remain scannable.

## Typography

The typography system employs a dual-sans approach to distinguish between interface guidance and raw data.

- **Geist Sans** handles headlines and structural UI elements, providing a modern, slightly technical feel.
- **Inter** is utilized for body copy and descriptions, chosen for its unparalleled legibility in high-density data environments.
- **Geist Mono** is the "Data Layer" font. It is strictly used for Video IDs, timestamps, technical metadata, and numeric chips, signaling to the user that these elements are precise, copyable data points.

## Layout & Spacing

This design system utilizes a **fluid grid** model with a 12-column foundation for dashboard views and a flexible 4-column sidebar for research parameters. 

The spacing rhythm is built on a 4px baseline, but defaults to a 12px `content-gap` for most data relationships to maintain a "tight but readable" terminal aesthetic. Margins are kept wide (24px to 32px) at the edges of the viewport to frame the workspace, while internal gutters remain at 16px to allow for maximum information density in the center of the terminal.

## Elevation & Depth

Elevation is achieved through **Tonal Layering** and **Minimal Shadows**. 

1. **Base:** The `#F7F7F9` background acts as the canvas.
2. **Surface:** Cards and content blocks use `#FFFFFF` with a 1px border (`#EAEAEA`) and no shadow.
3. **Elevated:** Active modals or hovering cards use a very soft, diffused shadow (0px 4px 20px rgba(0,0,0,0.04)) and a surface color of `#FAFAFC`.

Depth is primarily communicated via subtle color shifts rather than heavy shadows, ensuring the UI feels "flat-premium" and remains performant on high-resolution displays.

## Shapes

The shape language is "Smooth-Professional." Standard UI elements like buttons, input fields, and small cards use an **8px radius**. Larger layout containers or primary terminal panels use a **12px radius** to create a distinct framing effect. 

Nested elements (like chips inside a card) should use a smaller **4px radius** to maintain visual harmony (the "inner radius" rule). This approach balances the "scientific" feel of sharp corners with the "premium" feel of modern software.

## Components

- **Buttons:** Primary buttons use a solid `#1A1A1E` or `#E60023` with white text. AI-driven actions use a gradient border or subtle glow utilizing AI Violet.
- **Chips (Metadata):** Technical chips use `Geist Mono`, a `#F0F0F4` background, and an 8px radius. They are the primary way to display tags, view counts, and category IDs.
- **Input Fields:** Flat styling with a 1px `#E0E0E6` border. On focus, the border transitions to a 2px stroke of the Primary color or AI Violet.
- **Research Cards:** White background, 8px radius, minimal `#F0F0F4` border. Thumbnails within cards have a slight 4px rounding.
- **Status Indicators:** Use refined, small circular pips for "Live," "Processing," or "Archived" statuses, following the color logic of the system.
- **Data Tables:** High-density, zebra-striped with `#FAFAFC`, utilizing `Inter` for text and `Geist Mono` for numeric columns to ensure vertical alignment.