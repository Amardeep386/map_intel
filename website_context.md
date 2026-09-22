# Map Intel - Context, UI/UX, and Design System

## 1. Project Overview
**Map Intel** is a comprehensive Minimum Advertised Price (MAP) monitoring and compliance tracking platform. It allows brands (e.g., LG, Philips, Kawasaki) to track their products' pricing across various merchants and marketplaces (Amazon, Best Buy, Walmart, etc.), identify pricing violations, map products, and manage compliance communications.

## 2. Tech Stack
- **Framework**: React 19 + Vite
- **Styling**: Tailwind CSS v4 + Vanilla CSS Custom Properties
- **Icons**: Lucide React
- **Data Visualization**: Recharts
- **Fonts**: Outfit, Plus Jakarta Sans, Reenie Beanie (Google Fonts)

## 3. UI/UX Design System (Mirethos Theme)

The application utilizes a sophisticated, premium design system called the **Mirethos Theme**. It focuses on a warm, earthy aesthetic with rich micro-interactions and smooth animations.

### Key UX/UI Features:
- **Spotlight Cards ("Magic Bento")**: Cards feature a mouse-tracking spotlight gradient overlay and glowing borders on hover, providing a modern glass-like depth.
- **Magnetic Buttons**: Buttons have a sweeping highlight effect on hover.
- **Grain Overlay**: A subtle SVG noise filter overlay adds texture and a premium, tactile feel to the background.
- **Mouse-Revealed Grid**: The background features a faint grid that becomes visible around the user's cursor.
- **Micro-animations**: Elements float slowly (`animate-float-slow`), and pulses are used for emphasis (`animate-pulse-coral`).
- **Custom Scrollbars**: Minimalist, thin scrollbars that match the theme colors.
- **View Transitions**: Circular clip-path reveals when transitioning between themes or views.

## 4. Typography
- **Primary Font (Sans-serif)**: `Outfit` (used in Tailwind setup) and `Plus Jakarta Sans` (base body font).
- **Accent Font (Cursive)**: `Reenie Beanie`.

## 5. Color Palettes

The application supports both Light and Dark modes, mapped to Tailwind variables for seamless usage.

### ☀️ Creamy Sand Light Theme
A warm, inviting palette based on sand and earthy tones.

| Name | Hex Value | Usage | Tailwind Variable |
|------|-----------|-------|-------------------|
| Background Primary | `#FAF6EE` | Main body background, Sidebar | `--color-brand-ivory`, `--color-brand-sidebar` |
| Text Primary | `#3C2F2F` | Main headings, strong text | `--color-brand-charcoal` |
| Text Muted | `#827064` | Subtitles, secondary text | `--color-brand-taupe` |
| Card Background | `#FFFFFF` | Cards, panels, elevated surfaces | `--color-brand-white` |
| Accent Coral | `#A65E44` | Primary buttons, active states, highlights | `--color-brand-copper` |
| Accent Sage | `#F0E6D2` | Secondary accents | `--color-brand-olive` |
| Accent Lavender | `#EADEC9` | Additional warm accent | N/A |
| Border | `rgba(60,47,47,0.08)` | Dividers, borders | `--color-brand-beige` |

### 🌙 Enhanced Chocolate Dark Theme
A rich, deep palette that maintains the warmth of the light theme.

| Name | Hex Value | Usage | Tailwind Variable |
|------|-----------|-------|-------------------|
| Background Primary | `#17110F` | Rich espresso main background | `--color-brand-ivory`, `--color-brand-sidebar` |
| Text Primary | `#FAF6EE` | Warm off-white for main text | `--color-brand-charcoal` |
| Text Muted | `#A9998E` | Warm muted taupe | `--color-brand-taupe` |
| Card Background | `#221916` | Deep cocoa for elevated cards | `--color-brand-white` |
| Accent Coral | `#E38663` | Vibrant terracotta for primary actions | `--color-brand-copper` |
| Accent Sage | `#53423B` | Earthy brown for secondary elements | `--color-brand-olive` |
| Accent Lavender | `#4A3A34` | Deeper earthy tone | N/A |
| Border | `rgba(250,246,238,0.08)` | Subtle warm glass border | `--color-brand-beige` |

## 6. Functional Status Indicators (Tailwind Utility Classes)
The platform uses semantic colors to indicate status and severity:
- **Critical / Open**: Red (`bg-red-50 text-red-700`)
- **High / Notified**: Orange/Amber (`bg-orange-50 text-orange-700`)
- **Medium**: Amber (`bg-amber-50 text-amber-700`)
- **Low / Paused**: Slate (`bg-slate-50 text-slate-700`)
- **Active / Resolved / Delivered**: Emerald (`bg-emerald-50 text-emerald-700`)
- **Scheduled**: Blue (`bg-blue-50 text-blue-700`)
