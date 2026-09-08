/**
 * Deterministic commerce sample data, sized for catalogue realism: ~500
 * products, ~1500 variants, ~2000 orders, ~5000 order lines — enough to make
 * pagination, filtering and revenue roll-ups behave like a real dataset.
 *
 * Nothing here reads the clock or the system RNG: ids come from the template
 * path, values from a fixed-seed generator, timestamps from a fixed epoch.
 *
 * Row ids derive from each row's **natural key** — a SKU, an order number, an
 * email — never from its position in the generated array. Position-based ids
 * look equivalent but are brittle: adding one product noun shifts every later
 * index, so the next run tries to write an existing SKU under a new id and dies
 * on the unique constraint. Natural keys mean a generator can be edited and the
 * rerun still updates the right rows.
 */

import { id } from '../../lib/ids.ts';
import { rng, stamp } from '../../lib/rng.ts';
import type { Relink, SeedRows } from '../../lib/types.ts';

const TEMPLATE = 'commerce';
const row = (collection: string, key: string) => id(TEMPLATE, 'row', collection, key);
const link = (rowId: string) => ({ _connect: { key: { id: rowId } } });
const maybeLink = (rowId: string | null | undefined) => (rowId ? link(rowId) : undefined);

const CURRENCY = 'EUR';

const COUNTS = {
  brands: 12,
  suppliers: 15,
  products: 500,
  customers: 400,
  orders: 2000,
};

// ---------------------------------------------------------------------------
// Word lists — fixed, so generated names are stable
// ---------------------------------------------------------------------------

const BRANDS = [
  'Northwind', 'Lumen', 'Arbor', 'Kestrel', 'Solace', 'Tessellate',
  'Halden', 'Cirrus', 'Ironleaf', 'Marlow', 'Verity', 'Quarry',
];

const CATEGORY_TREE: [string, string[]][] = [
  ['Furniture', ['Seating', 'Tables', 'Storage', 'Beds']],
  ['Lighting', ['Pendants', 'Floor lamps', 'Wall lights']],
  ['Kitchen', ['Cookware', 'Tableware', 'Small appliances']],
  ['Textiles', ['Rugs', 'Cushions', 'Throws']],
  ['Outdoor', ['Garden seating', 'Planters']],
  ['Office', ['Desks', 'Task chairs', 'Desk accessories']],
];

const SUPPLIER_PLACES = [
  ['Baltic Woodworks', 'LT'], ['Adriatic Ceramics', 'HR'], ['Rhine Metalcraft', 'DE'],
  ['Douro Textiles', 'PT'], ['Aegean Glass', 'GR'], ['Loire Joinery', 'FR'],
  ['Vistula Upholstery', 'PL'], ['Po Valley Lighting', 'IT'], ['Danube Casting', 'AT'],
  ['Ebro Stoneware', 'ES'], ['Shannon Weavers', 'IE'], ['Elbe Plastics', 'CZ'],
  ['Tagus Hardware', 'PT'], ['Scheldt Packaging', 'BE'], ['Oder Components', 'PL'],
] as const;

const MATERIALS = ['Oak', 'Walnut', 'Ash', 'Brass', 'Linen', 'Stoneware', 'Rattan', 'Steel', 'Marble', 'Cork'];
const QUALIFIERS = ['Studio', 'Heritage', 'Compact', 'Wide', 'Low', 'Nested', 'Folding', 'Modular', 'Slim', 'Classic'];
/**
 * Product noun → the leaf category it belongs in. Assigning categories at random
 * puts serving bowls under "Beds", which makes the catalogue useless as a demo of
 * merchandising queries.
 */
const NOUN_CATEGORY: [string, string][] = [
  ['Armchair', 'Seating'],
  ['Bench', 'Garden seating'],
  ['Side table', 'Tables'],
  ['Dining table', 'Tables'],
  ['Shelf unit', 'Storage'],
  ['Storage box', 'Storage'],
  ['Bed frame', 'Beds'],
  ['Pendant light', 'Pendants'],
  ['Floor lamp', 'Floor lamps'],
  ['Wall sconce', 'Wall lights'],
  ['Saucepan', 'Cookware'],
  ['Serving bowl', 'Tableware'],
  ['Dinner plate', 'Tableware'],
  ['Kettle', 'Small appliances'],
  ['Area rug', 'Rugs'],
  ['Cushion cover', 'Cushions'],
  ['Throw blanket', 'Throws'],
  ['Planter', 'Planters'],
  ['Writing desk', 'Desks'],
  ['Task chair', 'Task chairs'],
];

const COLOURS = ['Natural', 'Charcoal', 'Sage', 'Ochre', 'Ivory', 'Slate', 'Terracotta', 'Navy'];
const SIZES = ['Small', 'Medium', 'Large', 'One size'];

const FIRST_NAMES = [
  'Ines', 'Mateo', 'Freya', 'Arun', 'Zola', 'Kasper', 'Nadia', 'Otto', 'Leila', 'Bram',
  'Sanne', 'Emre', 'Marta', 'Tobias', 'Yara', 'Ivo', 'Roos', 'Hugo', 'Anouk', 'Elias',
];
const LAST_NAMES = [
  'Faber', 'Novak', 'Costa', 'Bakker', 'Moreau', 'Lindgren', 'Haas', 'Rossi', 'Ferreira', 'Vidal',
  'Jansen', 'Kovac', 'Silva', 'Weber', 'Petrov', 'Marin', 'Dijkstra', 'Lopez', 'Andersen', 'Horvat',
];

const CITIES = [
  ['Rotterdam', 'NL', 'Zuid-Holland'], ['Porto', 'PT', 'Norte'], ['Leipzig', 'DE', 'Sachsen'],
  ['Lyon', 'FR', 'Auvergne-Rhône-Alpes'], ['Bologna', 'IT', 'Emilia-Romagna'], ['Gdansk', 'PT', 'Pomorskie'],
  ['Ghent', 'BE', 'Flanders'], ['Aarhus', 'DK', 'Midtjylland'], ['Tampere', 'FI', 'Pirkanmaa'],
  ['Zagreb', 'HR', 'Zagreb'], ['Valencia', 'ES', 'Comunidad Valenciana'], ['Cork', 'IE', 'Munster'],
] as const;
const STREETS = ['Kade', 'Rua Alta', 'Ringweg', 'Allée Verte', 'Via Larga', 'Havnegade', 'Puistokatu', 'Ulica Nova'];

const CARRIERS = ['DHL', 'DPD', 'GLS', 'PostNL', 'UPS'];
const PAYMENT_METHODS = ['card', 'paypal', 'transfer'];
const REFUND_REASONS = ['damaged in transit', 'wrong item', 'changed mind', 'late delivery'];
const ORDER_NOTES = [
  'Leave with the neighbour if out.',
  'Gift — please omit the invoice.',
  'Deliver after 17:00.',
  'Second attempt; first parcel was returned.',
];

const slug = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Two-decimal rounding for internal arithmetic. */
const cents = (value: number) => Math.round(value * 100) / 100;
/**
 * Money on the wire. A `decimal` column rejects a JSON float — the engine wants
 * the exact digits, so amounts are sent as fixed-scale strings.
 */
const dec = (value: number) => cents(value).toFixed(2);

export function seed(): { rows: SeedRows; relinks: Relink[] } {
  const r = rng(0xc0_ffee);
  const relinks: Relink[] = [];

  // --- catalogue -----------------------------------------------------------

  const brands = BRANDS.slice(0, COUNTS.brands).map((name, i) => ({
    id: row('brands', slug(name)),
    name,
    slug: slug(name),
    description: `${name} — ${r.pick(MATERIALS).toLowerCase()} pieces made in small runs.`,
    websiteUrl: `https://${slug(name)}.example.com`,
    createdAt: stamp(-700 + i * 11),
  }));

  // Flat list, with children pointed at their parent afterwards: a self-relation
  // cannot be satisfied by a row in the same insert batch.
  const categories: Record<string, unknown>[] = [];
  const leafCategoryIds = new Map<string, string>();
  for (const [top, children] of CATEGORY_TREE) {
    const parentIndex = categories.length;
    const parentId = row('categories', slug(top));
    categories.push({
      id: parentId,
      name: top,
      slug: slug(top),
      description: `Everything in ${top.toLowerCase()}.`,
      sort: parentIndex * 10,
    });
    for (const child of children) {
      const childIndex = categories.length;
      const childSlug = slug(`${top}-${child}`);
      const childId = row('categories', childSlug);
      categories.push({
        id: childId,
        name: child,
        slug: childSlug,
        description: null,
        sort: childIndex * 10,
      });
      leafCategoryIds.set(child, childId);
      relinks.push({ collection: 'categories', id: childId, data: { parent: link(parentId) } });
    }
  }

  const suppliers = SUPPLIER_PLACES.slice(0, COUNTS.suppliers).map(([name, country], i) => ({
    id: row('suppliers', slug(name)),
    name,
    contactEmail: `orders@${slug(name)}.example.com`,
    contactPhone: r.chance(0.8) ? `+${r.int(30, 49)} ${r.int(10, 99)} ${r.int(1000000, 9999999)}` : null,
    country,
    leadTimeDays: r.weighted([7, 14, 21, 28, 45]),
    isActive: r.chance(0.85),
    createdAt: stamp(-650 + i * 9),
  }));

  const products: Record<string, unknown>[] = [];
  const variants: Record<string, unknown>[] = [];
  const media: Record<string, unknown>[] = [];
  const attributes: Record<string, unknown>[] = [];
  /** Every variant, kept for the order side to sell from. */
  const sellable: { id: string; sku: string; name: string; price: number }[] = [];

  for (let p = 0; p < COUNTS.products; p++) {
    const sku = `P-${String(p + 1).padStart(5, '0')}`;
    const productId = row('products', sku);
    const [noun, categoryName] = NOUN_CATEGORY[p % NOUN_CATEGORY.length]!;
    const name = `${r.pick(QUALIFIERS)} ${r.pick(MATERIALS).toLowerCase()} ${noun.toLowerCase()}`;
    const basePrice = cents(r.int(1900, 189000) / 100);
    const createdDay = -600 + (p % 580);

    products.push({
      id: productId,
      sku,
      name: name.charAt(0).toUpperCase() + name.slice(1),
      description: r.chance(0.85)
        ? `${noun} in ${r.pick(MATERIALS).toLowerCase()}, finished by hand. Ships flat-packed.`
        : null,
      status: r.weighted(['active', 'active', 'draft', 'archived']),
      basePrice: dec(basePrice),
      currency: CURRENCY,
      weightGrams: r.chance(0.9) ? r.int(200, 24000) : null,
      isFeatured: r.chance(0.12),
      createdAt: stamp(createdDay, r.int(8, 18)),
      updatedAt: stamp(createdDay + r.int(0, 120), r.int(8, 18)),
      brand: link(r.pick(brands).id),
      category: link(leafCategoryIds.get(categoryName)!),
      primarySupplier: maybeLink(r.chance(0.8) ? r.pick(suppliers).id : null),
    });

    // 2–4 variants each, the first one default.
    const variantCount = r.weighted([3, 2, 4]);
    for (let v = 0; v < variantCount; v++) {
      const variantSku = `${sku}-${String(v + 1).padStart(2, '0')}`;
      const variantId = row('product_variants', variantSku);
      const colour = COLOURS[(p + v) % COLOURS.length]!;
      const size = SIZES[(p + v) % SIZES.length]!;
      const price = cents(basePrice * (1 + v * 0.08));
      const variantName = `${colour} · ${size}`;

      variants.push({
        id: variantId,
        sku: variantSku,
        name: variantName,
        price: dec(price),
        compareAtPrice: r.chance(0.3) ? dec(price * 1.25) : null,
        stockQuantity: r.weighted([0, 3, 12, 40, 120, 300]),
        barcode: r.chance(0.7) ? String(4000000000000 + variants.length) : null,
        isDefault: v === 0,
        createdAt: stamp(createdDay, r.int(8, 18)),
        product: link(productId),
      });
      sellable.push({ id: variantId, sku: variantSku, name: `${products[p]!.name} — ${variantName}`, price });

      attributes.push(
        {
          id: row('variant_attributes', `${variantSku}/colour`),
          name: 'Colour',
          value: colour,
          sort: 0,
          variant: link(variantId),
        },
        {
          id: row('variant_attributes', `${variantSku}/size`),
          name: 'Size',
          value: size,
          sort: 10,
          variant: link(variantId),
        },
      );
    }

    for (let m = 0; m < r.weighted([2, 3, 1, 4]); m++) {
      media.push({
        id: row('product_media', `${sku}/${m}`),
        url: `https://cdn.example.com/products/${sku}/${m + 1}.jpg`,
        altText: r.chance(0.8) ? `${products[p]!.name} view ${m + 1}` : null,
        kind: m === 0 || r.chance(0.9) ? 'image' : 'video',
        sort: m * 10,
        product: link(productId),
      });
    }
  }

  // --- orders --------------------------------------------------------------

  const customers = Array.from({ length: COUNTS.customers }, (_, i) => {
    const first = FIRST_NAMES[i % FIRST_NAMES.length]!;
    const last = LAST_NAMES[(i * 7) % LAST_NAMES.length]!;
    const email = `${slug(first)}.${slug(last)}${i}@example.com`;
    return {
      id: row('customers', email),
      email,
      firstName: first,
      lastName: last,
      phone: r.chance(0.6) ? `+${r.int(30, 49)} ${r.int(100000000, 999999999)}` : null,
      marketingOptIn: r.chance(0.45),
      createdAt: stamp(-560 + (i % 540), r.int(7, 21)),
    };
  });

  // 1–2 addresses per customer, so an order can reference one that belongs to it.
  const addresses: Record<string, unknown>[] = [];
  const addressesByCustomer = new Map<string, string[]>();
  for (const customer of customers) {
    const owned: string[] = [];
    for (let a = 0; a < (r.chance(0.35) ? 2 : 1); a++) {
      const addressId = row('addresses', `${customer.email}/${a}`);
      const [city, country, region] = r.pick(CITIES);
      addresses.push({
        id: addressId,
        label: a === 0 ? 'Home' : r.pick(['Work', 'Parents', 'Studio']),
        line1: `${r.pick(STREETS)} ${r.int(1, 240)}`,
        line2: r.chance(0.25) ? `Unit ${r.int(1, 40)}` : null,
        city,
        region,
        postalCode: `${r.int(1000, 9999)} ${String.fromCharCode(65 + r.int(0, 25))}${String.fromCharCode(65 + r.int(0, 25))}`,
        country,
        isDefault: a === 0,
        customer: link(customer.id),
      });
      owned.push(addressId);
    }
    addressesByCustomer.set(customer.id, owned);
  }

  const orders: Record<string, unknown>[] = [];
  const lines: Record<string, unknown>[] = [];
  const shipments: Record<string, unknown>[] = [];
  const payments: Record<string, unknown>[] = [];
  const refunds: Record<string, unknown>[] = [];

  for (let o = 0; o < COUNTS.orders; o++) {
    const number = `SO-${String(100000 + o)}`;
    const orderId = row('orders', number);
    const customer = customers[r.int(0, customers.length - 1)]!;
    const owned = addressesByCustomer.get(customer.id)!;
    const placedDay = -365 + (o % 360);
    const status = r.weighted(['fulfilled', 'paid', 'pending', 'cancelled', 'refunded']);

    // Lines first: the order's totals are the sum of what is on it.
    let subtotal = 0;
    const lineCount = r.weighted([2, 1, 3, 4, 5]);
    for (let l = 0; l < lineCount; l++) {
      const variant = sellable[r.int(0, sellable.length - 1)]!;
      const quantity = r.weighted([1, 1, 2, 3]);
      const lineTotal = cents(variant.price * quantity);
      subtotal = cents(subtotal + lineTotal);
      lines.push({
        id: row('order_lines', `${number}/${l}`),
        quantity,
        unitPrice: dec(variant.price),
        lineTotal: dec(lineTotal),
        skuSnapshot: variant.sku,
        nameSnapshot: variant.name,
        order: link(orderId),
        variant: link(variant.id),
      });
    }

    const discountTotal = r.chance(0.2) ? cents(subtotal * 0.1) : 0;
    const shippingTotal = subtotal > 15000 ? 0 : cents(r.int(495, 1495) / 100);
    const taxTotal = cents((subtotal - discountTotal) * 0.21);
    const grandTotal = cents(subtotal - discountTotal + taxTotal + shippingTotal);

    orders.push({
      id: orderId,
      number,
      status,
      currency: CURRENCY,
      subtotal: dec(subtotal),
      discountTotal: dec(discountTotal),
      taxTotal: dec(taxTotal),
      shippingTotal: dec(shippingTotal),
      grandTotal: dec(grandTotal),
      placedAt: stamp(placedDay, r.int(6, 22)),
      notes: r.chance(0.15) ? r.pick(ORDER_NOTES) : null,
      customer: link(customer.id),
      shippingAddress: link(owned[0]!),
      billingAddress: link(owned[owned.length - 1]!),
    });

    // A cancelled order was never shipped and never charged.
    if (status !== 'cancelled') {
      const captured = status !== 'pending';
      const paymentId = row('payments', number);
      payments.push({
        id: paymentId,
        method: r.weighted(PAYMENT_METHODS),
        status: status === 'refunded' ? 'refunded' : captured ? 'captured' : 'authorized',
        amount: dec(grandTotal),
        currency: CURRENCY,
        reference: `PAY-${number.slice(3)}`,
        processedAt: stamp(placedDay, r.int(6, 23)),
        order: link(orderId),
      });

      if (status === 'refunded') {
        refunds.push({
          id: row('refunds', number),
          amount: r.chance(0.7) ? dec(grandTotal) : dec(grandTotal / 2),
          reason: r.pick(REFUND_REASONS),
          processedAt: stamp(placedDay + r.int(3, 21), r.int(9, 17)),
          payment: link(paymentId),
        });
      }
    }

    if (status === 'fulfilled' || status === 'refunded') {
      const shippedDay = placedDay + r.int(1, 4);
      const delivered = r.chance(0.85);
      shipments.push({
        id: row('shipments', number),
        carrier: r.pick(CARRIERS),
        trackingNumber: `${r.pick(CARRIERS).toUpperCase()}${r.int(100000000, 999999999)}`,
        status: delivered ? 'delivered' : 'in_transit',
        shippedAt: stamp(shippedDay, r.int(9, 18)),
        deliveredAt: delivered ? stamp(shippedDay + r.int(1, 6), r.int(9, 18)) : null,
        weightGrams: r.chance(0.9) ? r.int(300, 30000) : null,
        order: link(orderId),
      });
    }
  }

  return {
    rows: {
      brands,
      categories,
      suppliers,
      products,
      product_variants: variants,
      product_media: media,
      variant_attributes: attributes,
      customers,
      addresses,
      orders,
      order_lines: lines,
      shipments,
      payments,
      refunds,
    },
    relinks,
  };
}
