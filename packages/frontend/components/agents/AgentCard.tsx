"use client";

import Link from "next/link";
import Image from "next/image";
import {
  AgentConfig,
  AgentType,
  AGENT_TYPE_LABELS,
  AGENT_TYPE_BADGE,
  formatSTT,
  formatAddress,
  formatAgentUid,
  formatRelative,
} from "@/lib/types";
import { CONTRACT_ADDRESSES } from "@/lib/contracts/addresses";
import { Zap, CheckCircle, BarChart2, TrendingUp } from "lucide-react";
import { useAgentMetadata } from "@/lib/hooks/useAgentMetadata";

const TYPE_ICONS: Record<AgentType, string> = {
  [AgentType.LLM_INFERENCE]: "AI",
  [AgentType.JSON_API]: "API",
  [AgentType.WEBSITE_PARSE]: "WEB",
  [AgentType.CUSTOM_OFFCHAIN]: "RUN",
};

interface AgentCardProps {
  agent: AgentConfig;
  animationDelay?: number;
}

export function AgentCard({ agent, animationDelay = 0 }: AgentCardProps) {
  const { imageUrl } = useAgentMetadata(agent.metadataURI);

  return (
    <Link
      href={`/marketplace/${agent.id.toString()}`}
      style={{ textDecoration: "none", display: "block" }}
    >
      <div
        className="card animate-fade-in"
        style={{
          padding: "20px",
          cursor: "pointer",
          animationDelay: `${animationDelay}ms`,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Subtle top gradient line */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "2px",
            background: "linear-gradient(90deg, var(--purple-600), var(--teal-500))",
            opacity: 0,
            transition: "opacity 200ms ease",
          }}
          className="card-accent-line"
        />

        {/* Header row */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "12px" }}>
          {/* Icon */}
          <div
            style={{
              width: "44px",
              height: "44px",
              borderRadius: "10px",
              background: "var(--bg-raised)",
              border: "1px solid var(--bg-border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "22px",
              flexShrink: 0,
              position: "relative",
              overflow: "hidden",
            }}
          >
            {imageUrl ? (
              <Image
                src={imageUrl}
                alt={`${agent.name} image`}
                fill
                sizes="44px"
                unoptimized
                style={{ objectFit: "cover" }}
              />
            ) : (
              TYPE_ICONS[agent.agentType as AgentType]
            )}
          </div>

          {/* Badges */}
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <span className={`badge ${AGENT_TYPE_BADGE[agent.agentType as AgentType]}`}>
              {AGENT_TYPE_LABELS[agent.agentType as AgentType]}
            </span>
            {agent.isVerified && (
              <span className="badge badge-verified" style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                <CheckCircle size={9} />
                Verified
              </span>
            )}
          </div>
        </div>

        {/* Name */}
        <h3
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "16px",
            fontWeight: 700,
            color: "var(--text-primary)",
            margin: "0 0 6px 0",
            lineHeight: 1.3,
            letterSpacing: "-0.01em",
          }}
        >
          {agent.name}
        </h3>

        {/* Description */}
        <p
          style={{
            fontSize: "13px",
            color: "var(--text-secondary)",
            margin: "0 0 16px 0",
            lineHeight: 1.5,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {agent.description}
        </p>

        {/* Stats row */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "8px",
            marginBottom: "14px",
          }}
        >
          <div
            style={{
              background: "var(--bg-raised)",
              borderRadius: "8px",
              padding: "8px 10px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "4px", marginBottom: "2px" }}>
              <BarChart2 size={10} color="var(--text-muted)" />
              <span style={{ fontSize: "10px", color: "var(--text-muted)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Runs
              </span>
            </div>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
              {agent.totalExecutions.toLocaleString()}
            </span>
          </div>
          <div
            style={{
              background: "var(--bg-raised)",
              borderRadius: "8px",
              padding: "8px 10px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "4px", marginBottom: "2px" }}>
              <TrendingUp size={10} color="var(--text-muted)" />
              <span style={{ fontSize: "10px", color: "var(--text-muted)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Revenue
              </span>
            </div>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "14px", fontWeight: 600, color: "var(--teal-400)" }}>
              {formatSTT(agent.totalRevenue, 2)} STT
            </span>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: "12px",
            borderTop: "1px solid var(--bg-border)",
          }}
        >
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)" }}>
            {formatAgentUid(agent.id, CONTRACT_ADDRESSES.somniaTestnet.SASRegistry)} | by {formatAddress(agent.builder)}
          </span>

          {/* Price */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              background: "rgba(124, 58, 237, 0.1)",
              border: "1px solid rgba(124, 58, 237, 0.25)",
              borderRadius: "6px",
              padding: "4px 8px",
            }}
          >
            <Zap size={10} color="var(--purple-400)" />
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--purple-400)",
              }}
            >
              {formatSTT(agent.pricePerExecution, 4)} STT service fee
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

