// Display corrections only: keep the original pack transcription in the database.
// Unknown names and CI numbers must survive without guessing their identity.
const NAMES = new Map(Object.entries({
  'microcrystalline wax': 'Microcrystalline Wax',
  'bees wax': 'Beeswax',
  'propyl paraben': 'Propylparaben',
  'tocopheryl acetate': 'Tocopheryl Acetate',
  'parfume': 'Parfum',
  'parfum': 'Parfum',
  'butyrospermum parkii [butter]': 'Butyrospermum Parkii Butter',
  'isopropyl myristate': 'Isopropyl Myristate',
  'nigella sativa seed oil': 'Nigella Sativa Seed Oil',
}));

export function productIngredients(value) {
  const ingredients = [];
  const optionalColourants = [];
  const text = String(value ?? '').trim();
  // Protect the minus in the pack's +/– marker before splitting list dashes.
  const entries = text.replace(/\+\s*\/\s*[-–−]/g, '±')
    .split(/\s*[–—]\s*|\s+-\s+|[\r\n;]+/).map(item => item.trim()).filter(Boolean);

  for (const entry of entries) {
    const colourant = entry.match(/^±\s*CI\s*(\d{5})$/i);
    if (colourant) optionalColourants.push(`CI ${colourant[1]}`);
    else ingredients.push(NAMES.get(entry.toLowerCase()) ?? entry);
  }
  return { ingredients, optionalColourants };
}
