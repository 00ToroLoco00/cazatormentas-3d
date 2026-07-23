Cazatormentas 3D — Codex instructions

Project purpose

Cazatormentas 3D is an open-source, Spanish-language 3D browser simulator aboutchasing and observing tornadoes in the Uruguay/South American Pampas. The goalis entertainment supported by accurate, understandable tornado science.

The current MVP simulates natural atmospheric evolution, one active storm at atime, frequent tornado formation in fast-testing mode, a free observer camera,changing cloud layers, variable rain, Pampas terrain, and cone tornadoes withprovisional EF1–EF5 intensity.

Product constraints

Keep the user interface in Spanish until an explicit localization task isrequested.

Preserve the natural-event model: atmospheric conditions evolve first, andstorms/tornadoes emerge when simulated conditions and weighted randomnesssupport them.

Fast-testing mode should produce interesting storms approximately every3–6 minutes. Keep stronger EF4–EF5 tornadoes uncommon while EF1–EF3 remaincommon.

Tornadoes should begin weak, intensify, and weaken naturally over theirlifecycle.

The first environment is inspired by Uruguay and the South American Pampas:open grasslands, agricultural fields, small towns, farms, roads, and powerinfrastructure.

Keep future vehicles, radar improvements, damage, additional tornado shapes,multiplayer, and other weather effects possible without rewriting the coresimulation.

Do not add lightning, hail, extra tornado morphologies, multiplayer, or avehicle system unless the task explicitly requests them.

Architecture

app/game/types.ts contains shared contracts between simulation, UI, andrendering. Update types deliberately and keep them reusable.

app/game/config.ts is the home for simulation timing, world dimensions,probabilities, intensity weighting, and future extension points.

app/game/simulation.ts is the authoritative weather model. Keep itindependent from React and Three.js so it can later support replay, testing,vehicles, or multiplayer synchronization.

app/components/StormScene.tsx owns Three.js rendering and camera behavior.

app/components/WeatherExperience.tsx coordinates the experience.

app/components/WeatherHud.tsx owns controls, conditions, lifecycle, wind,provisional EF, and minimizable interface panels.

app/components/RadarPanel.tsx owns the radar visualization.

Keep rendering as a consumer of simulation state; do not put authoritativeweather rules inside render loops or UI components.

Development commands

Use Node.js 22 or newer.

npm ci
npm run dev
npm run lint
npm test
npm run build
npm run validate:artifact

npm test includes a production build and rendered-HTML checks. Run at leastnpm run lint and npm test for behavior or architecture changes. Run theproduction build when changing build configuration, dependencies, routing, ordeployment behavior.

Implementation rules

Prefer small, composable changes over broad rewrites.

Keep simulation calculations deterministic when a seed or explicit randomsource is supplied; make randomness injectable for tests.

Use clear domain names and units. Keep wind speeds and distances explicit incode and UI conversions.

Keep UI panels keyboard-accessible, minimizable, and readable in Spanish.

Respect the existing visual language and responsive layout unless a visualredesign is explicitly requested.

Avoid adding dependencies when the existing React, Three.js, and browser APIsare sufficient.

Do not commit node_modules, build output, .sites-runtime, .openai, localenvironment files, credentials, or generated artifacts.

Never hard-code API keys, access tokens, or deployment credentials.

Workflow and definition of done

Inspect the relevant files and existing behavior before editing.

For ambiguous or multi-step work, make a short plan and identify the files itwill affect before implementation.

Add or update tests when changing simulation rules or reusable logic.

Run the relevant validation commands and report any command that could not berun.

Review the final diff for accidental files, secrets, unrelated changes, andregressions.

Prefer feature branches and pull requests; do not rewrite main history.

A feature is complete only when its behavior is implemented, the UI remainsSpanish and usable, the architecture remains extensible, and validation haspassed or any failure is clearly explained.

Current controls

W, A, S, D: move the free camera.

Mouse: look after clicking the world.

Espacio: move up.

C or Ctrl: move down.

Shift: move faster.

Esc: release the cursor.
