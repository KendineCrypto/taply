import { ContractRequestSchema, PaymentIntentResponseSchema, createChainObservationSchema } from "../src/index.js";
import type { ChainObservation, ChainState, ContractRequest, IntentTerms, PaymentIntentResponse } from "../src/index.js";

// Compile-only assertions for consuming frontend/backend branches.
export function assertPublicTypes(input: unknown): PaymentIntentResponse {
  const observation: ChainObservation<ContractRequest> = createChainObservationSchema(ContractRequestSchema).parse(input);
  void observation;
  // @ts-expect-error UI expiry is not a contract state.
  const expired: ChainState = "EXPIRED";
  // @ts-expect-error Money cannot be a JavaScript number.
  const amount: IntentTerms["amountBaseUnits"] = 1;
  void expired;
  void amount;
  return PaymentIntentResponseSchema.parse(input);
}
