// Read-only integration adapters for external Bitget research surfaces.
//
// Money Boys remains the canonical control plane. Adapters here produce
// validated research artifacts with provenance hashes; they have no order
// authority and cannot mutate portfolio state (I-01, I-02).

export * from "./contracts.js";
export * from "./signal-adapter.js";
export * from "./playbook-adapter.js";
export * from "./mcp-transport.js";
export * from "./agentic-execution.js";
