# DC-TIM Frontend

A React-based platform for model-driven national development policy analysis. The application lets policymakers visualise development indicators, optimise policy levers, query the model, and feed it custom training data.

## Features

- **Model-Powered Dashboard** — Visualise development indicators across education, healthcare, economic, infrastructure, governance, and environment, updated in real time by the model.
- **Policy Optimization** — Adjust policy levers and see projected outcomes with before/after comparisons, surfacing high-impact interventions across every indicator.
- **Model Prompt Interface** — Ask the model anything about national development policies and get contextual, evidence-based answers drawn from your training data.
- **Model Training** — Feed the model your own Q&A pairs, knowledge entries, and documents to build a specialised model tailored to your policy context.
- **Model Configuration** — Configure and register new model instances.
- **Policy Monitoring** — Track model and policy performance.
- **Authentication** — Protected routes with login required for all workspace pages.

## Tech Stack

- [React](https://react.dev) 19 with [TypeScript](https://www.typescriptlang.org) (`~6.0`)
- [Vite](https://vite.dev) 8 for fast development and builds
- [React Router](https://reactrouter.com) 7 for client-side routing
- [Tailwind CSS](https://tailwindcss.com) 4 for styling
- [Recharts](https://recharts.org) 3 for data visualisation
- [ESLint](https://eslint.org) 10 with typed lint rules for code quality

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) (version 18+ recommended)
- npm (bundled with Node.js)

### Installation

```bash
# 1. Install dependencies
npm install

# 2. Start the development server
npm run dev
```

The app runs at `http://localhost:5173` by default.

## Available Scripts

| Command             | Description                                  |
| ------------------- | -------------------------------------------- |
| `npm run dev`       | Start the Vite development server            |
| `npm run build`     | Type-check and build for production          |
| `npm run lint`      | Run ESLint over the codebase                 |
| `npm run preview`   | Preview the production build locally         |

## Project Structure

```
src/
├── assets/          # Images, icons, and Lottie animations
├── components/      # Reusable UI components (Button, Card, Navbar, etc.)
├── context/         # React context (authentication, analysis)
├── pages/           # Route-level pages
├── routes/          # Application routing setup
├── App.tsx          # Root component
├── index.css        # Global styles (Tailwind)
└── main.tsx         # Application entry point
```

## Key Routes

| Path             | Page                         | Access    |
| ---------------- | ---------------------------- | --------- |
| `/`              | Landing page                 | Public    |
| `/login`         | Sign in                      | Public    |
| `/dashboard`     | Model-powered dashboard      | Protected |
| `/prompt`        | Model prompt interface       | Protected |
| `/optimize`      | Policy optimization          | Protected |
| `/monitoring`    | Policy monitoring            | Protected |
| `/models/new`    | Model configuration          | Protected |
| `*`              | 404 not found                | Public    |

## Digital Twin map renderer

The Digital Twin uses CesiumJS for its map by default. Set the public browser
configuration `VITE_CESIUM_ION_ACCESS_TOKEN` in `.env.local` to enable Cesium
World Terrain and Cesium OSM Buildings (asset access must be enabled for both).
Copy `.env.example` to `.env.local`, set the token, and restart Vite. Without an
authorized token, the Esri imagery map remains available over an ellipsoid and
the UI reports that terrain/buildings are unavailable. `?sceneDebug=1` displays
the camera coordinates, terrain/building request state, tile counts, and a
temporary Kigali marker. `?engine=three` is the rollback renderer, and
`?engine=prototype` opens the earlier isolated buildings diagnostics view.

Cesium OSM Buildings and World Terrain stream through Cesium ion; OSM-derived
content requires © OpenStreetMap contributors attribution. Esri World Imagery
attribution is displayed on the map. Esri service access and commercial use are
subject to the applicable [Esri service terms](https://www.esri.com/en-us/legal/terms/web-site-service)
and its third-party imagery restrictions; verify that your deployment's use is
licensed. The ion token is browser-visible, so restrict it to required assets
and allowed origins. Never use a server secret in a Vite `VITE_` variable.

## Building for Production

```bash
npm run build
npm run preview
```

The production build is emitted to the `dist/` directory and can be served by any static file server.
