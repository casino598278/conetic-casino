// Cool steel-blue / accent palette — distinct but harmonious for a casino theme.
const PALETTE = [
  0x6db3ff, // sky
  0x9aa9c8, // steel
  0xf5c863, // gold
  0x6ee3a3, // mint
  0xff6b78, // coral
  0xb39dff, // lavender
  0x4ad6e8, // cyan
  0xffa463, // amber
  0xa3e36e, // lime
  0xff8fc7, // pink
  0x7a8cff, // periwinkle
  0xe6c891, // sand
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
