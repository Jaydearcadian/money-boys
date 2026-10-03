# Money Boys LandingPage - Design Specification

**Reference**: Moneliq Digital Banking Landing Page (frame_03/08/22/36)
**Context**: 10 Design Skills Analysis

This document outlines the comprehensive design specification for the Money Boys LandingPage, derived from the Moneliq reference to ensure a modern, high-trust, and high-performance digital banking aesthetic.

## 1. Design Tokens
- **Primary Colors**:
  - `primary-900`: #0A0F1C (Deep Midnight Blue - Backgrounds)
  - `primary-500`: #1E40AF (Vibrant Cobalt - Actions/Highlights)
  - `primary-100`: #EFF6FF (Soft Blue - Light UI elements)
- **Accent Colors**:
  - `accent-neon`: #10B981 (Emerald Green - Success, Growth)
  - `accent-warn`: #F59E0B (Amber - Alerts, Warnings)
- **Neutrals**:
  - `neutral-900`: #111827 (Text Primary)
  - `neutral-500`: #6B7280 (Text Secondary)
  - `neutral-100`: #F3F4F6 (Cards, Backgrounds)
- **Spacing System**: Base 4px (`sp-1`: 4px, `sp-2`: 8px, `sp-4`: 16px, `sp-8`: 32px, `sp-16`: 64px, `sp-24`: 96px)
- **Border Radius**: 
  - `radius-sm`: 6px (Inputs, Buttons)
  - `radius-md`: 12px (Cards, Modals)
  - `radius-lg`: 24px (Large Containers, Hero sections)

## 2. Typography
- **Font Family**: 'Inter', sans-serif (Clean, highly legible for financial data)
- **Display**: 
  - `Display-Hero`: 72px / 1.1 / -0.02em / SemiBold
  - `Display-Section`: 48px / 1.2 / -0.01em / SemiBold
- **Body**: 
  - `Body-Lg`: 18px / 1.5 / Regular
  - `Body-Md`: 16px / 1.5 / Regular (Base text)
  - `Body-Sm`: 14px / 1.5 / Medium (Meta data, small labels)
- **Numbers/Data**:
  - `Data-Display`: 32px / 1.2 / SemiBold / Tabular Nums

## 3. Motion Curves
- **Spring Physics (Interactive)**: 
  - `spring-bouncy`: `type: "spring", stiffness: 400, damping: 25` (For button presses and quick toggles)
  - `spring-smooth`: `type: "spring", stiffness: 200, damping: 20` (For card hover effects and drawer slides)
- **Easing (Transitions)**:
  - `ease-out-expo`: `cubic-bezier(0.16, 1, 0.3, 1)` (Page loads, hero entrances - 600ms)
  - `ease-in-out-circ`: `cubic-bezier(0.785, 0.135, 0.15, 0.86)` (Complex state changes - 400ms)

## 4. Component Architecture
- **Hero Section**: High-contrast, dynamic background with a clear value proposition, main CTA, and a 3D or isometric dashboard mockup.
- **Bento Grid Features**: A modular, responsive grid showcasing features (Analytics, Cards, Global Payments) with soft inner shadows and glassmorphism elements.
- **Data Tables/Lists**: Clean rows with subtle hover states, tabular numbers for currency, and clear visual hierarchy for positive/negative values.
- **Navigation**: Sticky glassmorphic navbar. Blurs background content (`backdrop-blur-md`).
- **Cards**: Layered elevation. Base `box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1)`. Hover state introduces slight scaling (`scale: 1.02`) and increased shadow.

## 5. Responsive Layout
- **Breakpoints**:
  - Mobile (`sm`): 0 - 639px (Stack everything, full-width buttons, hamburger menu)
  - Tablet (`md`): 640px - 1023px (2-column bento grids, adjusted padding `sp-8`)
  - Desktop (`lg`): 1024px - 1439px (3-column or 4-column grids, complex hero layouts)
  - Wide (`xl`): 1440px+ (Max-width container `1280px` centered, large margins)
- **Container Strategy**: Fluid containers with maximum widths for readability. `padding-x` scales dynamically from `16px` on mobile to `48px` on desktop.
