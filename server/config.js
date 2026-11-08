import 'dotenv/config';

const env = process.env;

export const config = {
  port: Number(env.PORT || 8787),
  dataFile: env.DATA_FILE || './data/db.json',

  ai: {
    apiKey: env.ANTHROPIC_API_KEY || '',
    model: env.ANTHROPIC_MODEL || 'claude-opus-5-5',
    geminiKey: env.GEMINI_API_KEY || '',
    geminiModel: env.GEMINI_MODEL || 'gemini-3.5-flash',
    /**
     * Which agent engine runs: 'claude' | 'gemini' | 'heuristic'.
     * AI_PROVIDER forces one; otherwise Claude if its key is set, then Gemini,
     * else deterministic heuristic agents (offline mode).
     */
    get mode() {
      const forced = (env.AI_PROVIDER || env.AI_MODE || '').toLowerCase();
      if (forced === 'heuristic') return 'heuristic';
      if (forced === 'claude') return this.apiKey ? 'claude' : 'heuristic';
      if (forced === 'gemini') return this.geminiKey ? 'gemini' : 'heuristic';
      if (this.apiKey) return 'claude';
      if (this.geminiKey) return 'gemini';
      return 'heuristic';
    },
    get activeModel() {
      return { claude: this.model, gemini: this.geminiModel }[this.mode] ?? null;
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
