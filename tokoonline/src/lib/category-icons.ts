import {
  Apple,
  Baby,
  CakeSlice,
  Candy,
  Coffee,
  Cookie,
  CupSoda,
  Droplets,
  Egg,
  Fish,
  FlaskConical,
  HeartPulse,
  Package,
  Pill,
  Shirt,
  Smartphone,
  Sparkles,
  SprayCan,
  Tag,
  Utensils,
  Wheat,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/**
 * A category name -> one outline icon.
 *
 * Category names are free text written by each tenant's staff ("Tepung & Bahan
 * Kering", "Telur & Susu"), so the mapping is by keyword, not by id: the first
 * rule whose words appear in the name wins, and the order below runs from the
 * specific ("bahan kering") to the generic ("makanan") so a long name cannot be
 * captured by its broadest word.
 *
 * Every icon is drawn in the same colour and stroke weight — a marketplace row
 * where each tile had its own colour is exactly what the shop asked not to have.
 */
const RULES: { keywords: string[]; icon: LucideIcon }[] = [
  { keywords: ["tepung", "bahan kering", "beras", "sereal", "gandum"], icon: Wheat },
  { keywords: ["telur", "susu", "dairy", "keju"], icon: Egg },
  { keywords: ["mentega", "margarin", "lemak", "minyak", "santan"], icon: Droplets },
  { keywords: ["pengembang", "pewarna", "essens", "vanili", "baking"], icon: FlaskConical },
  { keywords: ["cokelat", "coklat", "perasa", "selai"], icon: CakeSlice },
  { keywords: ["gula", "pemanis", "sirup", "madu"], icon: Candy },
  { keywords: ["kemasan", "loyang", "kertas", "box", "dus", "packing", "plastik"], icon: Package },
  { keywords: ["kue", "roti", "pastry", "cake"], icon: Cookie },
  { keywords: ["minuman", "kopi", "teh", "jus", "syrup"], icon: CupSoda },
  { keywords: ["buah", "sayur", "segar", "veget"], icon: Apple },
  { keywords: ["daging", "ikan", "seafood", "ayam", "frozen"], icon: Fish },
  { keywords: ["bumbu", "rempah", "masak", "dapur"], icon: Utensils },
  { keywords: ["pakaian", "fashion", "baju", "kain", "tekstil"], icon: Shirt },
  { keywords: ["elektronik", "gadget", "hp", "komputer"], icon: Smartphone },
  { keywords: ["kesehatan", "obat", "vitamin", "herbal"], icon: Pill },
  { keywords: ["bayi", "anak", "balita"], icon: Baby },
  { keywords: ["kecantikan", "perawatan", "skincare", "sabun"], icon: SprayCan },
  { keywords: ["kesehatan tubuh", "medis"], icon: HeartPulse },
  { keywords: ["peralatan", "alat", "tools", "perkakas", "listrik"], icon: Wrench },
  { keywords: ["dekorasi", "aksesoris", "hadiah", "souvenir"], icon: Sparkles },
  { keywords: ["snack", "makanan", "cemilan", "kering"], icon: Cookie },
  { keywords: ["minum"], icon: Coffee },
];

/** Falls back to a plain tag so an unknown category still renders a tile. */
export const FALLBACK_CATEGORY_ICON = Tag;

export function categoryIcon(name: string): LucideIcon {
  const needle = name.toLowerCase();
  for (const rule of RULES) {
    if (rule.keywords.some((keyword) => needle.includes(keyword))) return rule.icon;
  }
  return FALLBACK_CATEGORY_ICON;
}
