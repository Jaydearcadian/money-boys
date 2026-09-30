// Robinhood Stock Token API — strict response schemas.
//
// Read-only public endpoints, no credentials. Shapes follow
// https://docs.robinhood.com/chain/stock-token-apis/
//
// TIMESTAMP SEMANTICS: the docs define `generatedAt` as "Server time the quote
// was generated". That is a PROVIDER-GENERATED QUOTE timestamp, NOT an
// exchange trade timestamp. It is labelled as such everywhere it surfaces.
import { z } from "zod";

/** Provider-generated quote instant. Deliberately distinct from any trade time. */
export const TIMESTAMP_TYPE_PROVIDER_QUOTE = "PROVIDER_GENERATED_QUOTE" as const;
export type TimestampType = typeof TIMESTAMP_TYPE_PROVIDER_QUOTE;

export const ROBINHOOD_API_BASE = "https://api.robinhood.com";
export const RH_PRICES_PATH = "/rhj/prices";
export const RH_ASSETS_PATH = "/rhj/assets";

/** Documented cache window for /rhj/prices. */
export const RH_PRICES_CACHE_WINDOW_MS = 15_000;
export const RH_PRICES_RATE_LIMIT_PER_SEC = 60;

export const RhDeploymentSchema = z.object({
  contractAddress: z.string().min(1),
  chainId: z.number().int(),
});

/**
 * A single quote from GET /rhj/prices/{symbol}.
 *
 * `.strict()` on the envelope only: the live payload carries extra fields
 * (dailyHigh, tokenBid, tokenAsk, ...) that must not silently break parsing,
 * but the fields we depend on are validated explicitly.
 */

export const RhQuoteSchema = z
  .object({
    tokenSymbol: z.string().min(1),
    bid: z.string().min(1),
    ask: z.string().min(1),
    currency: z.string().min(1),
    isTradingHalt: z.boolean(),
    generatedAt: z.string().min(1),
    deployments: z.array(RhDeploymentSchema).optional(),
  })
  .passthrough();

export const RhPricesResponseSchema = z.object({
  quotes: z.array(RhQuoteSchema),
});

export const RhTradingCapabilitySchema = z
  .object({
    whole: z.string().optional(),
    fractional: z.string().optional(),
  })
  .passthrough();


export const RhAssetSchema = z
  .object({
    id: z.string().min(1),
    tokenSymbol: z.string().min(1),
    tokenName: z.string().optional(),
    currentMultiplier: z.string().min(1),
    pendingMultiplier: z.string().optional(),
    status: z.enum([
      "ASSET_STATUS_UNSPECIFIED",
      "ASSET_STATUS_ACTIVE",
      "ASSET_STATUS_INACTIVE",
    ]),
    deployments: z.array(RhDeploymentSchema).optional(),
    tradingCapabilities: z
      .object({
        market: RhTradingCapabilitySchema.optional(),
        extended: RhTradingCapabilitySchema.optional(),
        overnight: RhTradingCapabilitySchema.optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const RhAssetsResponseSchema = z.object({
  assets: z.array(RhAssetSchema),
});


/** Inferred response element types. */
export type RhQuote = z.infer<typeof RhQuoteSchema>;
export type RhAsset = z.infer<typeof RhAssetSchema>;
