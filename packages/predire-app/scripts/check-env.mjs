import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(file) {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(".env.production");
loadEnvFile(".env.local");
loadEnvFile(".env");

const REQUIRED_PUBLIC = [
  "NEXT_PUBLIC_PRIVY_APP_ID",
  "NEXT_PUBLIC_SAS_REGISTRY_ADDRESS",
  "NEXT_PUBLIC_SAS_BILLING_ADDRESS",
  "NEXT_PUBLIC_SAS_EXECUTOR_ADDRESS",
  "NEXT_PUBLIC_COMPANION_SAS_AGENT_ID",
  "NEXT_PUBLIC_COMPANION_SOMNIA_AGENT_ID",
  "NEXT_PUBLIC_AUTOPILOT_VAULT_ADDRESS",
];

const ADDRESS_KEYS = [
  "NEXT_PUBLIC_SAS_REGISTRY_ADDRESS",
  "NEXT_PUBLIC_SAS_BILLING_ADDRESS",
  "NEXT_PUBLIC_SAS_EXECUTOR_ADDRESS",
  "NEXT_PUBLIC_SAS_AUTONOMY_V4_ADDRESS",
  "NEXT_PUBLIC_AUTOPILOT_VAULT_ADDRESS",
];

const PLACEHOLDERS = new Set([
  "",
  "0",
  "your_privy_app_id",
  "your_production_privy_app_id",
  "0x0000000000000000000000000000000000000000",
]);

const errors = [];

for (const key of REQUIRED_PUBLIC) {
  const value = process.env[key]?.trim() ?? "";
  if (PLACEHOLDERS.has(value)) errors.push(`${key} is missing or still uses a placeholder.`);
}

for (const key of ADDRESS_KEYS) {
  const value = process.env[key]?.trim();
  if (!value) continue;
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) errors.push(`${key} is not a valid EVM address.`);
}

for (const key of ["NEXT_PUBLIC_COMPANION_SAS_AGENT_ID", "NEXT_PUBLIC_COMPANION_SOMNIA_AGENT_ID"]) {
  const value = process.env[key]?.trim();
  if (!value || !/^\d+$/.test(value)) errors.push(`${key} must be a positive integer string.`);
}

for (const [key, value] of Object.entries(process.env)) {
  if (!key.startsWith("NEXT_PUBLIC_")) continue;
  if (/PRIVATE_KEY|SECRET|SERVICE_ROLE|API_KEY|TOKEN/i.test(key)) {
    errors.push(`${key} looks like a secret but is exposed to the browser.`);
  }
  if (/^[a-fA-F0-9]{64}$/.test(value ?? "") || /^0x[a-fA-F0-9]{64}$/.test(value ?? "")) {
    errors.push(`${key} looks like a private key and must not be public.`);
  }
}

if (errors.length) {
  console.error("Prophecy Companion environment check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Prophecy Companion environment check passed.");
