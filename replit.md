# GitForest

A GitHub developer visualization web app that displays developers as trees — more commits means a taller, denser tree.

## Features
- **Tree Visualization**: SVG trees with 5 stages (Seedling → Sapling → Young → Mature → Ancient) based on commit count
- **User Stats**: Shows commits, active days, stars, followers, repos, languages, last active date
- **Activity Status**: active / moderate / occasional / inactive based on last push date
- **Add/Remove**: Track any public GitHub username
- **Dark Mode**: System-aware with manual toggle
- **Tree Sway Animation**: Trees animate on hover

## Architecture
- **Frontend**: React + TypeScript + TanStack Query + Wouter routing + Tailwind CSS + shadcn/ui
- **Backend**: Express.js with GitHub API proxy (avoids CORS, optionally uses GITHUB_TOKEN)
- **Storage**: In-memory (MemStorage) — no database needed, seeds 5 famous devs on start

## Default Tracked Users
torvalds, gaearon, yyx990803, sindresorhus, addyosmani

## Environment Variables
- `GITHUB_TOKEN` (optional): GitHub personal access token to increase API rate limits

## Key Files
- `client/src/components/GitTree.tsx` — SVG tree generator (5 stages, status-aware colors)
- `client/src/components/UserCard.tsx` — User card with tree, stats, languages
- `client/src/pages/Home.tsx` — Main dashboard, add/search users
- `server/routes.ts` — GitHub API proxy, CRUD for tracked users
- `server/storage.ts` — In-memory tracked user list
- `shared/schema.ts` — Zod schemas for GitHub user types

## Running
`npm run dev` — starts Express (backend) + Vite (frontend) on the same port
