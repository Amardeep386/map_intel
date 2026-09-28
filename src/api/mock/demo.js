// The demo catalogue of the LG, Apple and Samsung sandboxes (server/seeds/demo-catalogue.json, made
// from docs/MAP_Intel_Demo_Catalogue_LG_Apple_Samsung.xlsx): products (sheet columns A–J) and each
// brand's merchant list. Sample-data mode builds its SKUs, MAP and merchants from it, the same file
// `npm run catalogue:demo` loads into the database.
import DEMO from "../../../server/seeds/demo-catalogue.json";

export const DEMO_MAP_FROM = DEMO.mapEffectiveFrom;

const SLUGS = { LG: "lg", Apple: "apple", Samsung: "samsung" };

/** The sheet's "Check listing" (specs to confirm) has no portal status: it loads as Paused. */
const status = (s) => (["Active", "Paused", "Retired"].includes(s) ? s : "Paused");

/** Products and merchants for a sandbox by client name (empty for other names). */
export function demoFor(clientName) {
  const a = DEMO.accounts[SLUGS[clientName]];
  if (!a) return { products: [], merchants: [] };
  return {
    products: a.products.map((p) => ({ ...p, status: status(p.status) })),
    merchants: a.merchants,
  };
}

export const DEMO_CLIENTS = Object.keys(SLUGS).map((name) => {
  const { products, merchants } = demoFor(name);
  return { name, status: "Sandbox", skus: products.filter((p) => p.status !== "Retired").length, merchants: merchants.filter((m) => m.track).length, live: true };
});

/** Every merchant on any brand's list, by source code (name, website, channel type). */
export const DEMO_MERCHANTS = Object.values(
  Object.values(DEMO.accounts).flatMap((a) => a.merchants).reduce((acc, m) => ({ ...acc, [m.source]: acc[m.source] ?? m }), {}),
);

/** The merchant-list details stored on a subscription (account_source.profile). */
export const merchantProfile = (m) => ({
  channelType: m.channelType ?? undefined, sellerModel: m.sellerModel ?? undefined, authorisation: m.authorisation ?? undefined,
  priority: m.priority ?? undefined, checkFrequency: m.checkFrequency ?? undefined, collectionMethod: m.collectionMethod ?? undefined,
  notes: m.notes ?? undefined, categories: m.categories,
});
