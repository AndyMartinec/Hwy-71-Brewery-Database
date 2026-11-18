"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Wheat,
  Beer,
  FlaskConical,
  BookOpen,
  Receipt,
  Calculator,
  ChartBar,
  ClipboardList,
  Settings,
} from "lucide-react";

const LINKS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/inventory", label: "Ingredient Inventory", icon: Wheat },
  { href: "/beer", label: "Finished Beer Inventory", icon: Beer },
  { href: "/recipes", label: "Recipes", icon: BookOpen },
  { href: "/batches", label: "Batches", icon: FlaskConical },
  { href: "/invoices", label: "Invoices", icon: Receipt },
  { href: "/orders", label: "Orders", icon: ClipboardList },
  { href: "/accounting", label: "Accounting", icon: Calculator },
  { href: "/reports", label: "Reports", icon: ChartBar },
  { href: "/fermentation", label: "Fermentation", icon: FlaskConical },
  { href: "/settings", label: "Settings", icon: Settings },
];

function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-copper-400/60 font-display text-lg font-bold tracking-wider text-copper-300">
        71
      </div>
      {!compact && (
        <div className="leading-tight">
          <p className="font-display text-xl font-semibold uppercase tracking-[0.14em] text-stone-100">
            Highway 71
          </p>
          <p className="text-[10px] font-medium uppercase tracking-[0.3em] text-copper-400">
            Brewing Co. — Ops
          </p>
        </div>
      )}
    </div>
  );
}

export default function Nav() {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col bg-ink-950 md:flex">
        <div className="border-b border-white/10 px-5 py-5">
          <Wordmark />
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {LINKS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition ${
                isActive(href)
                  ? "bg-white/10 text-white shadow-[inset_2px_0_0_0_var(--color-copper-400)]"
                  : "text-stone-400 hover:bg-white/5 hover:text-stone-100"
              }`}
            >
              <Icon className="h-4.5 w-4.5" strokeWidth={1.8} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-white/10 px-5 py-4">
          <p className="text-[10px] uppercase tracking-[0.25em] text-stone-500">
            Spicewood, Texas
          </p>
          <p className="mt-1 text-xs text-stone-500">
            Inventory · Production · Tax-ready records
          </p>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 flex items-center justify-between bg-ink-950 px-4 py-3 md:hidden">
        <Wordmark />
        <Link href="/settings" aria-label="Settings" className="p-2 text-stone-300">
          <Settings className="h-5 w-5" strokeWidth={1.8} />
        </Link>
      </header>

      {/* Mobile bottom tabs — scrolls horizontally */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/97 backdrop-blur md:hidden">
        <div className="flex gap-0.5 overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {LINKS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex shrink-0 flex-col items-center gap-1 px-3.5 py-2.5 text-[10px] font-medium ${
                isActive(href) ? "text-copper-700" : "text-stone-500"
              }`}
            >
              <Icon className="h-5 w-5" strokeWidth={1.8} />
              <span className="whitespace-nowrap">{label}</span>
            </Link>
          ))}
        </div>
        <div className="h-[env(safe-area-inset-bottom)]" />
      </nav>
    </>
  );
}
