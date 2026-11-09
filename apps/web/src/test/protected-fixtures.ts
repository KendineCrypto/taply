import type { ContractRequest } from '@/lib/protocol';
import type { ProtectedContractConfig } from '@taply/near-client';

/**
 * Real outputs of the Protected Pay candidate contract's Rust unit tests
 * (contracts/payments-protected/src/protected_tests.rs), shared with the
 * near-client tests. Contract id: payments.fixture.testnet.
 */
import config from '../../../../packages/near-client/test/fixtures/protected-config.json';
import open from '../../../../packages/near-client/test/fixtures/protected-open.json';
import locked from '../../../../packages/near-client/test/fixtures/protected-locked.json';
import refundInFlight from '../../../../packages/near-client/test/fixtures/protected-refund-in-flight.json';
import refundFailed from '../../../../packages/near-client/test/fixtures/protected-refund-failed.json';
import refunded from '../../../../packages/near-client/test/fixtures/protected-cancelled-refunded.json';
import releaseInFlight from '../../../../packages/near-client/test/fixtures/protected-release-in-flight.json';
import releaseFailed from '../../../../packages/near-client/test/fixtures/protected-release-failed.json';
import paid from '../../../../packages/near-client/test/fixtures/protected-final-paid.json';

export const PROTECTED_CONTRACT = 'payments.fixture.testnet';
export const PROTECTED = {
  config: config as unknown as ProtectedContractConfig,
  open: open as unknown as ContractRequest,
  locked: locked as unknown as ContractRequest,
  refundInFlight: refundInFlight as unknown as ContractRequest,
  refundFailed: refundFailed as unknown as ContractRequest,
  refunded: refunded as unknown as ContractRequest,
  releaseInFlight: releaseInFlight as unknown as ContractRequest,
  releaseFailed: releaseFailed as unknown as ContractRequest,
  paid: paid as unknown as ContractRequest,
} as const;
