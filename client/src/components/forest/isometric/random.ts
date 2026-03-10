export function rng(seed: number, index: number) {
  return Math.abs(Math.sin(seed * 127.1 + index * 311.7 + 43758.5453)) % 1;
}
