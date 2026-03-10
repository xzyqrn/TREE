import { z } from "zod";

export const githubUserSchema = z.object({
  login: z.string(),
  name: z.string().nullable(),
  avatar_url: z.string(),
  bio: z.string().nullable(),
  followers: z.number(),
  following: z.number(),
  public_repos: z.number(),
  html_url: z.string(),
  location: z.string().nullable(),
  company: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const trackedUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  addedAt: z.string(),
});

export const userStatsSchema = z.object({
  login: z.string(),
  name: z.string().nullable(),
  avatar_url: z.string(),
  bio: z.string().nullable(),
  followers: z.number(),
  following: z.number(),
  public_repos: z.number(),
  html_url: z.string(),
  location: z.string().nullable(),
  company: z.string().nullable(),
  totalCommits: z.number(),
  activeDays: z.number(),
  totalStars: z.number(),
  totalForks: z.number(),
  topLanguages: z.array(z.string()),
  status: z.enum(["active", "moderate", "occasional", "inactive"]),
  lastActive: z.string().nullable(),
  created_at: z.string(),
});

export type GithubUser = z.infer<typeof githubUserSchema>;
export type TrackedUser = z.infer<typeof trackedUserSchema>;
export type UserStats = z.infer<typeof userStatsSchema>;

export const addUserSchema = z.object({
  username: z.string().min(1).max(39),
});
export type AddUser = z.infer<typeof addUserSchema>;
