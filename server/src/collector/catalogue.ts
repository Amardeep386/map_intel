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
    displayName: 'Amazon.com',
    family: { code: 'amazon', name: 'Amazon' },
    category: 'Marketplace',
    country: 'US',
    baseUrl: 'https://www.amazon.com',
    collectorStatus: 'live',
    capability: { http: true, browser: true, api: false, discovery: 'search' },
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
    displayName: 'Walmart.com',
    family: { code: 'walmart', name: 'Walmart' },
    category: 'Marketplace',
    country: 'US',
    baseUrl: 'https://www.walmart.com',
    collectorStatus: 'live',
    capability: { http: true, browser: true, api: false, discovery: 'browse' },
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
    capability: { http: true, browser: true, api: 'optional (BESTBUY_API_KEY)', discovery: 'search' },
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
    collectorStatus: 'live',
    capability: { http: true, browser: true, api: 'optional (EBAY_CLIENT_ID)', discovery: 'browse' },
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
    collectorStatus: 'live',
    capability: { http: true, browser: true, api: false, discovery: 'browse' },
    options: [searchPages(1, 3)],
    costs: searchCosts(1),
  },
  {
    code: 'homedepot_us',
    internalName: 'homedepot.com',
    displayName: 'The Home Depot',
    family: { code: 'homedepot', name: 'Home Depot' },
    category: 'Online Seller',
    country: 'US',
    baseUrl: 'https://www.homedepot.com',
    collectorStatus: 'live',
    capability: { http: true, browser: true, api: false, discovery: 'browse' },
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
  // Merchants on the brands' merchant lists (docs/MAP_Intel_Demo_Catalogue_LG_Apple_Samsung.xlsx)
  // with no collector yet: subscribable and costed, their jobs are skipped as no_collector.
  merchant('newegg_us', 'Newegg', 'newegg.com', 'https://www.newegg.com', 'Marketplace'),
  merchant('microcenter_us', 'Micro Center', 'microcenter.com', 'https://www.microcenter.com'),
  merchant('abt_us', 'Abt Electronics', 'abt.com', 'https://www.abt.com'),
  merchant('bhphoto_us', 'B&H Photo Video', 'bhphotovideo.com', 'https://www.bhphotovideo.com'),
  merchant('adorama_us', 'Adorama', 'adorama.com', 'https://www.adorama.com'),
  merchant('costco_us', 'Costco', 'costco.com', 'https://www.costco.com'),
  merchant('samsclub_us', "Sam's Club", 'samsclub.com', 'https://www.samsclub.com'),
  merchant('staples_us', 'Staples', 'staples.com', 'https://www.staples.com'),
  merchant('officedepot_us', 'Office Depot', 'officedepot.com', 'https://www.officedepot.com'),
  merchant('crutchfield_us', 'Crutchfield', 'crutchfield.com', 'https://www.crutchfield.com'),
  merchant('pcrichard_us', 'P.C. Richard & Son', 'pcrichard.com', 'https://www.pcrichard.com'),
  merchant('expercom_us', 'Expercom', 'expercom.com', 'https://www.expercom.com'),
  merchant('verizon_us', 'Verizon', 'verizon.com', 'https://www.verizon.com'),
  merchant('att_us', 'AT&T', 'att.com', 'https://www.att.com'),
  merchant('tmobile_us', 'T-Mobile', 't-mobile.com', 'https://www.t-mobile.com'),
  // Brand stores: the brand's own list price (reference, not enforced).
  merchant('lg_com_us', 'LG.com', 'lg.com', 'https://www.lg.com/us'),
  merchant('apple_com_us', 'Apple.com', 'apple.com', 'https://www.apple.com/shop'),
  merchant('samsung_com_us', 'Samsung.com', 'samsung.com', 'https://www.samsung.com/us'),
];

/** A merchant without a collector: one search page per keyword, like a source added by hand. */
function merchant(code: string, displayName: string, internalName: string, baseUrl: string, category: SourceCategory = 'Online Seller'): SourceDeclaration {
  return {
    code,
    internalName,
    displayName,
    family: { code: code.replace(/_us$/, ''), name: displayName },
    category,
    country: 'US',
    baseUrl,
    collectorStatus: 'planned',
    capability: { http: false, browser: false, api: false },
    options: [searchPages(1, 3)],
    costs: searchCosts(1),
  };
}

/** What goes into source.options_schema. */
export function optionsSchema(d: Pick<SourceDeclaration, 'options' | 'costs'>): { options: SourceOption[]; costs: TermCosts } {
  return { options: d.options, costs: d.costs };
}
