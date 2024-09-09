// config/jazzcash.js

const Jazzcash = require('jazzcash-checkout');

Jazzcash.credentials({
  config: {
    merchantId: process.env.JAZZCASH_MERCHANT_ID,
    password: process.env.JAZZCASH_PASSWORD,
    hashKey: process.env.JAZZCASH_HASH_KEY,
  },
  environment: process.env.JAZZCASH_ENVIRONMENT || "sandbox",
});

module.exports = Jazzcash;
