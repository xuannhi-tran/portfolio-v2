# Portfolio site: Vo Xuan Nhi Tran

Personal portfolio for Vo Xuan Nhi Tran, a third-year Software Engineering student at USYD.

## How to work in this repo (important)

- Act as an **advisor**. Suggest the next step and explain it.
- **Only write or change code when the user explicitly asks.** Do not start coding after proposing a plan; wait for a go-ahead.
- Keep each step small, so the user can follow and review it.

## Concept

Music/vinyl theme. Projects are albums. Picking one puts the record on a turntable, the needle drops, and the project info appears.

## Visual design

- Black background throughout.
- Fonts: **EB Garamond** for main text; a **monospace font** for small labels (year, stack, "Side A", etc.).

## Flow

1. **Cover screen**: name, role, short intro, GitHub / LinkedIn / CV links, and a "See my projects" button.
2. **Turntable + record shelf**: choose an album, the record goes on the turntable, the needle drops.
3. **Project detail**: info for the selected project.
4. **Contact**.

Navigation: a **fixed nav** so visitors can skip the animation, plus a button to go **back to the cover**.

## Content

- **Side A**: RAG Document Assistant, Expense Tracker, Hackathon eligibility screener.
- **Side B**: Discord Music Bot.

## Tech approach

- Build the **flat version first**: SVG + CSS + JS (no framework decided; keep it simple).
- Mobile-friendly.
- Core content (name, intro, project descriptions, links) is **real HTML**, not baked into canvas/SVG, so it is readable, accessible and indexable.
- Respect `prefers-reduced-motion` (no needle-drop/spin animation for those users; content still fully usable).
- Possible later upgrade: turntable in **three.js**. Not part of the first version.

## Copy rules

- All site copy in **English**.
- Natural and conversational tone.
- **No overstating skills.** Describe what was actually built and learned, honestly.
