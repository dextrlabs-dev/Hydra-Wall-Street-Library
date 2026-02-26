/**
 * Pluggable Hydra L2 signer.
 *
 * Apps supply hardware-backed or wallet-delegated implementations.
 * The connector does not custody keys.
 */
export interface HydraSigner {
  /** Sign opaque payload bytes prepared for the Hydra L2 workflow. */
  signPayload(payload: Uint8Array): Promise<Uint8Array>;
}
