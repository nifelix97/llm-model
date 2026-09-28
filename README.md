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

## Building for Production

```bash
npm run build
npm run preview
```

The production build is emitted to the `dist/` directory and can be served by any static file server.