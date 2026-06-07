"use client";

import { Navbar } from "@/components/layout/Navbar";
import { usePlatformStats, useSomniaReserveBalance, useTreasuryBalance } from "@/lib/hooks/useBilling";
import { formatAddress, formatSTT } from "@/lib/types";
import { AlertTriangle, LockKeyhole, Shield } from "lucide-react";
import { useAccount, useChainId } from "wagmi";
import { getAddresses } from "@/lib/contracts/addresses";
import { GovernorActivityPanel } from "@/components/autonomy/GovernorActivityPanel";

const ADMIN_PANEL_ENABLED = (process.env.NEXT_PUBLIC_SAS_ADMIN_PANEL_ENABLED ?? "0") === "1";
const SAS_ADMIN_ADDRESS = (
  process.env.NEXT_PUBLIC_SAS_ADMIN_ADDRESS ??
  "0x5219d14dFbCF0be6EC00D6B5188fFF353aeb33BF"
).toLowerCase();
const EVE_OPERATOR_ADDRESS = process.env.NEXT_PUBLIC_EVE_OPERATOR_ADDRESS?.trim() || SAS_ADMIN_ADDRESS;
const EVE_SOMNIA_AGENT_ID = process.env.NEXT_PUBLIC_EVE_SOMNIA_AGENT_ID?.trim();

function ReadOnlyCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="card" style={{ padding: "16px" }}>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "10px",
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: "6px",
        }}
      >
        {label}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "15px", color: "var(--text-primary)" }}>
        {value}
      </div>
    </div>
  );
}

export default function AdminPage() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { data: stats } = usePlatformStats();
  const { data: treasuryBalance } = useTreasuryBalance();
  const { data: reserveBalance } = useSomniaReserveBalance();

  const resolvedAddresses = (() => {
    try {
      return getAddresses(chainId);
    } catch {
      return getAddresses(50312);
    }
  })();

  const isAuthorizedAdmin =
    ADMIN_PANEL_ENABLED && Boolean(address) && address!.toLowerCase() === SAS_ADMIN_ADDRESS;

  if (!isAuthorizedAdmin) {
    return (
      <div style={{ minHeight: "100vh" }}>
        <Navbar />
        <div style={{ textAlign: "center", padding: "80px 24px", maxWidth: "720px", margin: "0 auto" }}>
          <LockKeyhole size={40} color="var(--text-muted)" style={{ marginBottom: "12px" }} />
          <p style={{ color: "var(--text-secondary)", fontSize: "16px", margin: "0 0 8px" }}>
            SAS frontend admin controls are disabled.
          </p>
          <p style={{ color: "var(--text-muted)", fontSize: "13px", margin: 0 }}>
            Governance actions are timelocked and must run via off-frontend execution.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh" }}>
      <Navbar />
      <div style={{ maxWidth: "1080px", margin: "0 auto", padding: "28px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "18px" }}>
          <div
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "10px",
              background: "rgba(251,191,36,0.1)",
              border: "1px solid rgba(251,191,36,0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Shield size={16} color="var(--amber-400)" />
          </div>
          <div>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "22px",
                fontWeight: 800,
                margin: 0,
                letterSpacing: "-0.03em",
              }}
            >
              SAS Governance Status
            </h1>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0, fontFamily: "var(--font-mono)" }}>
              Authorized wallet: {address ? formatAddress(address) : "not connected"}
            </p>
          </div>
        </div>

        <div
          style={{
            padding: "14px 16px",
            background: "rgba(59,130,246,0.08)",
            border: "1px solid rgba(59,130,246,0.25)",
            borderRadius: "10px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            marginBottom: "18px",
          }}
        >
          <AlertTriangle size={16} color="#93C5FD" />
          <div style={{ color: "var(--text-secondary)", fontSize: "13px" }}>
            Mutating admin actions are intentionally removed from frontend. Use the timelock governance flow.
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
          <ReadOnlyCard label="SAS Registry" value={resolvedAddresses.SASRegistry} />
          <ReadOnlyCard label="SAS Billing" value={resolvedAddresses.SASBilling} />
          <ReadOnlyCard label="SAS Executor" value={resolvedAddresses.SASExecutor} />
          <ReadOnlyCard label="SAS Execution Graph" value={resolvedAddresses.SASExecutionGraph} />
          <ReadOnlyCard
            label="Treasury Balance"
            value={treasuryBalance !== undefined ? `${formatSTT(treasuryBalance, 6)} STT` : "-"}
          />
          <ReadOnlyCard
            label="Executor Reserve"
            value={reserveBalance !== undefined ? `${formatSTT(reserveBalance, 6)} STT` : "-"}
          />
          <ReadOnlyCard
            label="Total Executions"
            value={stats ? Number(stats[0]).toLocaleString() : "-"}
          />
          <ReadOnlyCard
            label="Service Revenue"
            value={stats ? `${formatSTT(stats[1], 4)} STT` : "-"}
          />
        </div>

        <div style={{ marginTop: "16px" }}>
          <GovernorActivityPanel operatorAddress={EVE_OPERATOR_ADDRESS} somniaAgentId={EVE_SOMNIA_AGENT_ID} />
        </div>
      </div>
    </div>
  );
}
