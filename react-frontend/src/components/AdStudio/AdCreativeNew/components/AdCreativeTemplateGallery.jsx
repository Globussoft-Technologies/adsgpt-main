import React, { useMemo } from 'react';
import { ChevronDown, ChevronUp, SlidersHorizontal, Sparkles } from 'lucide-react';

export const CATEGORIES = [
  { id: 'all', label: 'All Templates' },
  { id: 'ecommerce', label: 'E-commerce & D2C' },
  { id: 'saas', label: 'SaaS & App' },
  { id: 'editorial', label: 'Editorial & Fashion' },
  { id: 'ugc', label: 'Before / After & UGC' },
];

export const TEMPLATES = [
  {
    id: 't-1',
    category: 'editorial',
    categoryLabel: 'FASHION & APPAREL',
    title: 'Monochrome Fall Collection',
    aspectRatio: '4:5 Portrait',
    image: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=700&q=80',
    ctr: '4.8%',
    moduleKey: 'lifestyle',
  },
  {
    id: 't-2',
    category: 'saas',
    categoryLabel: 'FINTECH & SAAS',
    title: 'Card Payment Floating UI Mockup',
    aspectRatio: '1:1 Square',
    image: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=700&q=80',
    ctr: '5.2%',
    moduleKey: 'apps-saas',
  },
  {
    id: 't-3',
    category: 'ecommerce',
    categoryLabel: 'BEAUTY & WELLNESS',
    title: 'Hydrating Essence Botanical',
    aspectRatio: '4:5 Minimal',
    image: 'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=700&q=80',
    ctr: '6.1%',
    moduleKey: 'product-shot',
  },
  {
    id: 't-4',
    category: 'ugc',
    categoryLabel: 'UGC TESTIMONIAL',
    title: 'Morning Routine Honest Reaction',
    aspectRatio: 'UGC Testimonial',
    image: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=700&q=80',
    ctr: '7.4%',
    moduleKey: 'lifestyle',
  },
  {
    id: 't-5',
    category: 'ecommerce',
    categoryLabel: 'ACCESSORIES',
    title: 'Heritage Chronometer',
    aspectRatio: '4:5 Luxury',
    image: 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=700&q=80',
    ctr: '5.0%',
    moduleKey: 'product-shot',
  },
  {
    id: 't-6',
    category: 'editorial',
    categoryLabel: 'LUXURY & STYLE',
    title: 'Evening Silhouette Noir',
    aspectRatio: '4:5 Portrait',
    image: 'https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=700&q=80',
    ctr: '5.6%',
    moduleKey: 'lifestyle',
  },
  {
    id: 't-7',
    category: 'saas',
    categoryLabel: 'DEV TOOLS',
    title: 'Cloud Metrics Dark Mode Dashboard',
    aspectRatio: '16:9 Banner',
    image: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=700&q=80',
    ctr: '4.4%',
    moduleKey: 'apps-saas',
  },
  {
    id: 't-8',
    category: 'ecommerce',
    categoryLabel: 'FOOTWEAR',
    title: 'Aerodynamic Knit Runner',
    aspectRatio: '1:1 Square',
    image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=700&q=80',
    ctr: '6.8%',
    moduleKey: 'product-shot',
  },
  {
    id: 't-9',
    category: 'ugc',
    categoryLabel: 'SKINCARE UGC',
    title: '7-Day Glow Result Comparison',
    aspectRatio: '9:16 Story',
    image: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=700&q=80',
    ctr: '8.1%',
    moduleKey: 'ai-creatives',
  },
  {
    id: 't-10',
    category: 'editorial',
    categoryLabel: 'JEWELRY & GOLD',
    title: 'Sculptural Minimalist Rings',
    aspectRatio: '4:5 Luxury',
    image: 'https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=700&q=80',
    ctr: '5.9%',
    moduleKey: 'product-shot',
  },
  {
    id: 't-11',
    category: 'ecommerce',
    categoryLabel: 'ORGANIC BEVERAGE',
    title: 'Cold Brew Citrus Infusion',
    aspectRatio: '4:5 Minimal',
    image: 'https://images.unsplash.com/photo-1517256064527-09c73fc73e38?auto=format&fit=crop&w=700&q=80',
    ctr: '6.3%',
    moduleKey: 'product-shot',
  },
  {
    id: 't-12',
    category: 'saas',
    categoryLabel: 'PRODUCTIVITY APP',
    title: 'Team Workspaces Collaboration UI',
    aspectRatio: '1:1 Square',
    image: 'https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?auto=format&fit=crop&w=700&q=80',
    ctr: '5.7%',
    moduleKey: 'apps-saas',
  },
  {
    id: 't-13',
    category: 'ugc',
    categoryLabel: 'HOME & DECOR',
    title: 'Living Room Makeover Unboxing',
    aspectRatio: 'UGC Testimonial',
    image: 'https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=700&q=80',
    ctr: '7.0%',
    moduleKey: 'brand-awareness',
  },
  {
    id: 't-14',
    category: 'editorial',
    categoryLabel: 'STREETWEAR',
    title: 'Urban Oversized Hoodie Drop',
    aspectRatio: '4:5 Portrait',
    image: 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?auto=format&fit=crop&w=700&q=80',
    ctr: '5.5%',
    moduleKey: 'lifestyle',
  },
  {
    id: 't-15',
    category: 'ecommerce',
    categoryLabel: 'AUDIO & TECH',
    title: 'Noise Canceling Over-Ear Studio',
    aspectRatio: '1:1 Square',
    image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=700&q=80',
    ctr: '6.5%',
    moduleKey: 'product-shot',
  },
  {
    id: 't-16',
    category: 'editorial',
    categoryLabel: 'SUMMER RUNWAY',
    title: 'Pastel Resortwear Lookbook',
    aspectRatio: '9:16 Story',
    image: 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=700&q=80',
    ctr: '6.7%',
    moduleKey: 'lifestyle',
  },
  {
    id: 't-17',
    category: 'saas',
    categoryLabel: 'AI ANALYTICS',
    title: 'Real-time Conversions Graph',
    aspectRatio: '16:9 Banner',
    image: 'https://images.unsplash.com/photo-1551836022-d5d88e9218df?auto=format&fit=crop&w=700&q=80',
    ctr: '5.4%',
    moduleKey: 'apps-saas',
  },
  {
    id: 't-18',
    category: 'ecommerce',
    categoryLabel: 'COSMETICS',
    title: 'Matte Velvet Lip Color Palette',
    aspectRatio: '1:1 Square',
    image: 'https://images.unsplash.com/photo-1512496015851-a90fb38ba796?auto=format&fit=crop&w=700&q=80',
    ctr: '7.2%',
    moduleKey: 'product-shot',
  },
  {
    id: 't-19',
    category: 'ugc',
    categoryLabel: 'FITNESS UGC',
    title: '30-Day Workout Progress Reel',
    aspectRatio: '9:16 Story',
    image: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?auto=format&fit=crop&w=700&q=80',
    ctr: '8.4%',
    moduleKey: 'lifestyle',
  },
  {
    id: 't-20',
    category: 'ecommerce',
    categoryLabel: 'FRAGRANCE',
    title: 'Amber & Cedarwood Eau De Parfum',
    aspectRatio: '4:5 Luxury',
    image: 'https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?auto=format&fit=crop&w=700&q=80',
    ctr: '6.9%',
    moduleKey: 'product-shot',
  },
  {
    id: 't-21',
    category: 'editorial',
    categoryLabel: 'SUNGLASSES & OPTICS',
    title: 'Retro Aviator Gold Frame',
    aspectRatio: '1:1 Square',
    image: 'https://images.unsplash.com/photo-1511499767150-a48a237f0083?auto=format&fit=crop&w=700&q=80',
    ctr: '5.8%',
    moduleKey: 'product-shot',
  },
  {
    id: 't-22',
    category: 'saas',
    categoryLabel: 'MOBILE BANKING',
    title: 'Instant Global Remittance App',
    aspectRatio: '9:16 Story',
    image: 'https://images.unsplash.com/photo-1563986768609-322da13575f3?auto=format&fit=crop&w=700&q=80',
    ctr: '6.2%',
    moduleKey: 'apps-saas',
  },
  {
    id: 't-23',
    category: 'ugc',
    categoryLabel: 'COFFEE & FOOD',
    title: 'Espresso Barista First Sip Review',
    aspectRatio: 'UGC Testimonial',
    image: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=700&q=80',
    ctr: '7.9%',
    moduleKey: 'lifestyle',
  },
  {
    id: 't-24',
    category: 'ecommerce',
    categoryLabel: 'CERAMICS & DINING',
    title: 'Handcrafted Stoneware Set',
    aspectRatio: '4:5 Minimal',
    image: 'https://images.unsplash.com/photo-1610701596007-11502861dcfa?auto=format&fit=crop&w=700&q=80',
    ctr: '5.1%',
    moduleKey: 'product-shot',
  },
  {
    id: 't-25',
    category: 'editorial',
    categoryLabel: 'OUTDOOR APPAREL',
    title: 'Alpine Weatherproof Shell Jacket',
    aspectRatio: '4:5 Portrait',
    image: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=700&q=80',
    ctr: '6.4%',
    moduleKey: 'lifestyle',
  },
  {
    id: 't-26',
    category: 'saas',
    categoryLabel: 'CRM PLATFORM',
    title: 'Pipeline Automation Kanban Flow',
    aspectRatio: '16:9 Banner',
    image: 'https://images.unsplash.com/photo-1531403009284-440f080d1e12?auto=format&fit=crop&w=700&q=80',
    ctr: '4.9%',
    moduleKey: 'apps-saas',
  },
  {
    id: 't-27',
    category: 'ecommerce',
    categoryLabel: 'SMARTWATCHES',
    title: 'Titanium Fitness Tracker Pro',
    aspectRatio: '1:1 Square',
    image: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=700&q=80',
    ctr: '7.1%',
    moduleKey: 'product-shot',
  },
  {
    id: 't-28',
    category: 'ugc',
    categoryLabel: 'HAIRCARE UGC',
    title: 'Silk Pillowcase Wash & Blowout',
    aspectRatio: '9:16 Story',
    image: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=700&q=80',
    ctr: '8.7%',
    moduleKey: 'ai-creatives',
  },
  {
    id: 't-29',
    category: 'editorial',
    categoryLabel: 'FOOTWEAR DROP',
    title: 'Retro Chunky Leather Sneaker',
    aspectRatio: '4:5 Luxury',
    image: 'https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?auto=format&fit=crop&w=700&q=80',
    ctr: '6.0%',
    moduleKey: 'product-shot',
  },
  {
    id: 't-30',
    category: 'ecommerce',
    categoryLabel: 'ORGANIC MATCHA',
    title: 'Ceremonial Grade Kyoto Matcha',
    aspectRatio: '4:5 Minimal',
    image: 'https://images.unsplash.com/photo-1536256263959-770b48d82b0a?auto=format&fit=crop&w=700&q=80',
    ctr: '5.9%',
    moduleKey: 'product-shot',
  },
  {
    id: 't-31',
    category: 'saas',
    categoryLabel: 'DESIGN SYSTEM',
    title: 'Vector Component Library Plugin',
    aspectRatio: '16:9 Banner',
    image: 'https://images.unsplash.com/photo-1581291518655-9523c932deda?auto=format&fit=crop&w=700&q=80',
    ctr: '5.3%',
    moduleKey: 'apps-saas',
  },
  {
    id: 't-32',
    category: 'ugc',
    categoryLabel: 'TECH UNBOXING',
    title: 'Mechanical Keyboard Sound Test',
    aspectRatio: 'UGC Testimonial',
    image: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=700&q=80',
    ctr: '7.6%',
    moduleKey: 'brand-awareness',
  },
  {
    id: 't-33',
    category: 'editorial',
    categoryLabel: 'FINE JEWELRY',
    title: 'Emerald Cut Solitaire Pendant',
    aspectRatio: '1:1 Square',
    image: 'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=700&q=80',
    ctr: '6.3%',
    moduleKey: 'product-shot',
  },
  {
    id: 't-34',
    category: 'ecommerce',
    categoryLabel: 'LEATHER GOODS',
    title: 'Full-Grain Bifold Minimalist Wallet',
    aspectRatio: '4:5 Luxury',
    image: 'https://images.unsplash.com/photo-1627123424574-724758594e93?auto=format&fit=crop&w=700&q=80',
    ctr: '5.5%',
    moduleKey: 'product-shot',
  },
  {
    id: 't-35',
    category: 'saas',
    categoryLabel: 'CYBERSECURITY',
    title: 'Zero Trust Authentication Shield',
    aspectRatio: '9:16 Story',
    image: 'https://images.unsplash.com/photo-1563013544-824ae1b704d3?auto=format&fit=crop&w=700&q=80',
    ctr: '6.8%',
    moduleKey: 'apps-saas',
  },
  {
    id: 't-36',
    category: 'ugc',
    categoryLabel: 'PET CARE UGC',
    title: 'Organic Puppy Food Taste Test',
    aspectRatio: '9:16 Story',
    image: 'https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?auto=format&fit=crop&w=700&q=80',
    ctr: '8.9%',
    moduleKey: 'ai-creatives',
  },
  {
    id: 't-37',
    category: 'editorial',
    categoryLabel: 'AVANT-GARDE',
    title: 'Architectural Tailored Blazer',
    aspectRatio: '4:5 Portrait',
    image: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=700&q=80',
    ctr: '6.1%',
    moduleKey: 'lifestyle',
  },
  {
    id: 't-38',
    category: 'ecommerce',
    categoryLabel: 'PLANT-BASED FOOD',
    title: 'Artisanal Oat Milk Cold Brew',
    aspectRatio: '1:1 Square',
    image: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?auto=format&fit=crop&w=700&q=80',
    ctr: '6.4%',
    moduleKey: 'product-shot',
  },
  {
    id: 't-39',
    category: 'saas',
    categoryLabel: 'VIDEO EDITOR AI',
    title: 'Timeline Multi-track Subtitle Auto-sync',
    aspectRatio: '16:9 Banner',
    image: 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?auto=format&fit=crop&w=700&q=80',
    ctr: '5.6%',
    moduleKey: 'apps-saas',
  },
  {
    id: 't-40',
    category: 'ugc',
    categoryLabel: 'TRAVEL GEAR',
    title: 'Carry-On Packing Cube Routine',
    aspectRatio: 'UGC Testimonial',
    image: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=700&q=80',
    ctr: '7.7%',
    moduleKey: 'brand-awareness',
  },
  {
    id: 't-41',
    category: 'ecommerce',
    categoryLabel: 'AUDIO GEAR',
    title: 'Hi-Fi Wireless Earbuds ANC',
    aspectRatio: '4:5 Minimal',
    image: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?auto=format&fit=crop&w=700&q=80',
    ctr: '7.3%',
    moduleKey: 'product-shot',
  },
  {
    id: 't-42',
    category: 'editorial',
    categoryLabel: 'LUXURY TIMEPIECE',
    title: 'Skeleton Automatic Chronograph',
    aspectRatio: '4:5 Luxury',
    image: 'https://images.unsplash.com/photo-1524805444758-089113d48a6d?auto=format&fit=crop&w=700&q=80',
    ctr: '6.6%',
    moduleKey: 'product-shot',
  },
  {
    id: 't-43',
    category: 'saas',
    categoryLabel: 'EMAIL MARKETING',
    title: 'Drip Sequence Conversion Analytics',
    aspectRatio: '16:9 Banner',
    image: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&w=700&q=80',
    ctr: '5.0%',
    moduleKey: 'apps-saas',
  },
  {
    id: 't-44',
    category: 'ugc',
    categoryLabel: 'CLEAN BEAUTY',
    title: 'Hydra-Plump Serum Day 14 Results',
    aspectRatio: '9:16 Story',
    image: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=700&q=80',
    ctr: '8.3%',
    moduleKey: 'ai-creatives',
  },
  {
    id: 't-45',
    category: 'ecommerce',
    categoryLabel: 'WELLNESS & CANDLES',
    title: 'Soy Wax Hand-Poured Candle',
    aspectRatio: '1:1 Square',
    image: 'https://images.unsplash.com/photo-1603006905003-be475563bc59?auto=format&fit=crop&w=700&q=80',
    ctr: '6.2%',
    moduleKey: 'product-shot',
  },
];

export function AdCreativeTemplateHeader({
  activeCategory = 'all',
  setActiveCategory,
  isExpanded = false,
  onToggleExpand,
  className = '',
}) {
  return (
    <div className={`w-full flex flex-col md:flex-row md:items-center justify-between gap-3 ${className}`}>
      {/* Title + Proven Winners Badge */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-400 border border-amber-300/80 dark:border-amber-700/50 px-2.5 py-0.5 text-[10px] 2xl:text-[11px] font-bold tracking-wider uppercase shadow-xs select-none">
          <Sparkles className="h-3 w-3" />
          PROVEN WINNERS
        </span>
        <h2 className="text-base sm:text-lg 2xl:text-xl font-bold text-zinc-900 dark:text-white tracking-tight select-none">
          Trending Image Templates
        </h2>
        <span className="hidden sm:inline text-xs text-zinc-500 dark:text-zinc-400 font-normal select-none">
          • High-converting ad templates
        </span>
      </div>

      {/* Filter Pills + Settings Button + Expand/Collapse Button */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 sm:pb-0 scrollbar-none select-none">
        {CATEGORIES.map((cat) => {
          const isActive = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setActiveCategory?.(cat.id)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs 2xl:text-[12.5px] font-medium transition-all duration-200 cursor-pointer ${
                isActive
                  ? 'bg-zinc-900 text-white shadow-xs dark:bg-white dark:text-zinc-950 font-semibold'
                  : 'bg-white/80 dark:bg-[#1A1A1E] text-zinc-600 dark:text-zinc-300 border border-black/10 dark:border-white/10 hover:bg-zinc-100 dark:hover:bg-[#25252A] hover:text-zinc-900 dark:hover:text-white'
              }`}
            >
              {cat.label}
            </button>
          );
        })}

        <button
          type="button"
          aria-label="Filter settings"
          className="shrink-0 flex h-7.5 w-7.5 items-center justify-center rounded-full border border-black/10 dark:border-white/10 bg-white/80 dark:bg-[#1A1A1E] text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-[#25252A] transition-colors cursor-pointer"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
        </button>

        {/* Expand / Collapse Button */}
        {onToggleExpand && (
          <button
            type="button"
            onClick={onToggleExpand}
            aria-label={isExpanded ? 'Collapse templates drawer' : 'Expand templates drawer'}
            className="shrink-0 flex items-center gap-1.5 rounded-full border border-black/10 dark:border-white/10 bg-white/80 dark:bg-[#1A1A1E] px-2.5 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-[#25252A] hover:text-zinc-900 dark:hover:text-white transition-all cursor-pointer shadow-xs"
          >
            <span>{isExpanded ? 'Collapse' : 'Expand'}</span>
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-zinc-500 dark:text-zinc-400" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5 text-zinc-500 dark:text-zinc-400" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}

export function AdCreativeTemplateMasonry({
  activeCategory = 'all',
  onSelectCategory,
  className = '',
}) {
  const filteredTemplates = useMemo(() => {
    if (activeCategory === 'all') return TEMPLATES;
    return TEMPLATES.filter((t) => t.category === activeCategory);
  }, [activeCategory]);

  return (
    <div className={`w-full ${className}`}>
      {/* Responsive Masonry Gallery (Adapts columns to screen width/ratio) */}
      <div className="columns-2 sm:columns-3 md:columns-4 lg:columns-5 xl:columns-5 2xl:columns-6 min-[2000px]:columns-7 gap-2.5 2xl:gap-3 space-y-2.5 2xl:space-y-3">
        {filteredTemplates.map((template) => (
          <div
            key={template.id}
            onClick={() => onSelectCategory?.(template.moduleKey || 'ai-creatives')}
            className="group relative break-inside-avoid overflow-hidden rounded-xl border border-black/10 dark:border-white/10 bg-zinc-100 dark:bg-zinc-900/60 shadow-xs transition-all duration-300 hover:shadow-lg hover:border-black/20 dark:hover:border-white/20 cursor-pointer"
          >
            {/* Template Image (Natural Aspect Ratio) */}
            <img
              src={template.image}
              alt={template.title}
              loading="lazy"
              className="w-full h-auto object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
            />

            {/* Subtle Gradient Hover Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

            {/* Hover Metadata & Recreate Action */}
            <div className="absolute inset-x-0 bottom-0 z-10 p-3 sm:p-3.5 flex flex-col justify-end text-white opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-1.5 group-hover:translate-y-0">
              <div className="flex items-end justify-between gap-2">
                <div className="min-w-0 flex-1 pr-1">
                  {template.categoryLabel && (
                    <span className="block text-[9px] font-bold tracking-wider text-zinc-300 uppercase mb-0.5 truncate">
                      {template.categoryLabel}
                    </span>
                  )}

                  <h3 className="text-xs sm:text-[12.5px] font-semibold text-white leading-snug line-clamp-2">
                    {template.title}
                  </h3>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectCategory?.(template.moduleKey || 'ai-creatives');
                  }}
                  className="shrink-0 inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[10.5px] font-semibold text-zinc-900 shadow-md backdrop-blur-md transition-all duration-150 hover:bg-zinc-100 hover:scale-105 active:scale-95 cursor-pointer"
                >
                  <Sparkles className="h-3 w-3 text-amber-500" />
                  <span>Recreate</span>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdCreativeTemplateGallery({
  onSelectCategory,
  className = '',
}) {
  const [activeCategory, setActiveCategory] = React.useState('all');

  return (
    <div className={`w-full max-w-[1480px] mx-auto px-3 sm:px-6 2xl:px-8 ${className}`}>
      <AdCreativeTemplateHeader
        activeCategory={activeCategory}
        setActiveCategory={setActiveCategory}
        className="pb-4"
      />
      <div className="w-full pt-1 pb-16">
        <AdCreativeTemplateMasonry
          activeCategory={activeCategory}
          onSelectCategory={onSelectCategory}
        />
      </div>
    </div>
  );
}
