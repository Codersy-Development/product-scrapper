import type { ProductVariant, StoreSettings } from "./types";

// Currency conversion rates (based on USD)
const EXCHANGE_RATES: Record<string, number> = {
  USD: 1.0,
  EUR: 0.92,
  GBP: 0.79,
  CAD: 1.36,
  AUD: 1.52,
  JPY: 149.50,
  CHF: 0.88,
  CNY: 7.24,
  INR: 83.12,
  MXN: 17.05,
};

// Common currency symbols to detect source currency
const CURRENCY_SYMBOLS: Record<string, string> = {
  "$": "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "₹": "INR",
};

/**
 * Detect currency from store region or default to USD
 */
export function detectCurrency(region?: string): string {
  if (!region) return "USD";

  const regionUpper = region.toUpperCase();

  // Map regions to currencies
  const regionCurrencyMap: Record<string, string> = {
    "UNITED STATES": "USD",
    "USA": "USD",
    "US": "USD",
    "UNITED KINGDOM": "GBP",
    "UK": "GBP",
    "GREAT BRITAIN": "GBP",
    "EUROPE": "EUR",
    "EUROPEAN UNION": "EUR",
    "EU": "EUR",
    "CANADA": "CAD",
    "AUSTRALIA": "AUD",
    "JAPAN": "JPY",
    "CHINA": "CNY",
    "INDIA": "INR",
    "MEXICO": "MXN",
  };

  return regionCurrencyMap[regionUpper] || "USD";
}

/**
 * Convert price from source currency to target currency
 */
export function convertCurrency(amount: number, fromCurrency: string, toCurrency: string): number {
  if (fromCurrency === toCurrency) return amount;

  const fromRate = EXCHANGE_RATES[fromCurrency] || 1.0;
  const toRate = EXCHANGE_RATES[toCurrency] || 1.0;

  // Convert to USD first, then to target currency
  const usdAmount = amount / fromRate;
  const convertedAmount = usdAmount * toRate;

  return convertedAmount;
}

export function applyRounding(price: number, rounding: string): number {
  if (price <= 0) return 0;

  const whole = Math.floor(price);

  switch (rounding) {
    case ".99":
      return whole + 0.99;
    case ".95":
      return whole + 0.95;
    case ".90":
      return whole + 0.90;
    case ".50":
      return whole + 0.50;
    case ".49":
      return whole + 0.49;
    case ".00":
      return Math.round(price);
    default: {
      // Custom decimal value
      const decimal = parseFloat(rounding);
      if (!isNaN(decimal) && decimal >= 0 && decimal < 1) {
        return whole + decimal;
      }
      return price;
    }
  }
}

export function applyPricing(
  variant: ProductVariant,
  settings: Pick<
    StoreSettings,
    | "retail_price_multiplier"
    | "retail_price_manual"
    | "compare_at_price_multiplier"
    | "compare_at_price_manual"
    | "price_rounding"
    | "variant_pricing"
  >,
  sourceCurrency = "USD",
  targetCurrency = "USD",
): ProductVariant {
  let price = parseFloat(variant.price);
  let compareAtPrice = variant.compareAtPrice ? parseFloat(variant.compareAtPrice) : null;

  // Apply currency conversion first
  if (sourceCurrency !== targetCurrency) {
    price = convertCurrency(price, sourceCurrency, targetCurrency);
    if (compareAtPrice !== null) {
      compareAtPrice = convertCurrency(compareAtPrice, sourceCurrency, targetCurrency);
    }
  }

  // Apply retail price multiplier
  if (!settings.retail_price_manual && settings.retail_price_multiplier !== 1) {
    price = price * settings.retail_price_multiplier;
  }

  // Apply compare at price multiplier
  if (!settings.compare_at_price_manual && settings.compare_at_price_multiplier > 0) {
    compareAtPrice = price * settings.compare_at_price_multiplier;
  }

  // Apply rounding
  price = applyRounding(price, settings.price_rounding);
  if (compareAtPrice !== null && compareAtPrice > 0) {
    compareAtPrice = applyRounding(compareAtPrice, settings.price_rounding);
  }

  return {
    ...variant,
    price: price.toFixed(2),
    compareAtPrice: compareAtPrice && compareAtPrice > 0 ? compareAtPrice.toFixed(2) : null,
  };
}

export function applyPricingToAllVariants(
  variants: ProductVariant[],
  settings: Pick<
    StoreSettings,
    | "retail_price_multiplier"
    | "retail_price_manual"
    | "compare_at_price_multiplier"
    | "compare_at_price_manual"
    | "price_rounding"
    | "variant_pricing"
  >,
  sourceCurrency = "USD",
  targetCurrency = "USD",
): ProductVariant[] {
  const processed = variants.map((v) => applyPricing(v, settings, sourceCurrency, targetCurrency));

  // If variant_pricing is on, force all variants to same price as first
  if (settings.variant_pricing && processed.length > 0) {
    const firstPrice = processed[0].price;
    const firstCompareAt = processed[0].compareAtPrice;
    return processed.map((v) => ({
      ...v,
      price: firstPrice,
      compareAtPrice: firstCompareAt,
    }));
  }

  return processed;
}
