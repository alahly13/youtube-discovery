---
name: Discovery Research Terminal
colors:
  surface: '#131318'
  surface-dim: '#131318'
  surface-bright: '#39393e'
  surface-container-lowest: '#0e0e13'
  surface-container-low: '#1b1b20'
  surface-container: '#1f1f24'
  surface-container-high: '#2a292f'
  surface-container-highest: '#35343a'
  on-surface: '#e4e1e9'
  on-surface-variant: '#e9bcb9'
  inverse-surface: '#e4e1e9'
  inverse-on-surface: '#303035'
  outline: '#b08784'
  outline-variant: '#5f3e3d'
  surface-tint: '#ffb3af'
  primary: '#ffb3af'
  on-primary: '#68000e'
  primary-container: '#ff5357'
  on-primary-container: '#5c000b'
  inverse-primary: '#bf0024'
  secondary: '#d0bcff'
  on-secondary: '#3c0091'
  secondary-container: '#571bc1'
  on-secondary-container: '#c4abff'
  tertiary: '#afc6ff'
  on-tertiary: '#002d6d'
  tertiary-container: '#538dff'
  on-tertiary-container: '#002760'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#ffdad8'
  primary-fixed-dim: '#ffb3af'
  on-primary-fixed: '#410006'
  on-primary-fixed-variant: '#930019'
  secondary-fixed: '#e9ddff'
  secondary-fixed-dim: '#d0bcff'
  on-secondary-fixed: '#23005c'
  on-secondary-fixed-variant: '#5516be'
  tertiary-fixed: '#d9e2ff'
  tertiary-fixed-dim: '#afc6ff'
  on-tertiary-fixed: '#001944'
  on-tertiary-fixed-variant: '#004299'
  background: '#131318'
  on-background: '#e4e1e9'
  surface-variant: '#35343a'
typography:
  display-lg:
    fontFamily: Hanken Grotesk
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  body-base:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: '1.6'
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.5'
  label-caps:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '700'
    lineHeight: '1'
    letterSpacing: 0.05em
  data-mono:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
    lineHeight: '1'
    letterSpacing: -0.01em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
  2xl: 64px
  gutter: 16px
  margin: 24px
---

## Brand & Style
The design system is engineered for deep-data immersion, combining the familiar energy of YouTube with the rigorous precision of a financial research terminal. It targets professional content strategists, data analysts, and high-tier creators who require high information density without sacrificing aesthetic clarity.

The visual style is a hybrid of **Minimalism** and **Glassmorphism**, specifically optimized for a "Dark Mode First" workflow. It leverages subtle depth through semi-transparent layers and background blurs to create a spatial hierarchy that feels sophisticated and high-tech. The personality is authoritative, "high-fidelity," and clinical, using the primary red not as a loud brand statement, but as a surgical tool for data visualization and critical calls to action.

## Colors
This design system utilizes a high-contrast palette optimized for legibility and data highlighting. 

- **Primary Red:** A refined, deeper variation of the YouTube red, used exclusively for primary actions, branding elements, and critical notifications.
- **AI Accents:** A soft purple/blue gradient or solid hex used to denote machine-learning features, insights, and predictive data visualizations.
- **Surface Strategy:** In dark mode, surfaces use deep charcoal tones with subtle saturation to prevent "pure black" eye strain. Light mode utilizes warm grays and soft whites to maintain a premium, paper-like feel for long-form research reading.
- **Data Semantic Colors:** Standardized green for growth/positive trends and amber for warnings, kept at a lower saturation to avoid clashing with the primary red.

## Typography
The typographic system is built for scanning complex datasets and video metadata. 

- **Display & Headlines:** Use **Hanken Grotesk** for a sharp, modern feel that differentiates the terminal from standard consumer apps.
- **Body & UI Elements:** Use **Inter** for its neutral tone and exceptional legibility at small sizes, particularly in sidebar navigation and metadata lists.
- **Technical Data:** **JetBrains Mono** is introduced for timestamps, view counts, and API-adjacent data strings to reinforce the "research terminal" aesthetic. 
- **Vertical Rhythm:** Generous line heights are maintained in long-form analysis text to improve focus, while labels are tightly tracked for space efficiency in dense dashboards.

## Layout & Spacing
The layout follows a **Fluid Grid** model with a focus on modularity. 

- **Grid:** A 12-column grid system is used for main dashboard views. Containers expand to fill width but maintain a maximum content width of 1600px for legibility.
- **Rhythm:** An 8pt spatial system governs all margins and padding. 
- **Dashboard Philosophy:** High-density zones (data tables, video grids) use `sm` (8px) or `md` (16px) spacing, while layout-level breaks and marketing-focused research summaries use `xl` (40px) or `2xl` (64px) to provide visual "breathing room."
- **Sidebars:** Persistent left-hand navigation is fixed at 240px, with the ability to collapse to 64px for a "focus mode" terminal view.

## Elevation & Depth
Depth is created through a combination of **Tonal Layers** and **Glassmorphism**, rather than traditional heavy drop shadows.

- **Stacking:** The `Background` layer is the lowest. `Surface` layers (cards) sit on top with a subtle 1px border. `Surface_elevated` (modals, dropdowns) uses a soft backdrop blur (20px) and a semi-transparent fill to create a glass effect.
- **Outlines:** Instead of shadows, use "Ghost Borders"—1px solid lines with 8% white (dark mode) or 6% black (light mode) opacity to define shapes.
- **AI Influence:** Elements with AI-driven insights should have a subtle 2px outer glow using the AI Accent color, appearing as if the light is emanating from behind the card.

## Shapes
The shape language balances professional rigidity with modern SaaS softness.

- **Standard Radius:** 12px (0.75rem) for primary content cards and containers.
- **Button Radius:** 8px (0.5rem) for a more precise, tool-like feel.
- **Input Fields:** 8px (0.5rem) to match buttons, creating a cohesive form-factor.
- **Interactive States:** On hover, cards may transition from a 1px border to a 1.5px border or increase their internal backdrop blur intensity.

## Components
Consistent styling for core elements in this design system:

- **Buttons:**
    - *Primary:* Solid Primary Red with white text. No gradient.
    - *Secondary:* Ghost style with Primary Red border and text.
    - *AI Action:* Subtle purple-to-blue gradient background with white text.
- **Cards:** Use a 1px border (`#FFFFFF` at 8% opacity). Content padding should be `md` (16px) or `lg` (24px) depending on information density. Use `backdrop-filter: blur(12px)` for overlay cards.
- **Chips & Tags:** Small, capsule-shaped elements with low-contrast backgrounds (e.g., `#FFFFFF` at 5% opacity). Text uses the `label-caps` typography style.
- **Input Fields:** Dark background (`#0B0B0F`), 1px border. Focus state uses a Primary Red border with a 2px outer glow.
- **Data Tables:** Row-based with subtle dividers. Header row uses `data-mono` typography in `text_secondary` color. Hovering over a row should trigger a slight surface brightness increase.
- **Video Thumbnails:** 16:9 aspect ratio with a fixed 8px border-radius. Overlay view counts and timestamps using semi-transparent black pills with white `data-mono` text.
- **AI Insights Panel:** A specific component featuring a glassmorphic background and a left-side border accent in the AI Accent color to denote machine-generated content.