import categoryStructure from '@/data/categoryStructure.json';

/**
 * Transform the static category_structure.json into an array format
 * suitable for the CategoryFilter component.
 *
 * Output: [{ id: string, name: string, subcategories: [{ id: string, name: string }] }]
 */
export const getAllCategories = () => {
  const result = [];
  for (const [catName, catData] of Object.entries(categoryStructure)) {
    const category = {
      id: String(catData.id),
      name: catName,
      subcategories: [],
    };
    if (catData.sub_categories) {
      for (const [subName, subData] of Object.entries(catData.sub_categories)) {
        category.subcategories.push({
          id: String(subData.id),
          name: subName,
        });
      }
    }
    result.push(category);
  }
  return result;
};

/**
 * Build a lookup map for quick name resolution by ID.
 * { categoryId: { name, subcategories: { subCategoryId: name } } }
 */
export const getCategoryLookupMap = () => {
  const map = new Map();
  for (const [catName, catData] of Object.entries(categoryStructure)) {
    const catId = String(catData.id);
    const subMap = new Map();
    if (catData.sub_categories) {
      for (const [subName, subData] of Object.entries(catData.sub_categories)) {
        subMap.set(String(subData.id), subName);
      }
    }
    map.set(catId, { name: catName, subcategories: subMap });
  }
  return map;
};

/**
 * Get category + subcategory name by IDs.
 */
export const getCategoryNamesById = (categoryId, subCategoryId) => {
  if (!categoryId) return { categoryName: null, subCategoryName: null };
  const map = getCategoryLookupMap();
  const cat = map.get(String(categoryId));
  if (!cat) return { categoryName: null, subCategoryName: null };
  return {
    categoryName: cat.name,
    subCategoryName: subCategoryId ? cat.subcategories.get(String(subCategoryId)) || null : null,
  };
};
