async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  config: () => call('GET', '/api/config'),
  state: () => call('GET', '/api/state'),
  vendors: () => call('GET', '/api/vendors'),
  submit: (text) => call('POST', '/api/requests', { text }),
  policy: (patch) => call('PUT', '/api/policy', patch),
  approve: (id, note) => call('POST', `/api/deals/${id}/approve`, { by: 'manager', note }),
  reject: (id, note) => call('POST', `/api/deals/${id}/reject`, { by: 'manager', note }),
  createOrder: (id) => call('POST', `/api/deals/${id}/paypal/order`),
  authorize: (id, orderId) => call('POST', `/api/deals/${id}/paypal/authorize`, { orderId }),
  delivery: (id, proof, image) => call('POST', `/api/deals/${id}/delivery`, { proof, image, submittedBy: 'vendor' }),
  review: (id, decision, releasePct) => call('POST', `/api/deals/${id}/review`, { decision, releasePct }),
  reset: () => call('POST', '/api/demo/reset'),
};

export const usd = (n) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
