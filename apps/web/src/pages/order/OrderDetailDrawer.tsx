import { Badge, appStatusTone, eventTypeTone } from '../../ui/Badge'
import { DetailList } from '../../ui/Card'
import { Drawer } from '../../ui/Overlay'
import { formatDateTime, formatMoney, formatText } from '../../lib/format'
import type { OrderRow } from '../../lib/queries'

/**
 * Drawer detail Order — READ-ONLY (PRD §48, 01 §18).
 *
 * Menampilkan seluruh data Order yang tersedia, termasuk snapshot tax dan waktu
 * sumber, karena datanya memang ada dan berguna untuk audit. Yang TIDAK ada di
 * sini: tombol edit dan tombol delete — keduanya belum ditentukan dokumen
 * (PRD §49–§50) dan tidak boleh ditambahkan atas dasar asumsi.
 */
export function OrderDetailDrawer({ order, onClose }: { order: OrderRow | null; onClose: () => void }) {
  return (
    <Drawer open={order !== null} title={order === null ? 'Detail Order' : `Order ${order.order_id}`} onClose={onClose}>
      {order === null ? null : (
        <div className="flex flex-col gap-4">
          <DetailList
            items={[
              { label: 'Order ID', value: <span className="font-mono">{order.order_id}</span> },
              { label: 'Nama', value: formatText(order.name) },
              { label: 'No WA', value: formatText(order.phone) },
              { label: 'Email', value: formatText(order.email) },
            ]}
          />

          <Section title="Produk">
            <DetailList
              items={[
                { label: 'Product raw', value: formatText(order.product_raw) },
                {
                  label: 'Hasil parsing',
                  value:
                    order.product_parse_status === 'valid' ? (
                      <Badge tone="success">valid</Badge>
                    ) : (
                      <Badge tone="danger">invalid</Badge>
                    ),
                },
                { label: 'Produk', value: formatText(order.product_name) },
                { label: 'Kode produk', value: formatText(order.product_code) },
                { label: 'Pengiklan', value: formatText(order.advertiser_name) },
                { label: 'Kode pengiklan', value: formatText(order.advertiser_code) },
                {
                  label: 'Jenis acara',
                  value:
                    order.event_type === null ? (
                      '-'
                    ) : (
                      <Badge tone={eventTypeTone(order.event_type)}>{order.event_type}</Badge>
                    ),
                },
                { label: 'Batch', value: formatText(order.batch) },
                { label: 'Sesi', value: formatText(order.session) },
                { label: 'Kota', value: formatText(order.city) },
              ]}
            />
          </Section>

          <Section title="Status">
            <DetailList
              items={[
                { label: 'Status aplikasi', value: <Badge tone={appStatusTone(order.app_status)}>{order.app_status}</Badge> },
                { label: 'Status provider', value: formatText(order.raw_status) },
                { label: 'Paid at', value: formatDateTime(order.paid_at) },
              ]}
            />
          </Section>

          <Section title="Pembayaran">
            <DetailList
              items={[
                { label: 'Method', value: formatText(order.payment_method) },
                { label: 'Provider', value: formatText(order.payment_provider) },
                { label: 'Identifier', value: formatText(order.payment_identifier) },
                {
                  label: 'Mapping tax',
                  value:
                    order.tax_mapping_status === 'mapped' ? (
                      <Badge tone="success">mapped</Badge>
                    ) : (
                      <Badge tone="warning">unmapped</Badge>
                    ),
                },
              ]}
            />
          </Section>

          <Section title="Nilai">
            <DetailList
              items={[
                { label: 'Gross', value: formatMoney(order.gross_amount) },
                { label: 'Tax', value: formatMoney(order.tax_amount) },
                { label: 'Net', value: formatMoney(order.net_amount) },
              ]}
            />
          </Section>

          {/* Snapshot tax: nilai saat transaksi, tidak ikut berubah bila rule diedit (01 §12). */}
          <Section title="Snapshot tax">
            <DetailList
              items={[
                { label: 'Rule', value: formatText(order.fee_rule_name_snapshot) },
                { label: 'Tipe', value: formatText(order.fee_type_snapshot) },
                {
                  label: 'Nilai',
                  value: order.fee_value_snapshot === null ? '-' : String(order.fee_value_snapshot),
                },
              ]}
            />
          </Section>

          <Section title="Waktu">
            <DetailList
              items={[
                { label: 'Diterima', value: formatDateTime(order.created_at) },
                { label: 'Diperbarui', value: formatDateTime(order.updated_at) },
                { label: 'Waktu sumber', value: formatDateTime(order.source_created_at) },
              ]}
            />
          </Section>
        </div>
      )}
    </Drawer>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{title}</h3>
      {children}
    </section>
  )
}
