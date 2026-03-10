import { type TrackedUser } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  getTrackedUsers(): Promise<TrackedUser[]>;
  addTrackedUser(username: string): Promise<TrackedUser>;
  removeTrackedUser(username: string): Promise<void>;
  isTracked(username: string): Promise<boolean>;
}

export class MemStorage implements IStorage {
  private trackedUsers: Map<string, TrackedUser>;

  constructor() {
    this.trackedUsers = new Map();
    const defaultUsers = ["torvalds", "gaearon", "yyx990803", "sindresorhus", "addyosmani"];
    defaultUsers.forEach((username) => {
      const id = randomUUID();
      const user: TrackedUser = { id, username, addedAt: new Date().toISOString() };
      this.trackedUsers.set(username.toLowerCase(), user);
    });
  }

  async getTrackedUsers(): Promise<TrackedUser[]> {
    return Array.from(this.trackedUsers.values());
  }

  async addTrackedUser(username: string): Promise<TrackedUser> {
    const id = randomUUID();
    const user: TrackedUser = { id, username: username.toLowerCase(), addedAt: new Date().toISOString() };
    this.trackedUsers.set(username.toLowerCase(), user);
    return user;
  }

  async removeTrackedUser(username: string): Promise<void> {
    this.trackedUsers.delete(username.toLowerCase());
  }

  async isTracked(username: string): Promise<boolean> {
    return this.trackedUsers.has(username.toLowerCase());
  }
}

export const storage = new MemStorage();
