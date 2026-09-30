// Robinhood public data client. Read-only. NO CREDENTIALS.
//
// The Stock Token API endpoints used here are public and unauthenticated.
// This client deliberately has no API key, token, or signing surface, so it
// cannot be confused with the Bitget or Agentic credential domains.
import { ROBINHOOD_API_BASE } from "./schemas.js";
import { fetchRobinhoodBenchmark, type FetchLike, type RobinhoodBenchmark } from "./benchmark.js";

export interface RobinhoodClient {
  readonly descriptor: { id: string; authority: "read_only"; requiresCredentials: false; version: string };
  fetchBenchmark(symbol: string): Promise<RobinhoodBenchmark>;
}

export function createRobinhoodClient(args: {
  baseUrl?: string;
  fetchImpl: FetchLike;
}): RobinhoodClient {
  const baseUrl = args.baseUrl ?? ROBINHOOD_API_BASE;
  return {
    descriptor: {
      id: "robinhood-stock-token-benchmark",
      authority: "read_only",
      requiresCredentials: false,
      version: "1",
    },
    fetchBenchmark(symbol: string): Promise<RobinhoodBenchmark> {
      return fetchRobinhoodBenchmark({
        symbol,
        baseUrl,
        fetchImpl: args.fetchImpl,
      });
    },
  };
}
