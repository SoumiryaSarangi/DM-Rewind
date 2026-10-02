# DM Rewind

Jump to any date in your Instagram DMs without scrolling for an hour.

DM Rewind is a small offline web app that opens your Instagram data export (JSON **or** HTML) and lets you:

- **Go to a date.** Pick a day and land on the first message from it. If nothing was sent that day, it takes you to the closest day that has messages and tells you so.
- **Browse a calendar heatmap.** Each month's calendar is shaded by how many messages were sent each day. Click a day to go there.
- **Scrub the month rail.** The bar on the right of every chat shows how many messages were sent each month. Click or drag it to move through the whole chat.
- **Search.** Look up words or an exact `"phrase"`, filtered by date range, sender, and type (photos, videos, voice messages, links/shared posts, calls, reacted-to). Search one chat or all of them.
- **See this day in past years.** Shows messages from today's date in earlier years.
- See photos, videos and voice messages inline when they're in the export, plus reactions and shared posts.

Everything runs in your browser. Nothing is uploaded and no network requests are made, so it works offline.

## Run it

No install and no build step. Open `index.html` in Chrome, Edge, Brave or Firefox (double-click it).

Then click one of these:

| Button | Use it for |
|---|---|
| **Open export folder** | The unzipped export folder. Best for big exports. |
| **Open .zip** | The .zip file exactly as Instagram sent it. |
| **Open message files** | One or more `message_1.json` / `message_1.html` files from a single chat folder. |

You can also drag a folder or .zip onto the page, or click **Try it with a demo chat first** to see how it works with made-up data.

> When you open a folder, Chrome may ask "Upload N files to this site?". That's the browser's standard wording for giving a page access to a folder. The page only reads the files on your computer; nothing is sent anywhere.

## Getting your Instagram export

1. Instagram → **Settings** → **Accounts Center** → **Your information and permissions**.
2. **Export your information** (older versions call it **Download your information**) → create an export for your Instagram profile.
3. **Export to device** → **Customize information** → keep only **Messages** (this makes the export smaller and faster).
4. Date range **All time**. Format **JSON** (exact timestamps) or **HTML** (both work).
5. Download the .zip when Instagram emails you, then open it in DM Rewind.

Exports don't include unsent or disappearing messages. If a chat is missing, it may be end-to-end encrypted; Instagram leaves those out of the standard export.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `g` | Go to date |
| `/` | Search this chat |
| `Home` / `End` | First / latest message (when the chat has focus) |
| `Esc` | Close the open panel |
| Arrow keys | Move between days in the calendar, or between chats in the list |

## Project layout

```
DM Rewind/
├── index.html          App shell and markup
├── css/style.css       Styles (light + dark, responsive)
├── js/parser.js        Reads JSON/HTML exports into one sorted list per chat
├── js/sources.js       Opens folders, .zip files, loose files and drag-and-drop
├── js/demo.js          Generates the demo export
├── js/app.js           UI: chat list, timeline, month rail, calendar, search
└── vendor/zip.min.js   zip.js 2.22 (BSD-3-Clause), for opening .zip exports
```

### How it works

- **JSON exports** write UTF-8 text as Latin-1 escapes, so emoji show up as `ð\x9f\x98\x82`. `fixText()` in `parser.js` converts it back without touching text that's already correct.
- **HTML exports** are parsed with `DOMParser`. Message blocks are found by Instagram's current class names, with a fallback that looks for any block ending in a timestamp, so small format changes don't break it. HTML timestamps only go to the minute, so messages with the same time keep the order they had in the file.
- Every chat folder can have several `message_N` files (newest first). They're merged and sorted oldest to newest. Exact duplicates are dropped, and if a chat has both JSON and HTML files, the JSON is used.
- **Your name** comes from `personal_information.json` when it's present. Otherwise it's the name that appears in the most chats, or, in one-to-one chats, the person who isn't the chat's title. You can change it from the **⋯** menu in any chat.
- **The timeline is windowed.** Only about 700 messages are on the page at once, and more load as you scroll, so chats with 100,000+ messages stay smooth. Jumping to a date uses a binary search over timestamps.
- **Media is matched by file name** against the export (with the folder path used as a tiebreaker) and loaded only when it scrolls into view.

## Ideas for later

- Export a date range as a PDF or text file
- Stats per chat: messages per person, busiest hours, longest streak
- Remember the last chat and position you had open
