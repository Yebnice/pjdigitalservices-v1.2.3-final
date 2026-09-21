import Link from "next/link";
import { useRouter } from "next/router";
import {
  Home, Wifi, Smartphone, Bolt, UserPlus, Tv, GraduationCap,
  ClipboardList, HelpCircle, MessageSquare, Menu, ShoppingCart,
  Shield, FileText, RotateCcw, Zap, UserCircle, LogOut, Star, LogIn,
} from "lucide-react";
import { useEffect, useState } from "react";
import ChatWidget from "./ChatWidget";

const MAIN_LINKS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/mtn-data", label: "MTN Data", icon: Wifi },
  { href: "/at-data", label: "AT Data", icon: Wifi },
  { href: "/telecel-data", label: "Telecel Data", icon: Wifi },
  { href: "/airtime", label: "Airtime", icon: Smartphone },
  { href: "/data", label: "Quick Data Top-up", icon: Zap },
  { href: "/bills", label: "Bills (ECG/Water)", icon: Bolt },
  { href: "/afa", label: "AFA Registration", icon: UserPlus },
  { href: "/tv", label: "TV Subscription", icon: Tv },
  { href: "/checker", label: "Result Checker", icon: GraduationCap },
  { href: "/reviews", label: "Reviews", icon: Star },
];

const ACCOUNT_LINKS = [
  { href: "/register", label: "Create Account", icon: UserCircle },
  { href: "/dashboard", label: "My Orders", icon: ClipboardList },
  { href: "/track", label: "Track an Order", icon: ShoppingCart },
  { href: "/faq", label: "FAQ", icon: HelpCircle },
  { href: "/feedback", label: "Support", icon: MessageSquare },
];

const LEGAL_LINKS = [
  { href: "/privacy", label: "Privacy", icon: Shield },
  { href: "/terms", label: "Terms", icon: FileText },
  { href: "/refunds", label: "Refunds", icon: RotateCcw },
];

function BrandMark({ size = 32, radius = 9 }) {
  return (
    <div className="brand-mark" style={{ width: size, height: size, borderRadius: radius }}>
      <img src="/logo-mark.png" alt="PjDigitalServices" />
    </div>
  );
}

function NavList({ links, router, onNavigate }) {
  return (
    <>
      {links.map((l) => {
        const Icon = l.icon;
        const active = router.pathname === l.href;
        return (
          <Link key={l.href} href={l.href} className={`nav-item ${active ? "active" : ""}`} onClick={onNavigate}>
            <Icon size={16} />
            {l.label}
          </Link>
        );
      })}
    </>
  );
}

export default function Layout({ children }) {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [customer, setCustomer] = useState(null);

  // Lets a logged-in admin sign out from anywhere on the site, not just
  // from the /admin page itself — previously the only sign-out control
  // lived inside pages/admin/index.js, so browsing away from /admin left
  // no way to end the session without navigating back there first.
  useEffect(() => {
    fetch("/api/admin/me")
      .then((r) => r.json())
      .then((d) => setIsAdmin(!!d.authenticated))
      .catch(() => {});
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setCustomer(d.customer || null))
      .catch(() => {});
  }, [router.pathname]);

  async function adminSignOut() {
    await fetch("/api/admin/logout", { method: "POST" });
    setIsAdmin(false);
    router.push("/");
  }

  async function customerSignOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    setCustomer(null);
    router.push("/");
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <BrandMark />
          <div>
            <div className="brand-word"><span className="pj">Pj</span><span className="rest">DigitalServices</span></div>
            <div className="brand-tagline">Think Data, Think PjDigitalServices</div>
          </div>
        </Link>

        <div className="sidebar-section-label">Services</div>
        <NavList links={MAIN_LINKS} router={router} />

        <div className="sidebar-section-label">Account</div>
        {customer ? (
          <button
            onClick={customerSignOut}
            className="nav-item"
            style={{ width: "100%", textAlign: "left", background: "transparent", border: "none", cursor: "pointer" }}
          >
            <LogOut size={16} />
            Log out ({customer.name?.split(" ")[0] || customer.username})
          </button>
        ) : (
          <Link href="/login" className={`nav-item ${router.pathname === "/login" ? "active" : ""}`}>
            <LogIn size={16} />
            Log in
          </Link>
        )}
        <NavList links={ACCOUNT_LINKS} router={router} />

        <div className="sidebar-footer">
          <NavList links={LEGAL_LINKS} router={router} />
          {isAdmin && (
            <button
              onClick={adminSignOut}
              className="nav-item"
              style={{ width: "100%", textAlign: "left", background: "transparent", border: "none", cursor: "pointer", color: "var(--red)" }}
            >
              <LogOut size={16} />
              Sign out (Admin)
            </button>
          )}
          <div style={{ fontSize: 11, color: "var(--muted-dim)", padding: "10px 10px 0", lineHeight: 1.5 }}>
            We'll never ask for your password, PIN, or OTP by phone, email, or WhatsApp.
          </div>
          <div style={{ fontSize: 11, color: "var(--muted-dim)", padding: "4px 10px 0" }}>
            © {new Date().getFullYear()} PjDigitalServices
          </div>
        </div>
      </aside>

      <div className="content-area">
        <div className="mobile-topbar">
          <Link href="/" className="brand" style={{ marginBottom: 0 }}>
            <BrandMark size={28} radius={8} />
            <div className="brand-word"><span className="pj">Pj</span><span className="rest">DigitalServices</span></div>
          </Link>
          <button
            onClick={() => setMobileOpen((v) => !v)}
            style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text)" }}
          >
            <Menu size={18} />
          </button>
        </div>
        {mobileOpen && (
          <nav className="mobile-nav">
            <NavList links={[...MAIN_LINKS, ...ACCOUNT_LINKS]} router={router} onNavigate={() => setMobileOpen(false)} />
            {isAdmin && (
              <button
                onClick={() => { setMobileOpen(false); adminSignOut(); }}
                className="nav-item"
                style={{ width: "100%", textAlign: "left", background: "transparent", border: "none", cursor: "pointer", color: "var(--red)" }}
              >
                <LogOut size={16} />
                Sign out (Admin)
              </button>
            )}
          </nav>
        )}

        <main>{children}</main>
      </div>

      <ChatWidget />
    </div>
  );
}
