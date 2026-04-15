// Distinct, high-contrast wedge colors. Cycles if more players than colors.
const PALETTE = [
  0x4cc3ff, 0xc24cff, 0xff6b6b, 0xffc94c, 0x6ee36e, 0xff8a4c, 0x4cffd2, 0xff4cb1,
  0x9d4cff, 0x4cffa8, 0xffe14c, 0x4c8aff,
];

export function colorForUser(userId: string): number {
  let h = 5381;
  for (let i = 0; i < userId.length; i++) h = ((h << 5) + h + userId.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length]!;
}

export function fadeColor(color: number, factor: number): number {
  const r = ((color >> 16) & 0xff) * factor;
  const g = ((color >> 8) & 0xff) * factor;
  const b = (color & 0xff) * factor;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}
