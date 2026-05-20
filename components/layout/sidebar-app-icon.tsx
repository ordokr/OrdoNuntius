"use client";

// Split out of navigation-rail.tsx specifically to defer the full Lucide
// icon registry (1544 icons, ~556KB minified) off the authenticated app
// shell bundle. navigation-rail renders on every authenticated route, so
// importing the registry eagerly there leaks the same ~556KB chunk into
// every route's initial JS. This component is dynamic-imported by
// navigation-rail and only fetched when the user has custom sidebar apps
// (most users have none).
import { icons as lucideIcons, type LucideIcon } from "lucide-react";

interface SidebarAppIconProps {
  name: string;
  className?: string;
}

export default function SidebarAppIcon({ name, className }: SidebarAppIconProps) {
  const Icon = lucideIcons[name as keyof typeof lucideIcons] as LucideIcon | undefined;
  if (!Icon) return null;
  return <Icon className={className} />;
}
