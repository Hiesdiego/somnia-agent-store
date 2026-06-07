# AutopilotVault

`AutopilotVault` is an optional add-on contract for user-funded autonomous SAS runs.

It does not replace `SASBilling`. It sponsors `SASBilling.executeAgent` from a user-funded mission balance.

## User Model

Users do not buy a fixed number of runs. They fund a mission balance.

Each autonomous run deducts the current billing quote plus its relayer fee:

- `agentFee`: the listing's `pricePerExecution`, split between builder and protocol
- `runtimeBudget`: pass-through funding for the Somnia Agent Platform request
- `relayerFee`: reimbursement bounded by the user's configured cap

Example:

- User funds 10 STT.
- Billing quotes a 0.02 STT agent fee and 0.24 STT runtime budget.
- Relayer fee is 0.20 STT.
- Each run deducts 0.46 STT.
- Relayer can execute until the mission balance is exhausted.
- If the service fee or Somnia runtime quote changes, the balance lasts a different number of runs.

The user can cancel a mission and withdraw the unused balance.

## Contract Flow

1. User calls `createMission(agentId, maxRelayerFeePerRun, minCadenceSeconds, maxRuns, expiresAt, maxTotalSpend, marketHash, questionHash, payloadTemplateHash, metadataURI)` with STT.
2. Vault stores mission owner, agent ID, balance, spent, run count, the immutable mission policy, and metadata.
3. Admin-authorized relayer watches the mission off-chain.
4. When the mission trigger fires, relayer calls:

```solidity
executeMission(missionId, payload, idempotencyKey, relayerFee, marketHash, questionHash, payloadTemplateHash, payloadHash, contextHash, runMetadataURI)
```

5. Vault reads `SASBilling.quoteExecution(agentId)`.
6. Vault verifies the mission is within its expiry, max run count, cadence, spend cap, relayer fee cap, market hash, question hash, payload template hash, and declared payload hash.
7. Vault deducts `agentFee + runtimeBudget + relayerFee` from mission balance.
8. Vault calls `SASBilling.executeAgent{value: agentFee + runtimeBudget}(agentId, payload)`.
9. Vault reimburses the relayer up to the user-defined `maxRelayerFeePerRun`.
10. SASBilling creates the execution record with `subscriber = AutopilotVault`.
11. Vault emits `MissionSpent` with mission owner, execution ID, agent fee, runtime budget, relayer fee, remaining balance, idempotency key, payload template hash, payload hash, and context hash.

Indexers should join `MissionSpent.executionId` to `SASBilling.getExecutionRecord(executionId)`.
Relayer metadata can be stored off-chain against `idempotencyKey` and `executionId`.

## Spend Visibility

Users can inspect:

- mission balance
- total spent
- run count
- active/inactive status
- max relayer fee per run
- min cadence
- max runs
- expiry
- max total spend
- market hash
- question hash
- payload template hash
- per-run payload hash
- per-run context hash
- emitted `MissionSpent` events
- SAS execution records for each run

## Relayer Safety

The relayer cannot withdraw user funds. It can only spend a mission balance on the mission's configured SAS agent.

Protections:

- only authorized relayers can execute
- mission must be active
- agent must still be active
- mission balance must cover the current billing quote plus relayer fee
- relayer fee must be at or below the user-defined cap
- mission must not be expired
- mission must not have reached its max run count
- mission cadence must have elapsed
- mission total spend must stay at or below its spend cap
- execution market and question hashes must match the immutable mission policy
- execution payload template hash must match the immutable mission policy
- declared payload hash must equal `keccak256(payload)`
- context hash must be nonzero and emitted for audit
- idempotency key prevents duplicate trigger execution
- user can cancel and withdraw remaining balance

`marketHash` and `questionHash` are `keccak256` hashes of the canonical Prophecy event URL and user-approved question. `payloadTemplateHash` pins the approved Prophecy Companion prompt/payload template. Each execution must provide a `payloadHash` that equals `keccak256(payload)`, and `MissionSpent` emits both that payload hash and the `contextHash` used by the relayer.

The vault still does not parse natural-language prompt semantics. Full prevention of malicious dynamic context requires either precommitted context hashes or a vault-built payload. This version makes every execution cryptographically auditable at the vault/indexer layer and prevents the relayer from claiming a different payload hash than the bytes actually submitted to billing.

## Deployment

The SAS v0.1 vault is deployed separately after the SAS v0.1 core. The testnet module has
defaults pinned to the current `sas-v0-1-core-testnet` billing and registry
addresses, so this works directly:

```bash
pnpm --filter contracts deploy:core:v0.1:testnet
pnpm --filter contracts deploy:vault:v0.1:testnet
```

If the SAS v0.1 core is redeployed and addresses change, pass overrides with:

```bash
pnpm --filter contracts deploy:vault:v0.1:testnet -- --parameters ignition/parameters/v0_1-vault.json
```

Use `ignition/parameters/v0_1-vault.json.example` as the parameter-file shape.

This runs fresh deployment IDs, `sas-v0-1-core-testnet` and
`sas-v0-1-vault-testnet`. The deployed V2 contracts remain immutable and
continue to require an executor-funded runtime reserve.

Existing V2 testnet deployment, retained only for migration reference:

- Registry: `0x1c55A9b56F66e038EfD21946161D963672CEe8cA`
- Billing: `0x14aBd9Ffba983b0DA85961631572Ea29f61199f7`
- Relayer: `0xddd660f9c166FB6fcAfb53e4f757fF9986Ef0995`

Current SAS v0.1 testnet deployment:

- Registry: `0x25029648D4dDaE085c8db865582F43Bce2857766`
- Billing: `0xCD5d2bF50Cd496Dad9748B4d2fDcF02C7BC82F03`
- Executor: `0x7E5da137BEa251955C49cC7730e281E2Cd4b14Ec`
- AutopilotVault: `0x553CEE1B1aA3cD44E25Ff64Bf4dAf2b8E4C6eDC2`

Previous SAS v0.1 vault retained only for migration reference:

- AutopilotVault: `0xE7F454628390d1DD95De3D2cEB10fBFc27a9d041`

V2 deployed vault:

- AutopilotVault: `0x73ad3B66e7e9f1f50698bF50A53e58B0609F1339`

Legacy deployed vault:

- AutopilotVault: `0x966B4282EE0102df72A63a483b7019e98614b423`

New pay-per-execution missions must use `AutopilotVaultV0_1Module#AutopilotVault`
after the SAS v0.1 core addresses have been deployed and configured.

Override these with Ignition parameters before production deployment.
