# FRAMR Reference Fidelity Specification

## Chosen Approach: Reference-Faithful Editorial Product Interface

The supplied `framr.html` is the **ground-truth specification**. The rebuilt application will preserve its ivory paper surface, charcoal and vermilion palette, Inter/Fraunces typography pairing, editorial-scale type, modular frame-corner visual system, vertical video imagery, page composition, and interactive prototype flows. The work is a structural refactor—not a visual redesign.

### Design Movement

Contemporary editorial product design with a restrained creative-tool sensibility. The experience combines a warm, tactile print-like canvas with precise UI framing to communicate both creator craft and commercial infrastructure.

### Core Principles

1. Preserve the source layout hierarchy, sections, proportions, visual cadence, and responsive behavior.
2. Use the four-corner frame motif consistently to identify active, detected, or interactive video-placement regions.
3. Maintain strong editorial contrast: oversized dense sans headlines, expressive italic serif supporting lines, and tightly composed metadata.
4. Keep motion purposeful and source-faithful: scan states, recording pulses, swap transitions, reveal-on-scroll content, and concise feedback.

### Color Philosophy

The pale paper background keeps the product approachable and content-focused. Almost-black ink provides authority and dependable contrast. A single vermilion accent signals detection, opportunity, and commercial change without diluting the calm editorial base.

### Layout Paradigm

An editorial storytelling page that alternates asymmetric copy-and-video pairings, product cards, a high-contrast advertiser band, and a chronological inventory timeline. The application workspace is separated from the public story through a dedicated dashboard shell and focused modal workflows.

### Signature Elements

- Expandable four-corner frame markers around media, cards, and detected placements.
- Portrait video tiles with camera metadata, source/version context, and commercial placement labels.
- Vermilion status markers, recording indicators, and slim high-contrast pill labels.

### Interaction Philosophy

Interactions should make the product model legible: creators upload, review detected placements, generate versions, and export; advertisers browse inventory, reserve a placement, and create campaigns. Controls respond immediately, with clear state changes and non-blocking status feedback.

### Animation

Use the original source’s scanline, recording pulse, version image crossfade, marker pop, reveal-on-scroll, and subtle frame-corner expansion. Keep UI transitions short and preserve reduced-motion support.

### Typography System

Inter is used for functional UI, dense headlines, metadata, and controls. Fraunces italic is reserved for concise editorial thesis lines. Headlines use tight tracking and bold weight; system text remains compact and readable.

### Brand Essence

**FRAMR is a programmable video-placement platform for creators and advertisers who want existing content to carry new commercial value.**

**Personality:** incisive, creative, infrastructural.

### Brand Voice

Headlines are concise, declarative, and oriented around a change in what content can do. CTAs are active and role-specific.

> “Change what’s in the frame.”

> “Don’t interrupt the content. Become part of it.”

### Wordmark & Logo

The wordmark remains the widely tracked all-caps **FRAMR** name, paired with a small square center dot framed by the four-corner motif. The mark should stay prominent and legible in the header and app shell.

### Signature Brand Color

**FRAMR Vermilion — `#E4572E`**

## Structural Refactor Rules

- Preserve existing written content, imagery, visual states, and intended interactions from the source application.
- Extract each page section, dashboard panel, modal, reusable visual primitive, data collection, and global style responsibility into clear, dedicated files.
- Do not add new user reviews, ratings, testimonials, product claims, or unrequested content.
- Maintain accessible labels, keyboard handling, semantic controls, and reduced-motion behavior while componentizing.
