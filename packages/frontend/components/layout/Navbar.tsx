"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useAccount, useBalance, useChainId } from "wagmi";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { formatAddress, formatSTT, SOMNIA_TESTNET } from "@/lib/types";
import { ChevronDown, LogOut, LayoutDashboard, Store, User, Shield, Copy, Check } from "lucide-react";
import { useState, useRef, useEffect } from "react";

const NAV_LINKS = [
  { href: "/marketplace", label: "Marketplace" },
  { href: "/docs", label: "Docs" },
  { href: "/docs/autonomy", label: "EVE" },
  { href: "/builder/dashboard", label: "Builder" },
  { href: "/user/dashboard", label: "My Runs" },
];

export function Navbar() {
  const { authenticated, logout, user, login } = usePrivy();
  const { address } = useAccount();
  const chainId = useChainId();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: balance } = useBalance({
    address,
    query: { enabled: Boolean(address), refetchInterval: 10_000 },
  });

  const isWrongNetwork = chainId !== SOMNIA_TESTNET.id;
  const adminPanelEnabled = (process.env.NEXT_PUBLIC_SAS_ADMIN_PANEL_ENABLED ?? "0") === "1";
  const sasAdminAddress = (
    process.env.NEXT_PUBLIC_SAS_ADMIN_ADDRESS ??
    "0x5219d14dFbCF0be6EC00D6B5188fFF353aeb33BF"
  ).toLowerCase();
  const showAdminLink = adminPanelEnabled && Boolean(address) && address!.toLowerCase() === sasAdminAddress;

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <nav
      className="sas-navbar"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "rgba(9, 0, 18, 0.76)",
        backdropFilter: "blur(18px)",
        borderBottom: "1px solid var(--bg-border)",
        boxShadow: "0 12px 36px rgba(0,0,0,0.22)",
      }}
    >
      <div
        className="sas-navbar-inner"
        style={{
          maxWidth: "1280px",
          margin: "0 auto",
          padding: "0 24px",
          height: "60px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "24px",
        }}
      >
        {/* Logo */}
        <Link
          className="sas-navbar-brand"
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            textDecoration: "none",
            flexShrink: 0,
          }}
        >
          <Image
            src="/sas-logo.png"
            alt="Somnia Agent Store logo"
            width={44}
            height={22}
            unoptimized
            style={{ objectFit: "contain", filter: "drop-shadow(0 0 10px rgba(216,184,255,0.45))" }}
          />
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontSize: "16px",
              color: "var(--text-primary)",
              letterSpacing: "-0.02em",
            }}
          >
            Somnia Agent Store
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "10px",
              color: "var(--teal-400)",
              background: "rgba(45, 212, 191, 0.1)",
              border: "1px solid rgba(45, 212, 191, 0.25)",
              borderRadius: "4px",
              padding: "1px 5px",
            }}
          >
            TESTNET
          </span>
        </Link>

        {/* Nav links */}
        <div className="sas-navbar-links" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          {NAV_LINKS.map((link) => {
            const active = pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                style={{
                  padding: "5px 12px",
                  borderRadius: "6px",
                  fontSize: "13px",
                  fontWeight: 500,
                  textDecoration: "none",
                  color: active ? "var(--purple-400)" : "var(--text-secondary)",
                  background: active ? "rgba(124, 58, 237, 0.1)" : "transparent",
                  transition: "all 150ms ease",
                }}
              >
                {link.label}
              </Link>
            );
          })}
          {/* Admin link — only show if connected (check off-chain if admin) */}
          {showAdminLink && (
            <Link
              href="/admin"
            style={{
              padding: "5px 12px",
              borderRadius: "6px",
              fontSize: "13px",
              fontWeight: 500,
              textDecoration: "none",
              color: pathname.startsWith("/admin") ? "var(--amber-400)" : "var(--text-muted)",
              background: pathname.startsWith("/admin") ? "rgba(251, 191, 36, 0.08)" : "transparent",
              transition: "all 150ms ease",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
            >
              <Shield size={12} />
              Admin
            </Link>
          )}
        </div>

        {/* Right side */}
        <div className="sas-navbar-account" style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
          {/* Wrong network warning */}
          {authenticated && isWrongNetwork && (
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                color: "#F87171",
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                borderRadius: "6px",
                padding: "4px 10px",
              }}
            >
              Wrong network
            </div>
          )}

          {!authenticated ? (
            <button className="btn-primary" onClick={() => login()} style={{ fontSize: "13px", padding: "7px 16px" }}>
              Sign In
            </button>
          ) : (
            <div ref={ref} style={{ position: "relative" }}>
              <button
                className="sas-wallet-button"
                onClick={() => setOpen(!open)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  background: "var(--bg-raised)",
                  border: "1px solid var(--bg-border)",
                  borderRadius: "8px",
                  padding: "6px 12px",
                  cursor: "pointer",
                  color: "var(--text-primary)",
                  fontSize: "13px",
                  fontFamily: "var(--font-display)",
                  transition: "border-color 150ms ease",
                }}
              >
                {/* Avatar */}
                <div
                  className="sas-wallet-avatar"
                  style={{
                    width: "20px",
                    height: "20px",
                    borderRadius: "50%",
                    background: "linear-gradient(135deg, var(--purple-500), var(--teal-500))",
                  }}
                />
                <span className="sas-wallet-address" style={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}>
                  {address ? formatAddress(address) : user?.email?.address?.split("@")[0] ?? "User"}
                </span>
                {balance && (
                  <span
                    className="sas-wallet-balance"
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "11px",
                      color: "var(--teal-400)",
                    }}
                  >
                    {formatSTT(balance.value, 2)} STT
                  </span>
                )}
                <ChevronDown size={12} color="var(--text-muted)" />
              </button>

              {open && (
                <div
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "calc(100% + 8px)",
                    background: "var(--bg-surface)",
                    border: "1px solid var(--bg-border)",
                    borderRadius: "10px",
                    minWidth: "200px",
                    overflow: "hidden",
                    boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
                    zIndex: 100,
                  }}
                >
                  <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--bg-border)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                      <div style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                        {address ? formatAddress(address) : "Embedded wallet"}
                      </div>
                      {address && (
                        <button
                          onClick={copyAddress}
                          title="Copy wallet address"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: "22px",
                            height: "22px",
                            borderRadius: "6px",
                            border: "1px solid var(--bg-border)",
                            background: copied ? "rgba(45, 212, 191, 0.15)" : "var(--bg-raised)",
                            color: copied ? "var(--teal-400)" : "var(--text-muted)",
                            cursor: "pointer",
                          }}
                        >
                          {copied ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                      )}
                    </div>
                    {balance && (
                      <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--teal-400)", fontFamily: "var(--font-mono)", marginTop: "2px" }}>
                        {formatSTT(balance.value, 4)} STT
                      </div>
                    )}
                  </div>
                  {[
                    { href: "/builder/dashboard", label: "Builder Dashboard", icon: LayoutDashboard },
                    { href: "/user/dashboard", label: "My Executions", icon: User },
                    { href: "/marketplace", label: "Marketplace", icon: Store },
                  ].map(({ href, label, icon: Icon }) => (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setOpen(false)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "10px 14px",
                        fontSize: "13px",
                        color: "var(--text-secondary)",
                        textDecoration: "none",
                        transition: "background 150ms ease",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-raised)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                    >
                      <Icon size={13} />
                      {label}
                    </Link>
                  ))}
                  <div style={{ borderTop: "1px solid var(--bg-border)" }}>
                    <button
                      onClick={() => { logout(); setOpen(false); }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "10px 14px",
                        width: "100%",
                        fontSize: "13px",
                        color: "#F87171",
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        fontFamily: "var(--font-display)",
                      }}
                    >
                      <LogOut size={13} />
                      Disconnect
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
