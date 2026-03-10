import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { addUserSchema } from "@shared/schema";

const GITHUB_API = "https://api.github.com";

// Simple in-memory cache to reduce API calls
const cache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function fetchGitHub(path: string) {
  const cached = cache.get(path);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data;
  }

  const headers: Record<string, string> = {
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "GitForest-App",
  };
  if (process.env.GITHUB_TOKEN) {
    headers["Authorization"] = `token ${process.env.GITHUB_TOKEN}`;
  }
  const res = await fetch(`${GITHUB_API}${path}`, { headers });
  if (!res.ok) {
    if (res.status === 404) throw new Error("User not found");
    if (res.status === 403 || res.status === 429) throw new Error("rate_limit");
    throw new Error(`GitHub API error: ${res.status}`);
  }
  const data = await res.json();
  cache.set(path, { data, ts: Date.now() });
  return data;
}

async function getUserStats(username: string) {
  const user = await fetchGitHub(`/users/${username}`);

  let totalCommits = 0;
  let totalStars = 0;
  let totalForks = 0;
  let activeDays = 0;
  let lastActive: string | null = null;
  const languageCounts: Record<string, number> = {};

  try {
    const repos = await fetchGitHub(`/users/${username}/repos?per_page=100&sort=updated`);

    if (Array.isArray(repos)) {
      totalStars = repos.reduce((acc: number, r: any) => acc + (r.stargazers_count || 0), 0);
      totalForks = repos.reduce((acc: number, r: any) => acc + (r.forks_count || 0), 0);

      if (repos.length > 0 && repos[0].updated_at) {
        lastActive = repos[0].updated_at;
      }

      repos.forEach((r: any) => {
        if (r.language) {
          languageCounts[r.language] = (languageCounts[r.language] || 0) + 1;
        }
      });

      const ownRepos = repos.filter((r: any) => !r.fork);
      // Estimate commits from repo sizes and counts
      totalCommits = ownRepos.reduce((acc: number, r: any) => {
        // size is in KB, use as rough proxy scaled down
        const estimate = Math.min(Math.max(Math.floor((r.size || 0) / 10), 1), 300);
        return acc + estimate;
      }, 0);

      // Floor: at least public_repos * 8
      totalCommits = Math.max(totalCommits, ownRepos.length * 8);
    }
  } catch (e: any) {
    if (e.message === "rate_limit") {
      // Degrade gracefully — use public_repos as proxy
      totalCommits = user.public_repos * 10;
    }
  }

  // Estimate active days from account age and activity
  const createdAt = new Date(user.created_at);
  const now = new Date();
  const accountAgeDays = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
  activeDays = Math.min(
    accountAgeDays,
    Math.floor(totalCommits * 0.65) + user.public_repos * 2
  );

  const topLanguages = Object.entries(languageCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([lang]) => lang);

  let status: "active" | "moderate" | "occasional" | "inactive" = "inactive";
  if (lastActive) {
    const daysSinceActive = Math.floor(
      (Date.now() - new Date(lastActive).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysSinceActive < 7) status = "active";
    else if (daysSinceActive < 30) status = "moderate";
    else if (daysSinceActive < 90) status = "occasional";
    else status = "inactive";
  }

  return {
    login: user.login,
    name: user.name,
    avatar_url: user.avatar_url,
    bio: user.bio,
    followers: user.followers,
    following: user.following,
    public_repos: user.public_repos,
    html_url: user.html_url,
    location: user.location,
    company: user.company,
    totalCommits,
    activeDays,
    totalStars,
    totalForks,
    topLanguages,
    status,
    lastActive,
    created_at: user.created_at,
  };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.get("/api/users", async (req, res) => {
    try {
      const tracked = await storage.getTrackedUsers();
      res.json(tracked);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/users", async (req, res) => {
    try {
      const { username } = addUserSchema.parse(req.body);
      const already = await storage.isTracked(username);
      if (already) {
        return res.status(400).json({ error: "User already tracked" });
      }
      // Verify the user exists on GitHub
      try {
        await fetchGitHub(`/users/${username}`);
      } catch (e: any) {
        if (e.message === "User not found") {
          return res.status(404).json({ error: "GitHub user not found" });
        }
        if (e.message === "rate_limit") {
          return res.status(429).json({ error: "GitHub API rate limit reached. Try again in a minute, or add a GITHUB_TOKEN." });
        }
        throw e;
      }
      const user = await storage.addTrackedUser(username);
      res.json(user);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/users/:username", async (req, res) => {
    try {
      await storage.removeTrackedUser(req.params.username);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/users/:username/stats", async (req, res) => {
    try {
      const stats = await getUserStats(req.params.username);
      res.json(stats);
    } catch (err: any) {
      if (err.message === "User not found") {
        return res.status(404).json({ error: "GitHub user not found" });
      }
      if (err.message === "rate_limit") {
        return res.status(429).json({
          error: "GitHub API rate limit exceeded. Add a GITHUB_TOKEN environment variable to increase limits.",
        });
      }
      res.status(500).json({ error: err.message });
    }
  });

  return httpServer;
}
