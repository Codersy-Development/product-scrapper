import type { ProductVariant, StoreSettings } from "./types";

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
): ProductVariant {
  let price = parseFloat(variant.price);
  let compareAtPrice = variant.compareAtPrice ? parseFloat(variant.compareAtPrice) : null;

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
): ProductVariant[] {
  const processed = variants.map((v) => applyPricing(v, settings));

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
