/**
 * Commerce data model: a product catalogue (brands, categories, suppliers,
 * products, variants, media, variant attributes) and the order side that sells
 * from it (customers, addresses, orders, lines, shipments, payments, refunds).
 *
 * The two halves are joined by `order_lines.variant → product_variants`, which
 * is the point of keeping them in one template: it makes catalogue-to-revenue
 * queries possible in a demo. Order lines still carry `skuSnapshot` and
 * `nameSnapshot` because a real line item records what was sold at the time, not
 * whatever the catalogue says today.
 */

import { T, type CollectionDef } from '../../lib/types.ts';

const primaryKey = { name: 'id', type: T.uuid, primary: true, displayName: 'ID' } as const;

/** Money. One scale for every amount in the model so totals add up cleanly. */
const money = T.decimal(12, 2);

export const collections: CollectionDef[] = [
  // -------------------------------------------------------------------------
  // Catalogue
  // -------------------------------------------------------------------------
  {
    key: 'brands',
    apiName: 'Brand',
    displayName: 'Brands',
    description: 'Manufacturer or label a product is sold under.',
    icon: 'label',
    fields: [
      primaryKey,
      { name: 'name', type: T.varchar(120), unique: true, displayName: 'Name' },
      { name: 'slug', type: T.varchar(120), unique: true, displayName: 'Slug' },
      { name: 'description', type: T.text, nullable: true, displayName: 'Description' },
      { name: 'websiteUrl', type: T.text, nullable: true, displayName: 'Website' },
      { name: 'createdAt', type: T.timestamp, displayName: 'Created' },
    ],
  },
  {
    key: 'categories',
    apiName: 'Category',
    displayName: 'Categories',
    description: 'Hierarchical merchandising tree.',
    icon: 'account_tree',
    fields: [
      primaryKey,
      { name: 'name', type: T.varchar(120), displayName: 'Name' },
      { name: 'slug', type: T.varchar(140), unique: true, displayName: 'Slug' },
      { name: 'description', type: T.text, nullable: true, displayName: 'Description' },
      { name: 'sort', type: T.int, displayName: 'Order' },
    ],
    relations: [
      { name: 'parent', to: 'categories', reverseName: 'children', nullable: true, displayName: 'Parent' },
    ],
  },
  {
    key: 'suppliers',
    apiName: 'Supplier',
    displayName: 'Suppliers',
    description: 'Where stock is bought from.',
    icon: 'local_shipping',
    fields: [
      primaryKey,
      { name: 'name', type: T.varchar(160), unique: true, displayName: 'Name' },
      { name: 'contactEmail', type: T.varchar(180), displayName: 'Contact email' },
      { name: 'contactPhone', type: T.varchar(40), nullable: true, displayName: 'Contact phone' },
      { name: 'country', type: T.varchar(2), displayName: 'Country', description: 'ISO 3166-1 alpha-2' },
      { name: 'leadTimeDays', type: T.int, displayName: 'Lead time (days)' },
      { name: 'isActive', type: T.bool, displayName: 'Active' },
      { name: 'createdAt', type: T.timestamp, displayName: 'Created' },
    ],
  },
  {
    key: 'products',
    apiName: 'Product',
    displayName: 'Products',
    description: 'A catalogue entry. Sellable stock lives on its variants.',
    icon: 'inventory_2',
    fields: [
      primaryKey,
      { name: 'sku', type: T.varchar(32), unique: true, displayName: 'SKU' },
      { name: 'name', type: T.text, displayName: 'Name' },
      { name: 'description', type: T.text, nullable: true, displayName: 'Description' },
      {
        name: 'status',
        type: T.varchar(16),
        displayName: 'Status',
        description: 'draft · active · archived',
      },
      { name: 'basePrice', type: money, displayName: 'Base price' },
      { name: 'currency', type: T.varchar(3), displayName: 'Currency' },
      { name: 'weightGrams', type: T.int, nullable: true, displayName: 'Weight (g)' },
      { name: 'isFeatured', type: T.bool, displayName: 'Featured' },
      { name: 'createdAt', type: T.timestamp, displayName: 'Created' },
      { name: 'updatedAt', type: T.timestamp, displayName: 'Updated' },
    ],
    relations: [
      { name: 'brand', to: 'brands', reverseName: 'products', displayName: 'Brand' },
      { name: 'category', to: 'categories', reverseName: 'products', displayName: 'Category' },
      {
        name: 'primarySupplier',
        to: 'suppliers',
        reverseName: 'suppliedProducts',
        nullable: true,
        displayName: 'Primary supplier',
      },
    ],
  },
  {
    key: 'product_variants',
    apiName: 'ProductVariant',
    displayName: 'Product variants',
    description: 'The actually sellable unit: one size, colour, and price.',
    icon: 'style',
    fields: [
      primaryKey,
      { name: 'sku', type: T.varchar(40), unique: true, displayName: 'SKU' },
      { name: 'name', type: T.text, displayName: 'Name' },
      { name: 'price', type: money, displayName: 'Price' },
      { name: 'compareAtPrice', type: money, nullable: true, displayName: 'Compare at' },
      { name: 'stockQuantity', type: T.int, displayName: 'In stock' },
      { name: 'barcode', type: T.varchar(32), nullable: true, displayName: 'Barcode' },
      { name: 'isDefault', type: T.bool, displayName: 'Default' },
      { name: 'createdAt', type: T.timestamp, displayName: 'Created' },
    ],
    relations: [{ name: 'product', to: 'products', reverseName: 'variants', displayName: 'Product' }],
  },
  {
    key: 'product_media',
    apiName: 'ProductMedia',
    displayName: 'Product media',
    description: 'Images and video attached to a product.',
    icon: 'image',
    fields: [
      primaryKey,
      { name: 'url', type: T.text, displayName: 'URL' },
      { name: 'altText', type: T.text, nullable: true, displayName: 'Alt text' },
      { name: 'kind', type: T.varchar(16), displayName: 'Kind', description: 'image · video' },
      { name: 'sort', type: T.int, displayName: 'Order' },
    ],
    relations: [{ name: 'product', to: 'products', reverseName: 'media', displayName: 'Product' }],
  },
  {
    key: 'variant_attributes',
    apiName: 'VariantAttribute',
    displayName: 'Variant attributes',
    description: 'The option values that distinguish one variant from another.',
    icon: 'tune',
    fields: [
      primaryKey,
      { name: 'name', type: T.varchar(40), displayName: 'Attribute' },
      { name: 'value', type: T.varchar(80), displayName: 'Value' },
      { name: 'sort', type: T.int, displayName: 'Order' },
    ],
    relations: [
      { name: 'variant', to: 'product_variants', reverseName: 'attributes', displayName: 'Variant' },
    ],
  },

  // -------------------------------------------------------------------------
  // Orders
  // -------------------------------------------------------------------------
  {
    key: 'customers',
    apiName: 'Customer',
    displayName: 'Customers',
    description: 'Someone who has placed or can place an order.',
    icon: 'person',
    fields: [
      primaryKey,
      { name: 'email', type: T.varchar(180), unique: true, displayName: 'Email' },
      { name: 'firstName', type: T.varchar(80), displayName: 'First name' },
      { name: 'lastName', type: T.varchar(80), displayName: 'Last name' },
      { name: 'phone', type: T.varchar(40), nullable: true, displayName: 'Phone' },
      { name: 'marketingOptIn', type: T.bool, displayName: 'Marketing opt-in' },
      { name: 'createdAt', type: T.timestamp, displayName: 'Created' },
    ],
  },
  {
    key: 'addresses',
    apiName: 'Address',
    displayName: 'Addresses',
    description: 'A customer’s shipping or billing address.',
    icon: 'home_pin',
    fields: [
      primaryKey,
      { name: 'label', type: T.varchar(40), displayName: 'Label' },
      { name: 'line1', type: T.text, displayName: 'Line 1' },
      { name: 'line2', type: T.text, nullable: true, displayName: 'Line 2' },
      { name: 'city', type: T.varchar(80), displayName: 'City' },
      { name: 'region', type: T.varchar(80), nullable: true, displayName: 'Region' },
      { name: 'postalCode', type: T.varchar(20), displayName: 'Postal code' },
      { name: 'country', type: T.varchar(2), displayName: 'Country' },
      { name: 'isDefault', type: T.bool, displayName: 'Default' },
    ],
    relations: [{ name: 'customer', to: 'customers', reverseName: 'addresses', displayName: 'Customer' }],
  },
  {
    key: 'orders',
    apiName: 'Order',
    displayName: 'Orders',
    description: 'A placed order and its money totals.',
    icon: 'receipt_long',
    fields: [
      primaryKey,
      { name: 'number', type: T.varchar(24), unique: true, displayName: 'Number' },
      {
        name: 'status',
        type: T.varchar(16),
        displayName: 'Status',
        description: 'pending · paid · fulfilled · cancelled · refunded',
      },
      { name: 'currency', type: T.varchar(3), displayName: 'Currency' },
      { name: 'subtotal', type: money, displayName: 'Subtotal' },
      { name: 'discountTotal', type: money, displayName: 'Discount' },
      { name: 'taxTotal', type: money, displayName: 'Tax' },
      { name: 'shippingTotal', type: money, displayName: 'Shipping' },
      { name: 'grandTotal', type: money, displayName: 'Total' },
      { name: 'placedAt', type: T.timestamp, displayName: 'Placed' },
      { name: 'notes', type: T.text, nullable: true, displayName: 'Notes' },
    ],
    relations: [
      { name: 'customer', to: 'customers', reverseName: 'orders', onDelete: 'restrict', displayName: 'Customer' },
      {
        name: 'shippingAddress',
        to: 'addresses',
        reverseName: 'shippedOrders',
        nullable: true,
        displayName: 'Shipping address',
      },
      {
        name: 'billingAddress',
        to: 'addresses',
        reverseName: 'billedOrders',
        nullable: true,
        displayName: 'Billing address',
      },
    ],
  },
  {
    key: 'order_lines',
    apiName: 'OrderLine',
    displayName: 'Order lines',
    description: 'One variant on one order, priced as it was when sold.',
    icon: 'list_alt',
    fields: [
      primaryKey,
      { name: 'quantity', type: T.int, displayName: 'Qty' },
      { name: 'unitPrice', type: money, displayName: 'Unit price' },
      { name: 'lineTotal', type: money, displayName: 'Line total' },
      { name: 'skuSnapshot', type: T.varchar(40), displayName: 'SKU (as sold)' },
      { name: 'nameSnapshot', type: T.text, displayName: 'Name (as sold)' },
    ],
    relations: [
      { name: 'order', to: 'orders', reverseName: 'lines', displayName: 'Order' },
      {
        name: 'variant',
        to: 'product_variants',
        reverseName: 'orderLines',
        onDelete: 'restrict',
        displayName: 'Variant',
      },
    ],
  },
  {
    key: 'shipments',
    apiName: 'Shipment',
    displayName: 'Shipments',
    description: 'A parcel dispatched for an order.',
    icon: 'local_post_office',
    fields: [
      primaryKey,
      { name: 'carrier', type: T.varchar(40), displayName: 'Carrier' },
      { name: 'trackingNumber', type: T.varchar(60), nullable: true, displayName: 'Tracking' },
      {
        name: 'status',
        type: T.varchar(16),
        displayName: 'Status',
        description: 'pending · in_transit · delivered',
      },
      { name: 'shippedAt', type: T.timestamp, nullable: true, displayName: 'Shipped' },
      { name: 'deliveredAt', type: T.timestamp, nullable: true, displayName: 'Delivered' },
      { name: 'weightGrams', type: T.int, nullable: true, displayName: 'Weight (g)' },
    ],
    relations: [{ name: 'order', to: 'orders', reverseName: 'shipments', displayName: 'Order' }],
  },
  {
    key: 'payments',
    apiName: 'Payment',
    displayName: 'Payments',
    description: 'An attempt to collect money for an order.',
    icon: 'credit_card',
    fields: [
      primaryKey,
      { name: 'method', type: T.varchar(24), displayName: 'Method', description: 'card · paypal · transfer' },
      {
        name: 'status',
        type: T.varchar(16),
        displayName: 'Status',
        description: 'authorized · captured · failed · refunded',
      },
      { name: 'amount', type: money, displayName: 'Amount' },
      { name: 'currency', type: T.varchar(3), displayName: 'Currency' },
      { name: 'reference', type: T.varchar(60), unique: true, displayName: 'Reference' },
      { name: 'processedAt', type: T.timestamp, displayName: 'Processed' },
    ],
    relations: [{ name: 'order', to: 'orders', reverseName: 'payments', displayName: 'Order' }],
  },
  {
    key: 'refunds',
    apiName: 'Refund',
    displayName: 'Refunds',
    description: 'Money returned against a payment.',
    icon: 'undo',
    fields: [
      primaryKey,
      { name: 'amount', type: money, displayName: 'Amount' },
      { name: 'reason', type: T.varchar(40), displayName: 'Reason' },
      { name: 'processedAt', type: T.timestamp, displayName: 'Processed' },
    ],
    relations: [{ name: 'payment', to: 'payments', reverseName: 'refunds', displayName: 'Payment' }],
  },
];

/** FK-safe insert order. */
export const seedOrder = [
  'brands',
  'categories',
  'suppliers',
  'products',
  'product_variants',
  'product_media',
  'variant_attributes',
  'customers',
  'addresses',
  'orders',
  'order_lines',
  'shipments',
  'payments',
  'refunds',
];
