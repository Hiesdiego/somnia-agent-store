import "dotenv/config";
import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const DEFAULT_TESTNET_TIMELOCK = "0x8915F4919F6a2031A6aba16D9AAe639BE209b23b";
const DEFAULT_LEGACY_EOA = "0x5219d14dFbCF0be6EC00D6B5188fFF353aeb33BF";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

function optional(name) {
  return process.env[name]?.trim() || undefined;
}

function asBool(raw, fallback) {
  if (raw === undefined) return fallback;
  return !["0", "false", "no", "off"].includes(raw.toLowerCase());
}

function parseAddressList(raw) {
  if (!raw) return [];
  return raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => getAddress(x));
}

function uniqueAddresses(list) {
  return [...new Set(list.map((x) => x.toLowerCase()))].map((x) => getAddress(x));
}

function readTimelockAbi() {
  const artifactPath = new URL(
    "../artifacts/contracts/SASAdminTimelock.sol/SASAdminTimelock.json",
    import.meta.url
  );
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  return artifact.abi;
}

async function readRoleConstant(publicClient, timelockAddress, abi, candidates) {
  const available = new Set(
    abi
      .filter((entry) => entry?.type === "function" && typeof entry.name === "string")
      .map((entry) => entry.name)
  );
  const functionName = candidates.find((name) => available.has(name));
  if (!functionName) {
    throw new Error(`None of the role getters exist on ABI: ${candidates.join(", ")}`);
  }
  return publicClient.readContract({
    address: timelockAddress,
    abi,
    functionName,
  });
}

async function main() {
  const target = (process.env.SAS_GOVERNANCE_TARGET_NETWORK ?? "testnet").toLowerCase();
  const chain =
    target === "mainnet"
      ? defineChain({
          id: 5031,
          name: "Somnia Mainnet",
          nativeCurrency: { name: "SOMNIA", symbol: "SOMNIA", decimals: 18 },
          rpcUrls: { default: { http: ["https://api.infra.mainnet.somnia.network"] } },
        })
      : defineChain({
          id: 50312,
          name: "Somnia Shannon Testnet",
          nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
          rpcUrls: { default: { http: ["https://api.infra.testnet.somnia.network"] } },
        });

  const rawPrivateKey = required("DEPLOYER_PRIVATE_KEY");
  const privateKey = rawPrivateKey.startsWith("0x") ? rawPrivateKey : `0x${rawPrivateKey}`;
  const account = privateKeyToAccount(privateKey);

  const timelockAddress = getAddress(
    optional("SAS_ADMIN_TIMELOCK_ADDRESS") || DEFAULT_TESTNET_TIMELOCK
  );
  const legacyEOA = getAddress(optional("SAS_LEGACY_EOA") || DEFAULT_LEGACY_EOA);
  const dryRun = asBool(optional("SAS_GOVERNANCE_DRY_RUN"), true);
  const revokeLegacy = asBool(optional("SAS_GOVERNANCE_REVOKE_LEGACY_EOA"), false);

  const proposers = uniqueAddresses(
    parseAddressList(optional("SAS_GOVERNANCE_PROPOSERS") || optional("SAS_GOVERNANCE_PROPOSER"))
  );
  const executors = uniqueAddresses(
    parseAddressList(optional("SAS_GOVERNANCE_EXECUTORS") || optional("SAS_GOVERNANCE_EXECUTOR"))
  );
  const admins = uniqueAddresses(
    parseAddressList(optional("SAS_GOVERNANCE_TIMELOCK_ADMINS") || optional("SAS_GOVERNANCE_TIMELOCK_ADMIN"))
  );

  const abi = readTimelockAbi();
  const transport = http(chain.rpcUrls.default.http[0]);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ chain, transport, account });

  const proposerRole = await readRoleConstant(publicClient, timelockAddress, abi, ["PROPOSER_ROLE"]);
  const executorRole = await readRoleConstant(publicClient, timelockAddress, abi, ["EXECUTOR_ROLE"]);
  const adminRole = await readRoleConstant(publicClient, timelockAddress, abi, [
    "TIMELOCK_ADMIN_ROLE",
    "DEFAULT_ADMIN_ROLE",
  ]);

  console.log("Configuring SAS timelock roles...");
  console.log(`Network: ${chain.name} (${chain.id})`);
  console.log(`Timelock: ${timelockAddress}`);
  console.log(`Signer: ${account.address}`);
  console.log(`Dry run: ${dryRun}`);
  console.log(`Revoke legacy EOA: ${revokeLegacy}`);
  console.log(`Legacy EOA: ${legacyEOA}`);
  console.log(`Target proposers: ${proposers.length ? proposers.join(", ") : "(skip)"}`);
  console.log(`Target executors: ${executors.length ? executors.join(", ") : "(skip)"}`);
  console.log(`Target timelock admins: ${admins.length ? admins.join(", ") : "(skip)"}`);

  async function hasRole(role, who) {
    return publicClient.readContract({
      address: timelockAddress,
      abi,
      functionName: "hasRole",
      args: [role, who],
    });
  }

  async function maybeWrite(label, fn) {
    if (dryRun) {
      console.log(`[dry-run] ${label}`);
      return;
    }
    const hash = await fn();
    console.log(`${label} tx: ${hash}`);
    await publicClient.waitForTransactionReceipt({ hash });
  }

  async function ensureRole(roleName, role, targets) {
    for (const targetAddress of targets) {
      const already = await hasRole(role, targetAddress);
      if (already) {
        console.log(`[ok] ${roleName} already granted: ${targetAddress}`);
        continue;
      }
      await maybeWrite(`grant ${roleName} -> ${targetAddress}`, () =>
        walletClient.writeContract({
          address: timelockAddress,
          abi,
          functionName: "grantRole",
          args: [role, targetAddress],
          account,
          chain,
        })
      );
    }
  }

  async function maybeRevokeLegacy(roleName, role, targets) {
    if (!revokeLegacy) return;
    const keepLegacy = targets.some((x) => x.toLowerCase() === legacyEOA.toLowerCase());
    if (keepLegacy) {
      console.log(`[skip] ${roleName} revoke for legacy EOA (it is in target list)`);
      return;
    }
    const legacyHasRole = await hasRole(role, legacyEOA);
    if (!legacyHasRole) {
      console.log(`[ok] Legacy EOA does not hold ${roleName}`);
      return;
    }
    await maybeWrite(`revoke ${roleName} <- ${legacyEOA}`, () =>
      walletClient.writeContract({
        address: timelockAddress,
        abi,
        functionName: "revokeRole",
        args: [role, legacyEOA],
        account,
        chain,
      })
    );
  }

  await ensureRole("PROPOSER_ROLE", proposerRole, proposers);
  await ensureRole("EXECUTOR_ROLE", executorRole, executors);
  await ensureRole("TIMELOCK_ADMIN_ROLE", adminRole, admins);

  if (revokeLegacy && proposers.length === 0 && executors.length === 0 && admins.length === 0) {
    throw new Error(
      "Refusing legacy revoke with empty target role lists. Provide SAS_GOVERNANCE_* target addresses."
    );
  }

  await maybeRevokeLegacy("PROPOSER_ROLE", proposerRole, proposers);
  await maybeRevokeLegacy("EXECUTOR_ROLE", executorRole, executors);
  await maybeRevokeLegacy("TIMELOCK_ADMIN_ROLE", adminRole, admins);

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
