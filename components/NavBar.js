"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_LINKS = [
  { href: "/", label: "Opportunities" },
  { href: "/players", label: "Players" },
];

export default function NavBar() {
  const pathname = usePathname();
  return (
    <nav className="sticky top-0 z-40 bg-scout-bg/95 backdrop-blur border-b border-scout-border">
      <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-14">
        <Link href="/" className="text-scout-accent font-bold text-lg">FFA Scout Board</Link>
        <div className="flex gap-1">
          {NAV_LINKS.map((link) => {
            const isActive = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link key={link.href} href={link.href}
                className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                  isActive ? "border-scout-accent text-scout-accent" : "border-transparent text-gray-400 hover:text-gray-300"
                }`}>
                {link.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
