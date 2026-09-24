// The shared source catalogue as declared by the collectors. Each source says which options an
// account may set on its subscription and what one term costs in requests per cycle.
// `npm run db:seed` writes this into source / source_family (options_schema); the API validates
// subscription options against it. Nothing here is account-specific.

export type CollectorStatus = 'live' | 'planned';
export type SourceCategory = 'Marketplace' | 'Online Seller' | 'Price Comparison';
export const SOURCE_CATEGORIES: SourceCategory[] = ['Marketplace', 'Online Seller', 'Price Comparison'];
export type TermType = 'keyword' | 'brand' | 'identifier' | 'url' | 'seller';
export const TERM_TYPES: TermType[] = ['keyword', 'brand', 'identifier', 'url', 'seller'];

export type SourceOption =
  | { key: string; label: string; type: 'boolean'; default: boolean; help?: string }
  | { key: string; label: string; type: 'integer'; default: number; min: number; max: number; help?: string }
  | { key: string; label: string; type: 'enum'; default: string; values: string[]; help?: string };

/**
 * Requests one term of each type costs per cycle on this source. A number is fixed; a string names
 * an integer option whose value (subscription override, else its default) is the cost.
 */
export type TermCosts = Record<TermType, number | string>;

export interface SourceDeclaration {
  code: string;
  internalName: string;
  displayName: string;
  family: { code: string; name: string };
  category: SourceCategory;
  country: string;
  baseUrl: string;
  collectorStatus: CollectorStatus;
  capability: Record<string, unknown>;
  options: SourceOption[];
  costs: TermCosts;
}

const searchPages = (def: number, max = 5): SourceOption => ({
  key: 'search_pages',
  label: 'Search result pages per keyword',
  type: 'integer',
  default: def,
  min: 1,
  max,
  help: 'More pages find more listings and cost more requests.',
});
const newOnly: SourceOption = { key: 'new_only', label: 'New items only', type: 'boolean', default: true, help: 'Skip used, refurbished and open-box offers.' };
const searchCosts = (sellerPages = 2): TermCosts => ({ keyword: 'search_pages', brand: 'search_pages', identifier: 1, url: 1, seller: sellerPages });

export const SOURCE_CATALOGUE: SourceDeclaration[] = [
  {
    code: 'amazon_us',
    internalName: 'amazon.com',
    displayName: 'Amazon',
    family: { code: 'amazon', name: 'Amazon' },
    category: 'Marketplace',
    country: 'US',
    baseUrl: 'https://www.amazon.com',
    collectorStatus: 'live',
    capability: { http: true, browser: true, api: false },
    options: [
      { key: 'buy_box_only', label: 'Capture buy box only', type: 'boolean', default: true, help: 'Off also records the other offers on the listing.' },
      { key: 'include_variants', label: 'Colour and size variants', type: 'boolean', default: false },
      newOnly,
      { key: 'seller_direct_only', label: 'Seller-direct only', type: 'boolean', default: false, help: 'Only offers shipped by the seller, not by Amazon.' },
      searchPages(2),
    ],
    costs: searchCosts(3),
  },
  {
    code: 'walmart_us',
    internalName: 'walmart.com',
    displayName: 'Walmart',
    family: { code: 'walmart', name: 'Walmart' },
    category: 'Marketplace',
    country: 'US',
    baseUrl: 'https://www.walmart.com',
    collectorStatus: 'live',
    capability: { http: true, browser: true, api: false },
    options: [
      { key: 'all_sellers', label: 'Record every seller on a listing', type: 'boolean', default: true, help: 'Not only the "Add to cart" offer.' },
      newOnly,
      searchPages(2),
    ],
    costs: searchCosts(2),
  },
  {
    code: 'bestbuy_us',
    internalName: 'bestbuy.com',
    displayName: 'Best Buy',
    family: { code: 'bestbuy', name: 'Best Buy' },
    category: 'Online Seller',
    country: 'US',
    baseUrl: 'https://www.bestbuy.com',
    collectorStatus: 'live',
    capability: { http: true, browser: true, api: 'optional (BESTBUY_API_KEY)' },
    options: [
      { key: 'use_api', label: 'Use the Best Buy Products API when available', type: 'boolean', default: true },
      { key: 'include_open_box', label: 'Include open-box offers', type: 'boolean', default: false },
      searchPages(1, 3),
    ],
    costs: searchCosts(1),
  },
  {
    code: 'ebay_us',
    internalName: 'ebay.com',
    displayName: 'eBay',
    family: { code: 'ebay', name: 'eBay' },
    category: 'Marketplace',
    country: 'US',
    baseUrl: 'https://www.ebay.com',
    collectorStatus: 'planned',
    capability: { http: true, browser: true, api: 'planned (Browse API)' },
    options: [
      newOnly,
      { key: 'buy_it_now_only', label: 'Buy It Now only (skip auctions)', type: 'boolean', default: true },
      searchPages(3),
    ],
    costs: searchCosts(3),
  },
  {
    code: 'target_us',
    internalName: 'target.com',
    displayName: 'Target',
    family: { code: 'target', name: 'Target' },
    category: 'Online Seller',
    country: 'US',
    baseUrl: 'https://www.target.com',
    collectorStatus: 'planned',
    capability: { http: true, browser: true, api: false },
    options: [searchPages(1, 3)],
    costs: searchCosts(1),
  },
  {
    code: 'homedepot_us',
    internalName: 'homedepot.com',
    displayName: 'Home Depot',
    family: { code: 'homedepot', name: 'Home Depot' },
    category: 'Online Seller',
    country: 'US',
    baseUrl: 'https://www.homedepot.com',
    collectorStatus: 'planned',
    capability: { http: true, browser: true, api: false },
    options: [searchPages(1, 3)],
    costs: searchCosts(1),
  },
  {
    code: 'google_shopping_us',
    internalName: 'shopping.google.com',
    displayName: 'Google Shopping',
    family: { code: 'google', name: 'Google' },
    category: 'Price Comparison',
    country: 'US',
    baseUrl: 'https://shopping.google.com',
    collectorStatus: 'planned',
    capability: { http: false, browser: true, api: 'planned (licensed feed)' },
    options: [searchPages(1, 3), { key: 'follow_to_seller', label: 'Follow offers to the seller page', type: 'boolean', default: false }],
    costs: searchCosts(1),
  },
];

/** What goes into source.options_schema. */
export function optionsSchema(d: Pick<SourceDeclaration, 'options' | 'costs'>): { options: SourceOption[]; costs: TermCosts } {
  return { options: d.options, costs: d.costs };
}
