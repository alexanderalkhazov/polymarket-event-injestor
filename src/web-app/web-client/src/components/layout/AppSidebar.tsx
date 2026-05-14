import { NavLink, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Globe,
  LayoutDashboard,
  LineChart,
  LogOut,
  MessageSquare,
  Newspaper,
  Settings,
  Zap,
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    label: '',
    items: [
      { href: '/dashboard', label: 'Overview',       icon: LayoutDashboard },
      { href: '/stocks',    label: 'Subscriptions',  icon: BookOpen },
    ],
  },
  {
    label: 'Browse',
    items: [
      { href: '/polymarket',  label: 'Polymarket',       icon: BarChart3  },
      { href: '/news',        label: 'News Topics',      icon: Newspaper  },
    ],
  },
  {
    label: 'Tools',
    items: [
      { href: '/markets',  label: 'Live Markets', icon: Globe          },
      { href: '/trading',  label: 'Trading',      icon: LineChart      },
      { href: '/chat',     label: 'AI Chat',      icon: MessageSquare  },
    ],
  },
];

const BOTTOM_NAV_ITEMS: NavItem[] = [
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function AppSidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <aside
      className={cn(
        'relative flex h-screen flex-col border-r transition-all duration-200 ease-in-out',
        'bg-[hsl(var(--sidebar))] border-[hsl(var(--sidebar-border))]',
        collapsed ? 'w-[60px]' : 'w-[220px]'
      )}
    >
      {/* Logo */}
      <div className={cn('flex h-14 items-center border-b border-[hsl(var(--sidebar-border))] px-3', collapsed && 'justify-center')}>
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary">
            <Zap className="h-4 w-4 text-primary-foreground" />
          </div>
          {!collapsed && (
            <span className="truncate text-sm font-semibold text-foreground">PolyTrader</span>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-0 overflow-y-auto p-2">
        {NAV_SECTIONS.map((section, si) => (
          <div key={si} className={si > 0 ? 'mt-2' : ''}>
            {section.label && !collapsed && (
              <p className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                {section.label}
              </p>
            )}
            {section.label && collapsed && si > 0 && (
              <div className="my-2 border-t border-[hsl(var(--sidebar-border))]" />
            )}
            <div className="flex flex-col gap-0.5">
              {section.items.map(({ href, label, icon: Icon }) => (
                <NavLink
                  key={href}
                  to={href}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors',
                      'text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--sidebar-accent))] hover:text-foreground',
                      isActive && 'bg-[hsl(var(--sidebar-accent))] text-foreground font-medium',
                      collapsed && 'justify-center px-2'
                    )
                  }
                  title={collapsed ? label : undefined}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span className="truncate">{label}</span>}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom section */}
      <div className="border-t border-[hsl(var(--sidebar-border))] p-2">
        {BOTTOM_NAV_ITEMS.map(({ href, label, icon: Icon }) => (
          <NavLink
            key={href}
            to={href}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors',
                'text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--sidebar-accent))] hover:text-foreground',
                isActive && 'bg-[hsl(var(--sidebar-accent))] text-foreground font-medium',
                collapsed && 'justify-center px-2'
              )
            }
            title={collapsed ? label : undefined}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
          </NavLink>
        ))}

        {/* User row */}
        <div className={cn('mt-1 flex items-center gap-2 rounded-md px-2.5 py-2', collapsed && 'justify-center px-2')}>
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase text-muted-foreground">
            {user?.name?.[0] ?? '?'}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-foreground">{user?.name}</p>
              <p className="truncate text-[10px] text-muted-foreground">{user?.email}</p>
            </div>
          )}
          {!collapsed && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={handleLogout}
              title="Log out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className={cn(
          'absolute -right-3 top-[52px] z-10 flex h-6 w-6 items-center justify-center',
          'rounded-full border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar))]',
          'text-muted-foreground shadow-sm transition-colors hover:text-foreground'
        )}
      >
        {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
      </button>
    </aside>
  );
}
