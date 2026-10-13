/**
 * Fixture payload OrderOnline.
 *
 * Disalin dari `docs/Reference-Webhook-Order-From-Checkout-Form` dan
 * `docs/Reference-Webhook-Order-Form-Storefront` dengan field yang tidak relevan
 * untuk pemetaan dipangkas (shipping, courier, meta, progress, dan seterusnya).
 *
 * Yang TIDAK boleh dilakukan: menambah key yang tidak ada di sample. Fixture ini
 * adalah cermin pengamatan, bukan tempat mengarang struktur provider (06 §13).
 */

export type JsonObject = Record<string, unknown>

const CO_FORM_PAYLOAD: JsonObject = {
  order_id: 281343516,
  product_data: {
    name: 'Test',
    slug: 'test',
    code: '121',
    type: 'variable',
    price: 10000,
    sale_price: { enabled: true, price: 20000 },
  },
  form_data: { name: 'Form 1' },
  customer_data: {
    name: 'Budi Pengunjung',
    phone: '+628080080808',
    email: 'budi.pengunjung@example.com',
    address: 'Jl. Test',
    city: 'Kota Bandung',
    city_name: 'Kota Bandung',
    province_name: 'Jawa Barat',
    zip: 40184,
  },
  product_price: 10000,
  total_product_price: 10000,
  total_price: 22000,
  unique_code_price: { type: 'decrease', unique_code: 0 },
  payment: { method: 'bank_transfer', data: [], channels: [], status: 'unpaid' },
  status: 'pending',
  type: 'form',
  updated_at: '2026-09-15 02:31:33',
  created_at: '2026-09-15 02:31:33',
}

/** Envelope CO Form: `{ type, action, payload }`. */
export function coFormOrder(payloadOverrides: JsonObject = {}, envelopeOverrides: JsonObject = {}): JsonObject {
  return {
    type: 'order',
    action: 'create',
    payload: { ...CO_FORM_PAYLOAD, ...payloadOverrides },
    ...envelopeOverrides,
  }
}

const STOREFRONT_ORDER: JsonObject = {
  _id: { $oid: '6ac4bcf797d2d6102c0871b0' },
  user_id: { $oid: '5b18dd619f05aa772122b262' },
  order_id: 283033796,
  product_data: [],
  products: [
    { product_id: { $oid: '693a81872cebdf401653d845' }, name: 'Product A', product_code: 'SKU001', price: 125000 },
    { product_id: { $oid: '693a81982cebdf401653d84e' }, name: 'Product D', product_code: 'SKU004', price: 125000 },
  ],
  cart_items: [{ product_name: 'Product A', qty: 1, price: 125000 }],
  customer_data: {
    name: 'Siti Pengunjung',
    phone: '+628123456789',
    email: 'siti.pengunjung@example.com',
    address: 'Jl. Test',
    city_name: 'Kota Bandung',
    province_name: 'Jawa Barat',
    zip: 40184,
  },
  shipping_costs: [{ code: 'jne', service: 'CTC', cost: { value: 9000, original: 9000 } }],
  product_price: 375000,
  total_product_price: 375942,
  total_price: 384942,
  payment: {
    method: 'bank_transfer',
    status: 'unpaid',
    providers: { name: 'bca', label: 'BCA', account_name: 'Fazlur Rahman', account_number: '123123123' },
  },
  status: 'pending',
  type: 'storefront',
  updated_at: { $date: '2026-10-06T09:18:47.000Z' },
  created_at: { $date: '2026-10-06T09:18:47.000Z' },
}

/** Dokumen order storefront: dikirim TANPA envelope. */
export function storefrontOrder(overrides: JsonObject = {}): JsonObject {
  return { ...STOREFRONT_ORDER, ...overrides }
}
