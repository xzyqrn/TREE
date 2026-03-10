# 🌿 GitForest

**GitForest** is a stunning, interactive 3D visualization of GitHub developer ecosystems. It transforms abstract developer statistics—commits, stars, and languages—into a living, breathing digital forest where every developer is represented by a unique tree.

![GitForest Preview](https://github.com/xzyqrn/TREE/raw/main/preview.png) *(Placeholder: Add a real screenshot if available)*

## ✨ Key Features

- **🌲 3D Evolution Architecture**: Developers grow from **Seedlings** (< 100 commits) to **Ancient Trees** (100K+ commits) based on their contributions.
- **📊 Deep Analytics Integration**: Fetches real-time GitHub data including total commits, active days, starry counts, forks, and language proficiency.
- **🎨 Interactive Exploration**: 
  - **Orbit & Zoom**: Explore the forest with smooth 3D camera controls.
  - **Inspect**: Click any tree to reveal the developer's identity, bio, and technical footprint.
- **🔍 Seamless Discovery**: Integrated GitHub user search to plant new "dev-trees" in your forest.
- **🌓 Dynamic UI**: Premium glassmorphic interface with full dark/light mode support.

## 🚀 Getting Started

### Prerequisites
- Node.js (v18 or higher)
- A GitHub Personal Access Token (recommended to avoid rate limits)

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/xzyqrn/TREE.git
   cd TREE
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment**:
   Create a `.env` file in the root directory:
   ```env
   GITHUB_TOKEN=your_github_personal_access_token
   PORT=5000
   ```

4. **Run the development server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:5000](http://localhost:5000) in your browser.

## 🛠 Tech Stack

- **Frontend**: React, TypeScript, Three.js, Lucide React, Shadcn UI
- **Backend**: Express.js, Tsx
- **Data Layer**: TanStack Query (React Query), Zod
- **Styling**: Tailwind CSS, Framer Motion

## 📜 License

Distributed under the MIT License. See `LICENSE` for more information.

---
Built with ❤️ by the GitForest contributors.
