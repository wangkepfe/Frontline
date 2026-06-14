# Shipping FRONTLINE to Steam

The game is a deterministic TypeScript simulation with a Three.js renderer, wrapped in
Electron for desktop distribution (the same path Vampire Survivors shipped with).

## Build pipeline

```
npm run build        # typecheck + vite build  -> dist/
npm run dist:win     # electron-builder        -> release/win-unpacked/FRONTLINE.exe
npm run app          # quick test: run electron against the current dist/ build
```

## Steamworks checklist

1. **Steamworks account & app id** — register at partner.steamgames.com ($100 app fee),
   create the app, note the App ID.
2. **steamworks.js** — `npm i steamworks.js`, then init in `electron/main.cjs`
   (the integration point is marked with a comment). Achievements, stats, and rich
   presence all hang off that client object.
3. **steam_appid.txt** — during development place a `steam_appid.txt` containing the
   App ID next to the built exe so the overlay/API works outside Steam.
4. **Overlay** — the Steam overlay works with Electron when the game runs through
   Steam. Test with `-gpu-sandbox` flags if it fails to hook.
5. **Depot upload** — point the depot at `release/win-unpacked/`, set the launch
   option to `FRONTLINE.exe`, push through SteamPipe (steamcmd).
6. **Store assets** — capsule art, screenshots, trailer. The debug screenshot
   endpoint (`/__shot` in dev) is handy for capturing raw frames.

## Design notes that matter for Steam

- The sim is fixed-timestep (20 Hz) and fully deterministic per seed — replays and
  async multiplayer (lockstep card streams) are feasible later without a rewrite.
- All balance lives in `src/sim/stats.ts`; content (cards/loadouts) in `src/sim/cards.ts`.
- The renderer is procedural low-poly; swapping to GLTF art is contained to
  `src/render/meshes.ts`.
