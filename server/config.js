import 'dotenv/config';

const env = process.env;

export const config = {
  port: Number(env.PORT || 8787),
  dataFile: env.DATA_FILE || './data/db.json',

  ai: {
    apiKey: env.ANTHROPIC_API_KEY || '',
    model: env.ANTHROPIC_MODEL || 'claude-opus-5-5',
    // "claude" when a key is present, otherwise deterministic heuristic agents.
    get mode() {
      if (env.AI_MODE === 'heuristic') return 'heuristic';
      return this.apiKey ? 'claude' : 'heuristic';
    },
  },

  paypal: {
    clientId: env.PAYPAL_CLIENT_ID || '',
    clientSecret: env.PAYPAL_CLIENT_SECRET || '',
    environment: (env.PAYPAL_ENVIRONMENT || 'sandbox').toLowerCase(),
    webhookId: env.PAYPAL_WEBHOOK_ID || '',
    skipWebhookVerify: env.PAYPAL_WEBHOOK_SKIP_VERIFY === 'true',
    get mode() {
      return this.clientId && this.clientSecret ? this.environment : 'mock';
    },
    get apiBase() {
      return this.environment === 'live'
        ? 'https://api-m.paypal.com'
        : 'https://api-m.sandbox.paypal.com';
    },
  },
};
