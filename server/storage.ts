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
    const defaultUsers = [
      // ── Core / OS / Systems ─────────────────────────────────────────────────
      "torvalds",       // Linux kernel
      "antirez",        // Redis
      "gvanrossum",     // Python
      "matz",           // Ruby
      "dhh",            // Ruby on Rails
      "fabpot",         // Symfony / PHP
      "nikic",          // PHP core / LLVM
      "BurntSushi",     // Rust tools (ripgrep, etc.)
      "matklad",        // rust-analyzer
      "compiler-errors",// Rust compiler
      // ── JavaScript / Frontend ───────────────────────────────────────────────
      "gaearon",        // React (Dan Abramov)
      "yyx990803",      // Vue.js (Evan You)
      "sindresorhus",   // npm ecosystem
      "addyosmani",     // Google Chrome DevRel
      "tj",             // Express, countless Node tools
      "jeresig",        // jQuery
      "mrdoob",         // Three.js
      "jashkenas",      // Backbone, CoffeeScript, Underscore
      "getify",         // You Don't Know JS
      "paulirish",      // Chrome DevTools
      "ryanflorence",   // React Router / Remix
      "evanw",          // esbuild
      "nicolo-ribaudo", // Babel
      "acornjs",        // Acorn JS parser
      "Rich-Harris",    // Svelte, Rollup
      "sveltejs",       // (org) Svelte
      "nickhudkins",    // styled-components
      "developit",      // Preact (Jason Miller)
      "mjackson",       // Remix co-creator
      "kentcdodds",     // Testing Library, Epic React
      "tannerlinsley",  // TanStack (React Query etc.)
      "markdalgleish",  // CSS Modules, Braid
      // ── Build tools / Compilers ─────────────────────────────────────────────
      "sebmck",         // Babel creator (Sebastian McKenzie)
      "nicolo-ribaudo", // skip dup — already above
      "ealush",         // Vest
      "sokra",          // webpack (Tobias Koppers)
      "nystudio107",    // Craft CMS / Vite
      // ── GitHub / DevTools / CLI ─────────────────────────────────────────────
      "defunkt",        // GitHub co-founder
      "mojombo",        // GitHub co-founder, Jekyll
      "pjhyett",        // GitHub co-founder
      "wycats",         // Bundler, Ember, Cargo
      "tenderlove",     // Ruby core, Rails
      "indirect",       // Bundler co-creator
      // ── Go ──────────────────────────────────────────────────────────────────
      "bradfitz",       // Go stdlib
      "griesemer",      // Go language designer
      "rsc",            // Rob Pike (Go) — small public profile
      "davecheney",     // Go contributor
      // ── Python / ML / Data ──────────────────────────────────────────────────
      "kennethreitz",   // Requests, httpbin
      "jakubroztocil",  // HTTPie
      "psf",            // Python Software Foundation
      "pallets",        // Flask / Jinja2 org
      "tiangolo",       // FastAPI, SQLModel
      "karpathy",       // AI / Tesla / OpenAI
      "fchollet",       // Keras / TensorFlow
      "huggingface",    // Transformers
      // ── Rust ────────────────────────────────────────────────────────────────
      "steveklabnik",   // Rust docs
      "alexcrichton",   // Rust / Cargo
      "dtolnay",        // serde, syn, anyhow
      "burntsushi",     // skip dup — already above as BurntSushi
      // ── DevOps / Infrastructure ─────────────────────────────────────────────
      "mitchellh",      // HashiCorp / Vagrant / Go libs
      "nathanmarz",     // Storm / Cascalog
      "jpetazzo",       // Docker
      "crosbymichael",  // Docker core
      // ── Mobile ──────────────────────────────────────────────────────────────
      "nicklockwood",   // iOS developer
      "mattt",          // Alamofire, NSHipster
      // ── Databases ───────────────────────────────────────────────────────────
      "neumino",        // RethinkDB
      "soveran",        // Ohm, Redis tools
      // ── Documentation / DX ──────────────────────────────────────────────────
      "prose",          // Prose.io
      "bkeepers",       // GitHub staff
      // ── Open-source all-rounders ────────────────────────────────────────────
      "nicowillis",     // Designer / open-source
      "substack",       // browserify, many npm packages
      "feross",         // WebTorrent, StandardJS
      "juliangruber",   // streams, npm
      "max-mapper",     // dat project
      "aheckmann",      // Mongoose, many Node libs
      "visionmedia",    // (same as tj — skip)
      "creationix",     // nvm, js.io
      "isaacs",         // npm founder
      "mikeal",         // npm, request
      "bnoordhuis",     // Node.js core
      "indutny",        // Node.js / crypto
      "piscisaureus",   // Node.js / libuv
      "joyent",         // Node.js org
      // ── Academic / Research ─────────────────────────────────────────────────
      "jonls",          // scientific tools
      "JuliaLang",      // Julia language
      "matplotlib",     // matplotlib org
      "numpy",          // NumPy org
      "scipy",          // SciPy org
      // ── CSS / Design systems ────────────────────────────────────────────────
      "csswg-drafts",   // CSS Working Group
      "mdo",            // Bootstrap (Mark Otto)
      "fat",            // Bootstrap (Jacob Thornton)
      "necolas",        // normalize.css
      "stubbornella",   // OOCSS (Nicole Sullivan)
      // ── Security / Crypto ───────────────────────────────────────────────────
      "nneonneo",       // CTF / security
      "taviso",         // Google Project Zero
      // ── Content / Education ─────────────────────────────────────────────────
      "wesbos",         // JavaScript educator
      "stolinski",      // Level Up Tutorials
      "cassidoo",       // developer advocate
      "swyx",           // Developer DX / writing
      "jsjoeio",        // Developer relations
    ];

    // Deduplicate (lowercase)
    const seen = new Set<string>();
    const unique = defaultUsers.filter(u => {
      const k = u.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    unique.forEach((username) => {
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
