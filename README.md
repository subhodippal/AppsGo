# AppsGo

A mobile-first library of all my web apps and games, in plain HTML, CSS and JavaScript. There's no build step and nothing to install. It uses the same layout and behaviour as [myExpenses](https://github.com/subhodippal/myExpenses): teal and cyan gradients, bottom sheets, and light and dark themes.

Live: `https://subhodippal.github.io/AppsGo/`

## What you can do

- **Browse** apps and games. Home shows a few of each; the **Apps** and **Games** tabs list them all, with category filters and sorting (A–Z, Most used, Newest).
- **Search** by name, category, description or tag, from the box at the top of every page. On Home it searches everything; on a tab it searches within that tab. Matches are highlighted. Press `/` to jump to the search box on a computer.
- **Favourite** anything: tap it, then **♡ Favourite**. Favourites appear under **❤️ Favourites** at the top of Home (tap an icon to open it) and on the **Favourites** tab, with a count on the tab.
- **Open** an app with the **Open** button. It runs inside AppsGo, full screen, under a slim bar with ⌄ (minimize), ⧉ (switch between running apps), ↻ (reload), ↗ (open it in the browser instead) and ✕ (close it). *Experimental:* minimized apps keep running (up to 4) and wait in the **Running** dock above the tabs; tap one to go back to it. Back minimizes too. To turn this off, set `MULTITASK = false` in `app.js`. AppsGo remembers it under **🕘 Recently used**. Google sign-in can't run inside AppsGo, so sign in to an app once in the browser (↗); because all the apps are on `subhodippal.github.io`, that sign-in is then used inside AppsGo too.
- **Details**: tap a card for a bottom sheet with the description, tags (tap one to search for it), host, last update, your usage, Favourite, Share, Open and *View source on GitHub*. Each app has its own link, `#/app/<id>`, and the phone's Back button closes the sheet.
- **Install** AppsGo to your home screen. The library itself opens offline; the apps still need a connection the first time.

Favourites, history, sort order and theme are saved in the browser on this device (localStorage). There's no sign-in.

## Add, change or hide an app

The list is [`apps.json`](apps.json), which you edit by hand. Only the repos you put in it are shown, so public repos you leave out never appear.

The smallest entry is just the URL. The name comes from the URL (`NotesGo` here), and the host is detected (GitHub Pages, Firebase, Vercel, Netlify):

```json
{ "url": "https://subhodippal.github.io/NotesGo/" }
```

A full entry:

```json
{
  "id": "notesgo",
  "name": "NotesGo",
  "type": "app",
  "category": "Productivity",
  "url": "https://subhodippal.github.io/NotesGo/",
  "icon": "https://subhodippal.github.io/NotesGo/icons/apple-touch-icon.png",
  "emoji": "📝",
  "colors": ["#7c3aed", "#ec4899"],
  "description": "Quick notes and checklists…",
  "tags": ["notes", "checklist"],
  "repo": "https://github.com/subhodippal/NotesGo",
  "updated": "2026-11-08"
}
```

| Field | Default if left out | Notes |
|---|---|---|
| `url` | **required** | Where **Open** goes |
| `id` | from the URL (`notesgo`) | Favourites and links (`#/app/<id>`) use it, so don't change it later |
| `name` | from the URL | |
| `type` | `"app"` | `"app"` or `"game"`: which tab it's on |
| `category` | `App` / `Game` | Used by the category filter |
| `icon` | none | Image URL; if it fails to load, the emoji tile shows |
| `emoji`, `colors` | 📱 / 🎮, teal | The tile shown without an icon |
| `description`, `tags` | empty | Shown in details; tags are extra search words |
| `repo` | none | Adds *View source on GitHub* |
| `updated` | none | `YYYY-MM-DD`, for **Newest** |
| `host` | detected from the URL | |
| `open` | in AppsGo | `"browser"` opens it in a new browser tab instead of inside AppsGo |
| `hidden` | `false` | `true` keeps the entry in the file but doesn't show it |

Remember the commas between entries. If the file has a JSON mistake, AppsGo shows "Couldn't load the apps"; paste it into a JSON checker to find the line. Once you push, the change shows up on the next visit; installed copies fetch the file fresh whenever they're online.

## Files

| File | What it does |
|---|---|
| `index.html` | Page layout and bottom sheets |
| `styles.css` | Styling (light and dark), same theme tokens as myExpenses |
| `apps.json` | **The list of apps and games** (edit this) |
| `app.js` | Search, favourites, recently used, routing, sheets, theme, install |
| `sw.js`, `manifest.json` | Offline support and installable app |
| `icons/` | App icons (`icon.svg` and `icon-maskable.svg` are the sources of the PNGs) |
| `server.js` | Local server: `node server.js` → http://localhost:3000 |

## Run it

- **On your computer:** run `node server.js` and open http://localhost:3000. Double-clicking `index.html` doesn't work, because browsers block reading `apps.json` from a file on disk.
- **GitHub Pages:** in the repo, go to **Settings → Pages** → Source: **Deploy from a branch** → `main`, `/ (root)`. After a minute it's live at `https://subhodippal.github.io/AppsGo/`.
