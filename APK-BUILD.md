# Build the Sky Rider APK (offline, auto landscape)

Single player runs fully offline: the game, the font and the images are inside the app.
Internet is only used for online multiplayer.

## Build it on GitHub (no PC needed)

1. Upload this whole folder to a GitHub repository (keep the `.github` folder).
2. Open the repo, go to **Actions**, pick **Build Android APK** and press **Run workflow**.
   It also runs on every push to `main`.
3. When it turns green (about 4 to 6 minutes), open the run and download
   **SkyRider-apk**. It is a zip with `SkyRider.apk` inside.
4. Extract it and install `SkyRider.apk` (allow "install unknown apps" once).

## What the app does

- Locked to landscape and follows the phone in both landscape directions.
- Fullscreen, screen stays on, notch safe.
- Back button pauses while riding, and leaves the app from the menus.
- Solo play needs no internet connection; it also works with airplane mode on.
- Five playable rides: Sky Racer road bike, Hopper BMX, Trail Beast mountain bike, Aero Coupe flying car and Whirlybird helicopter.
- Vehicle-specific handling, models, controls and engine / rotor sounds. Best times are saved separately for each ride.

## Build locally with Android Studio

```
npm install
npx vite build
# copy everything from dist/ into android/app/src/main/assets/www/
# then open the android/ folder in Android Studio and run assembleDebug
```

## Multiplayer

- The main menu shows the selected ride and a Garage. Open it to choose any of the five vehicles, review its handling and change paint for solo rides.
- The online lobby shows rider names, selected vehicles, ready status, room chat and a shareable room code. The host can remove a player.
- Up to 10 riders. Every vehicle can be selected before the race; each player sees the others' chosen vehicle, moving as a ghost (no bumping) with a name tag and live position (Pos).
- The host starts a race once at least two riders are in and everyone is ready. Changing your vehicle clears your ready status.
- The first rider across the finish line ends the race. Finishers rank by time, the rest by distance covered.
- The host brings everyone back to the lobby for another race. **Leave room** is in the lobby, results and pause menu. After a race everyone returns to the lobby in the main menu.
- Falling off respawns you at your last checkpoint, as many times as you need.
- If the host leaves, the room closes (no host migration).
- Connections go straight between phones through the free PeerJS cloud server. Strict mobile networks can block
  direct connections; then add your own TURN relay in `src/net.js` (`MP.ICE_SERVERS`). The old free public TURN
  servers no longer work, so this needs a free account at a TURN provider.

## Tree and cloud shading (2.5D)

Trees, bushes and clouds are still flat images. They are lit in the shader using a small volume map
next to each image (`*_d.webp`: normal + ambient occlusion), the scene's real sun and sky colours, soft
ground shadows for trees, and a slight lean with the camera pitch. Tuning is in `src/sprites.js`
(the `LOOK` table: strength, wrap, translucency, rim, tilt, shadow). After replacing an image, run
`python3 tools/bake_volume_maps.py` to rebuild its volume map.
