# GitForest

A full-screen open world 3D GitHub developer visualization. Each developer is a tree — more commits means a taller, denser, more mature tree. All trees live together in a shared 3D forest world.

## Features
- **Open World 3D Forest**: Full-screen Three.js WebGL scene — one forest, all developers together
- **Tree Stages**: 5 stages driven by estimated commit count:
  - 🌱 Seedling (< 20 commits): tiny sapling
  - 🌿 Sapling (20–79): small tree with 2 layers
  - 🌲 Young Tree (80–199): medium tree with 3 cone layers
  - 🌳 Mature (200–499): tall tree with 5 layers + branches
  - 🏔️ Ancient (500+): massive tree with 7 layers + golden particles
- **Orbital Camera**: Left-drag to orbit, scroll to zoom, right-drag to pan
- **Floating Nameplates**: HTML labels hover above each tree, color-coded by status
- **Click to Inspect**: Click any tree to see a glass info panel with full GitHub stats
- **Activity Status**: active / moderate / occasional / inactive (based on last push date)
- **Add/Remove Devs**: Add any public GitHub username, trees grow into the world
- **Dark Mode**: Atmospheric nighttime forest with firefly particles
- **WebGL Fallback**: Card-based fallback for browsers without WebGL support
- **Staggered API Loading**: Stats load 1.2s apart to avoid GitHub rate limits

## Architecture
- **Frontend**: React + TypeScript + Three.js (raw WebGL) + TanStack Query + Wouter
- **Backend**: Express.js with GitHub API proxy and 10-minute cache
- **Storage**: In-memory (MemStorage) — seeds 5 famous devs on start

## Key Components
- `client/src/components/ForestWorld.tsx` — Full Three.js 3D scene with all trees, lights, camera controls, raycasting, nameplate projection
- `client/src/pages/Home.tsx` — Glass overlay UI (header, add panel, user info panel, legend, controls hint)
- `server/routes.ts` — GitHub API proxy with 10-min in-memory cache

## Default Users
torvalds, gaearon, yyx990803, sindresorhus, addyosmani

## Environment Variables
- `GITHUB_TOKEN` (optional): Increases GitHub API rate limit from 60/hr → 5,000/hr

## Running
`npm run dev` — starts Express (port 5000) + Vite on the same port
