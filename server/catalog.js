/**
 * Simulated vendor network. Each vendor is a tiny deterministic "vendor agent"
 * with a hidden price floor it will not negotiate below. In production this is
 * replaced by real supplier APIs / catalog feeds (e.g. Channel3) – the
 * negotiator agent only talks to vendors through the same tool interface.
 */
export const CATEGORIES = [
  'laptops',
  'monitors',
  'office_chairs',
  'iot_gateways',
  'gps_trackers',
  'safety_gear',
];

export const VENDORS = [
  {
    id: 'v_northwind',
    name: 'Northwind Supplies',
    rating: 4.6,
    paypalEmail: 'northwind@example.com',
    floorPct: 0.9,
    offers: [
      { sku: 'NW-LT-14', category: 'laptops', name: '14" Business Laptop, 16GB/512GB', listPrice: 899, deliveryDays: 4 },
      { sku: 'NW-MN-27', category: 'monitors', name: '27" QHD Monitor', listPrice: 279, deliveryDays: 3 },
      { sku: 'NW-CH-ERG', category: 'office_chairs', name: 'Ergonomic Mesh Chair', listPrice: 249, deliveryDays: 6 },
    ],
  },
  {
    id: 'v_contoso',
    name: 'Contoso Tech Distributors',
    rating: 4.2,
    paypalEmail: 'sales@contoso.example',
    floorPct: 0.85,
    offers: [
      { sku: 'CT-LT-14P', category: 'laptops', name: '14" Pro Laptop, 16GB/1TB', listPrice: 949, deliveryDays: 7 },
      { sku: 'CT-MN-27', category: 'monitors', name: '27" 4K Monitor', listPrice: 329, deliveryDays: 5 },
      { sku: 'CT-IOT-GW', category: 'iot_gateways', name: 'Industrial LTE IoT Gateway (Modbus/MQTT)', listPrice: 420, deliveryDays: 9 },
    ],
  },
  {
    id: 'v_fabrikam',
    name: 'Fabrikam Industrial',
    rating: 4.8,
    paypalEmail: 'ar@fabrikam.example',
    floorPct: 0.93,
    offers: [
      { sku: 'FB-IOT-GW2', category: 'iot_gateways', name: 'Edge AI IoT Gateway, dual SIM', listPrice: 510, deliveryDays: 5 },
      { sku: 'FB-GPS-140', category: 'gps_trackers', name: 'AIS-140 Certified GPS Vehicle Tracker', listPrice: 115, deliveryDays: 4 },
      { sku: 'FB-SG-KIT', category: 'safety_gear', name: 'Site Safety Kit (helmet, vest, gloves)', listPrice: 64, deliveryDays: 3 },
    ],
  },
  {
    id: 'v_tailspin',
    name: 'Tailspin Wholesale',
    rating: 3.7,
    paypalEmail: 'pay@tailspin.example',
    floorPct: 0.78,
    offers: [
      { sku: 'TS-LT-14', category: 'laptops', name: '14" Laptop, 8GB/256GB', listPrice: 699, deliveryDays: 12 },
      { sku: 'TS-GPS-140', category: 'gps_trackers', name: 'AIS-140 GPS Tracker (refurb)', listPrice: 79, deliveryDays: 10 },
      { sku: 'TS-CH-BASIC', category: 'office_chairs', name: 'Basic Task Chair', listPrice: 119, deliveryDays: 8 },
    ],
  },
  {
    id: 'v_adatum',
    name: 'Adatum Safety & Fleet',
    rating: 4.4,
    paypalEmail: 'billing@adatum.example',
    floorPct: 0.88,
    offers: [
      { sku: 'AD-GPS-140', category: 'gps_trackers', name: 'AIS-140 GPS Tracker + 1yr SIM', listPrice: 129, deliveryDays: 3 },
      { sku: 'AD-SG-KIT', category: 'safety_gear', name: 'Premium Safety Kit (EN-certified)', listPrice: 72, deliveryDays: 2 },
      { sku: 'AD-MN-24', category: 'monitors', name: '24" FHD Monitor', listPrice: 159, deliveryDays: 4 },
    ],
  },
];

export const vendorById = (id) => VENDORS.find((v) => v.id === id);

/** All offers for a category, flattened with vendor metadata (floor hidden). */
export function quotesFor(category, quantity) {
  return VENDORS.flatMap((v) =>
    v.offers
      .filter((o) => o.category === category)
      .map((o) => ({
        vendorId: v.id,
        vendorName: v.name,
        vendorRating: v.rating,
        sku: o.sku,
        name: o.name,
        unitPrice: o.listPrice,
        quantity,
        total: round2(o.listPrice * quantity),
        deliveryDays: o.deliveryDays,
      })),
  );
}

export const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Deterministic vendor-agent response to a counter-offer.
 * Accepts at/above the floor; otherwise meets halfway (but never below floor).
 * Volume discount: floor drops 2% for quantity >= 10.
 */
export function vendorRespond({ vendorId, sku, quantity, offeredUnitPrice, currentUnitPrice, round }) {
  const v = vendorById(vendorId);
  const offer = v?.offers.find((o) => o.sku === sku);
  if (!v || !offer) return { status: 'error', message: `Unknown vendor/sku ${vendorId}/${sku}` };
  const floorPct = v.floorPct - (quantity >= 10 ? 0.02 : 0);
  const floor = round2(offer.listPrice * floorPct);
  if (offeredUnitPrice >= floor) {
    return { status: 'accepted', unitPrice: round2(offeredUnitPrice), message: `${v.name} accepts $${offeredUnitPrice}/unit.` };
  }
  if (round >= 3) {
    return { status: 'final_offer', unitPrice: floor, message: `${v.name}: final offer $${floor}/unit, cannot go lower.` };
  }
  const counter = round2(Math.max(floor, (offeredUnitPrice + currentUnitPrice) / 2));
  return { status: 'counter', unitPrice: counter, message: `${v.name} counters at $${counter}/unit.` };
}
