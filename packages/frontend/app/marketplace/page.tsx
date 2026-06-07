"use client";

import { useState, useMemo } from "react";
import { Navbar } from "@/components/layout/Navbar";
import { AgentCard } from "@/components/agents/AgentCard";
import { useAllActiveAgents } from "@/lib/hooks/useRegistry";
import { usePlatformStats } from "@/lib/hooks/useBilling";
import { AgentConfig, AgentType, formatSTT } from "@/lib/types";
import { Search, SlidersHorizontal, Zap, BarChart2, TrendingUp } from "lucide-react";

const CATEGORIES = ["All", "Sports", "Finance", "AI", "Data", "DeFi", "Gaming", "Social"];
const FEATURED_COMPANION_ID_RAW = process.env.NEXT_PUBLIC_COMPANION_SAS_AGENT_ID?.trim() ?? "";
const FEATURED_COMPANION_ID =
  FEATURED_COMPANION_ID_RAW && /^\d+$/.test(FEATURED_COMPANION_ID_RAW)
    ? BigInt(FEATURED_COMPANION_ID_RAW)
    : null;

const TYPE_FILTERS = [
  { value: "all",    label: "All Types" },
  { value: String(AgentType.LLM_INFERENCE),  label: "LLM Inference" },
  { value: String(AgentType.JSON_API),       label: "JSON API" },
  { value: String(AgentType.WEBSITE_PARSE),  label: "Web Scrape" },
];

const SORT_OPTIONS = [
  { value: "newest",    label: "Newest" },
  { value: "popular",   label: "Most Runs" },
  { value: "revenue",   label: "Top Revenue" },
  { value: "price_asc", label: "Price: Low to High" },
  { value: "price_desc","label": "Price: High to Low" },
];

export default function MarketplacePage() {
  const { data: agents, isLoading } = useAllActiveAgents();
  const { data: stats } = usePlatformStats();

  const [search, setSearch]   = useState("");
  const [category, setCategory] = useState("All");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sort, setSort]       = useState("newest");
  const [verifiedOnly, setVerifiedOnly] = useState(false);

  const filtered = useMemo(() => {
    if (!agents) return [];
    let list = ([...agents] as AgentConfig[]).filter(
      a =>
        a.agentType !== AgentType.CUSTOM_OFFCHAIN &&
        a.somniaAgentId > 0n
    );

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        a => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)
      );
    }

    // Category
    if (category !== "All") {
      list = list.filter(a => a.category.toLowerCase() === category.toLowerCase());
    }

    // Type filter
    if (typeFilter !== "all") {
      list = list.filter(a => String(a.agentType) === typeFilter);
    }

    // Verified
    if (verifiedOnly) {
      list = list.filter(a => a.isVerified);
    }

    // Sort
    const pinFeatured = (a: AgentConfig, b: AgentConfig) => {
      if (!FEATURED_COMPANION_ID) return 0;
      if (a.id === FEATURED_COMPANION_ID && b.id !== FEATURED_COMPANION_ID) return -1;
      if (b.id === FEATURED_COMPANION_ID && a.id !== FEATURED_COMPANION_ID) return 1;
      return 0;
    };

    switch (sort) {
      case "popular":
        list.sort((a, b) => pinFeatured(a, b) || Number(b.totalExecutions - a.totalExecutions));
        break;
      case "revenue":
        list.sort((a, b) => pinFeatured(a, b) || Number(b.totalRevenue - a.totalRevenue));
        break;
      case "price_asc":
        list.sort((a, b) => pinFeatured(a, b) || Number(a.pricePerExecution - b.pricePerExecution));
        break;
      case "price_desc":
        list.sort((a, b) => pinFeatured(a, b) || Number(b.pricePerExecution - a.pricePerExecution));
        break;
      default:
        list.sort((a, b) => pinFeatured(a, b) || Number(b.createdAt - a.createdAt));
        break;
    }

    return list;
  }, [agents, search, category, typeFilter, sort, verifiedOnly]);

  return (
    <div style={{ minHeight: "100vh" }}>
      <Navbar />

      {/* Hero stats banner */}
      <div
        style={{
          background: "linear-gradient(180deg, var(--bg-surface) 0%, transparent 100%)",
          borderBottom: "1px solid var(--bg-border)",
          padding: "32px 24px",
        }}
      >
        <div style={{ maxWidth: "1280px", margin: "0 auto" }}>
          <div style={{ marginBottom: "24px" }}>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "clamp(24px, 3vw, 36px)",
                fontWeight: 800,
                margin: "0 0 6px 0",
                letterSpacing: "-0.03em",
              }}
            >
              Agent <span className="gradient-text">Marketplace</span>
            </h1>
            <p style={{ fontSize: "14px", color: "var(--text-secondary)", margin: 0 }}>
              Reference marketplace for active Somnia-native SAS agents. Prophecy Companion is pinned when configured.
            </p>
          </div>

          {/* Platform stats strip */}
          {stats && (
            <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
              {[
                { icon: Zap, label: "Active Agents", value: String(agents?.length ?? 0), color: "var(--purple-400)" },
                { icon: BarChart2, label: "Total Executions", value: Number(stats[0]).toLocaleString(), color: "var(--teal-400)" },
                { icon: TrendingUp, label: "Service Revenue", value: `${formatSTT(stats[1], 2)} STT`, color: "var(--amber-400)" },
              ].map(({ icon: Icon, label, value, color }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Icon size={14} color={color} />
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--text-muted)" }}>{label}:</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "13px", fontWeight: 600, color }}>{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "28px 24px" }}>
        {/* Filter bar */}
        <div
          style={{
            display: "flex",
            gap: "10px",
            marginBottom: "20px",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          {/* Search */}
          <div style={{ position: "relative", flex: "1 1 220px" }}>
            <Search
              size={14}
              color="var(--text-muted)"
              style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)" }}
            />
            <input
              className="input"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search agents..."
              style={{ paddingLeft: "36px" }}
            />
          </div>

          {/* Type filter */}
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="input"
            style={{ flex: "0 0 auto", width: "auto" }}
          >
            {TYPE_FILTERS.map(f => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>

          {/* Sort */}
          <select
            value={sort}
            onChange={e => setSort(e.target.value)}
            className="input"
            style={{ flex: "0 0 auto", width: "auto" }}
          >
            {SORT_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          {/* Verified toggle */}
          <button
            onClick={() => setVerifiedOnly(!verifiedOnly)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "9px 12px",
              borderRadius: "8px",
              border: verifiedOnly ? "1px solid var(--teal-500)" : "1px solid var(--bg-border)",
              background: verifiedOnly ? "rgba(20, 184, 166, 0.1)" : "var(--bg-raised)",
              color: verifiedOnly ? "var(--teal-400)" : "var(--text-muted)",
              cursor: "pointer",
              fontSize: "13px",
              fontFamily: "var(--font-display)",
              fontWeight: 500,
              transition: "all 150ms ease",
            }}
          >
            <SlidersHorizontal size={13} />
            Verified only
          </button>
        </div>

        {/* Category pills */}
        <div style={{ display: "flex", gap: "6px", marginBottom: "24px", flexWrap: "wrap" }}>
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              style={{
                padding: "5px 12px",
                borderRadius: "999px",
                border: category === cat ? "1px solid var(--purple-500)" : "1px solid var(--bg-border)",
                background: category === cat ? "rgba(124, 58, 237, 0.15)" : "transparent",
                color: category === cat ? "var(--purple-400)" : "var(--text-muted)",
                cursor: "pointer",
                fontSize: "12px",
                fontFamily: "var(--font-display)",
                fontWeight: 500,
                transition: "all 150ms ease",
              }}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Results count */}
        <div style={{ marginBottom: "16px" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--text-muted)" }}>
            {isLoading ? "Loading agents..." : `${filtered.length} agent${filtered.length !== 1 ? "s" : ""} found`}
          </span>
        </div>

        {/* Grid */}
        {isLoading ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: "16px",
            }}
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="card"
                style={{
                  height: "220px",
                  background: "linear-gradient(90deg, var(--bg-surface) 25%, var(--bg-raised) 50%, var(--bg-surface) 75%)",
                  backgroundSize: "200% 100%",
                  animation: "shimmer 1.5s infinite",
                }}
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "80px 24px",
              color: "var(--text-muted)",
            }}
          >
            <p style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-secondary)", margin: "0 0 6px" }}>
              No agents match the current filters
            </p>
            <p style={{ fontSize: "13px", margin: 0 }}>
              Clear search, category, type, or verified-only filters to see active SAS listings.
            </p>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: "16px",
            }}
          >
            {filtered.map((agent, i) => (
              <AgentCard
                key={agent.id.toString()}
                agent={agent}
                animationDelay={i * 40}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


