# Life in Hours

> Your life is made of hours. See where yours are going.

A personal life-analytics dashboard — not a timesheet. It helps you see how
your time actually splits across sleep, work, commute, screen time,
exercise, relationships, learning, and everything else, and makes that time
feel tangible instead of abstract.

## Stack

- **React 18** + **Vite** (dev server + build)
- **Tailwind CSS** for utility classes, alongside a small set of custom
  `lih-*` classes (design tokens, cards, nav, tabs, modal, toast) defined in
  `src/index.css`
- **lucide-react** for icons
- No backend — data is generated as realistic mock activity on first run and
  then persisted to the browser's `localStorage` from then on

## Getting started

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually `http://localhost:5173`).

To build a production bundle:

```bash
npm run build
npm run preview   # serve the built files locally to sanity-check them
```

## Project structure

```
life-in-hours/
├── index.html            # Vite entry HTML
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
└── src/
    ├── main.jsx           # React root, mounts <App />
    ├── App.jsx            # The entire application (pages, components, calculations)
    └── index.css          # Tailwind directives + design tokens + custom styles
```

Everything — Home, Timeline, Insights, Life Clock, Profile, onboarding, the
add/edit/delete activity modal, and the What If simulator — lives in
`src/App.jsx`. It's a single large file by design (it started life as a
single-file artifact); if you want to split it into multiple files/components
per folder, that refactor is mechanical (each named `function` in the file
is already a self-contained component) but is left as-is here so the diff
against the original stays easy to follow.

## Data & persistence

On first load, the app seeds ~12 weeks of realistic (but fictional, seeded)
daily activity for a 27-year-old so the dashboard isn't empty. After that,
anything you add, edit, or delete — plus your profile assumptions
(birthdate, life expectancy, average sleep/work/commute/screen time) — is
saved to `localStorage` under the `lih:profile` and `lih:activities` keys.
Clearing your browser's site data for this app resets it back to the seeded
mock data.

## Notes

- All the "hours remaining", "if nothing changes", and "What if?" numbers
  are clearly framed as **estimates based on your stated assumptions** —
  never as predictions. You can change every assumption from the Profile
  page, or re-run the whole onboarding flow any time via the "Retake setup"
  button in the bottom-right corner.
- Fonts (Fraunces + Inter) load from Google Fonts via `@import` in
  `src/index.css`. If you need this to work fully offline, self-host those
  two font families and swap the `@import` line for local `@font-face`
  declarations.
