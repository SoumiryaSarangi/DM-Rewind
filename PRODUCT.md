# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Instagram users who want to find an old moment in a DM chat quickly: a first message, a trip, an inside joke, the day something happened. Today the only native way is to scroll for an hour. The app is shared publicly on GitHub, so first-run copy has to work for people who aren't technical and who have never seen an Instagram data export before.

The core job is **"go to a date"**. Browsing, searching and "this day in past years" all support that job.

## Product Purpose

DM Rewind opens an Instagram data export (JSON or HTML, as a folder, .zip or loose message files) and lets the person jump to any date in their DMs. Success means picking a day and landing on the right message in seconds, even in a chat with 100,000+ messages, without anything leaving the device.

## Positioning

It is a private, offline time-navigation tool for your own message history, not a chat client. Nothing is uploaded and no network requests are made. The month rail on the right of each chat, which shows message volume per month and can be clicked or dragged, is the signature element: it makes years of conversation feel like one scrubbable timeline.

## Operating Context

- The user requests an export from Instagram (Accounts Center → Export your information), waits for the email, downloads a .zip, then opens it here. Often this is the first time they've seen their export.
- Opened by double-clicking `index.html` in Chrome, Edge, Brave or Firefox. No server, no install.
- Chrome may show "Upload N files to this site?" when a folder is opened. The UI has to reassure the user that nothing is sent anywhere.
- Used on desktop and at phone width, in light and dark.
- A demo chat ("Try it with a demo chat first") lets people try it before they have an export.

## Capabilities and Constraints

- Go to date: lands on the first message of the day, or the closest day with messages and says so.
- Calendar heatmap per month, shaded by message count; click a day to go there.
- Month rail: messages per month, click or drag to scrub.
- Search: words or an exact "phrase", filtered by date range, sender and type (photos, videos, voice, links/shared posts, calls, reacted-to), in one chat or all of them.
- "This day in past years".
- Inline photos, videos, voice messages, reactions and shared posts when they're in the export.
- Keyboard shortcuts: `g` go to date, `/` search, `Home`/`End` first/latest message, `Esc` close panel, arrow keys in the calendar and chat list.
- Technical: plain HTML/CSS/JS, no build step, no network requests (fonts and assets must be local or system). The timeline is windowed (~700 messages in the DOM). `vendor/zip.min.js` is third-party and must not be edited.
- Exports don't include unsent, disappearing or end-to-end-encrypted chats.

## Brand Commitments

- Name: **DM Rewind**.
- Tone: calm, precise, a little nostalgic.
- Must not look like a generic chat app or a SaaS template.
- UI copy may be lightly edited for clarity, keeping its meaning and every privacy claim intact.

## Evidence on Hand

- `README.md`: feature list, export instructions, keyboard shortcuts.
- `js/demo.js`: generated demo export with made-up data.
- No logo, screenshots, testimonials or user numbers exist. Don't invent any.

## Product Principles

1. **The date is the destination.** Every surface should make getting to a specific day faster or clearer.
2. **Private by construction.** Nothing leaves the device, and the UI says so plainly where people will worry.
3. **Scale without strain.** A 100,000-message chat must feel as quick as a 100-message one.
4. **Their memories, not our interface.** The messages are the content, and the tool should stay out of the way.
5. **Plain words for first-timers.** Assume no prior knowledge of data exports.

## Accessibility & Inclusion

WCAG 2.2 AA: text contrast at least 4.5:1, a full keyboard path, visible focus, `prefers-reduced-motion` respected, touch targets at least 24px. Messages may contain any script or emoji, so layouts must handle long names, non-Latin text and emoji-only content.
