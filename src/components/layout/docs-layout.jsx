import React, { useState, useMemo } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import { VisuallyHidden } from '@/components/ui/visually-hidden';
import {
  Book,
  FileText,
  Shield,
  Cookie,
  HelpCircle,
  Menu as MenuIcon,
  Zap,
  MessageSquare,
  ExternalLink,
  User,
  Search,
  Compass,
  Utensils,
  CreditCard,
  ChevronRight,
  Home,
  X,
  ArrowLeft,
} from 'lucide-react';

const WhatsAppIcon = ({ className = 'w-4 h-4' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.465 3.488" />
  </svg>
);

// ----- Single source of truth for the docs nav -----
// Order matters: it drives prev/next.
export const DOCS_NAV = [
  {
    title: 'Getting Started',
    items: [
      { title: 'Documentation home', href: '/docs', icon: Compass, summary: 'Overview and quick links' },
      { title: 'Quick start guide', href: '/docs/getting-started', icon: Zap, summary: 'From sign-up to first order' },
    ],
  },
  {
    title: 'Restaurant Operations',
    items: [
      { title: 'POS overview', href: '/docs/pos-overview', icon: CreditCard, summary: 'Use the point-of-sale interface' },
      { title: 'Menu management', href: '/docs/menu-management', icon: Utensils, summary: 'Add items, categories, modifiers' },
      { title: 'WhatsApp setup', href: '/docs/whatsapp-setup', icon: WhatsAppIcon, summary: 'Connect WhatsApp Business API' },
    ],
  },
  {
    title: 'Account & Settings',
    items: [
      { title: 'Custom avatar URLs', href: '/docs/custom-avatar-url', icon: User, summary: 'Use a custom profile image' },
    ],
  },
  {
    title: 'Legal',
    items: [
      { title: 'Privacy Policy', href: '/docs/privacy', icon: Shield, summary: 'How we handle your data' },
      { title: 'Terms of Service', href: '/docs/terms', icon: FileText, summary: 'Terms of using BeepBite' },
      { title: 'Cookie Policy', href: '/docs/cookies', icon: Cookie, summary: 'Cookies and tracking' },
    ],
  },
  {
    title: 'Support',
    items: [
      { title: 'Troubleshooting', href: '/docs#troubleshooting', icon: HelpCircle, summary: 'Common issues and fixes' },
      { title: 'Contact support', href: 'mailto:support@beepbite.io', icon: ExternalLink, external: true, summary: 'Email our team' },
    ],
  },
];

// Flatten nav, filtering out external + anchor links — used for prev/next.
const flatRoutes = DOCS_NAV.flatMap((section) =>
  section.items.filter((it) => !it.external && !it.href.includes('#')),
);

export const usePrevNext = (pathname) => {
  const idx = flatRoutes.findIndex((it) => it.href === pathname);
  if (idx === -1) return { prev: null, next: null };
  return {
    prev: idx > 0 ? flatRoutes[idx - 1] : null,
    next: idx < flatRoutes.length - 1 ? flatRoutes[idx + 1] : null,
  };
};

const Sidebar = ({ pathname, onItemClick = () => {} }) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return DOCS_NAV;
    return DOCS_NAV.map((section) => ({
      ...section,
      items: section.items.filter(
        (it) =>
          it.title.toLowerCase().includes(q) || (it.summary && it.summary.toLowerCase().includes(q)),
      ),
    })).filter((section) => section.items.length > 0);
  }, [query]);

  const handleClick = (item) => (e) => {
    if (item.external) return;
    if (item.href.includes('#')) {
      e.preventDefault();
      const [path, hash] = item.href.split('#');
      if (pathname !== path) {
        navigate(path);
        setTimeout(() => {
          const el = document.getElementById(hash);
          el?.scrollIntoView({ behavior: 'smooth' });
        }, 80);
      } else {
        const el = document.getElementById(hash);
        el?.scrollIntoView({ behavior: 'smooth' });
      }
    }
    onItemClick();
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="px-4 sm:px-5 pt-5 pb-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search docs..."
            className="pl-8 h-9 text-sm"
          />
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 sm:px-3 pb-6 space-y-5">
        {filtered.length === 0 && (
          <div className="px-3 py-6 text-sm text-muted-foreground text-center">No matches for "{query}".</div>
        )}
        {filtered.map((section) => (
          <div key={section.title}>
            <div className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {section.title}
            </div>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                const className = `group flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-primary font-semibold'
                    : 'text-foreground hover:bg-muted hover:text-foreground'
                }`;
                const inner = (
                  <>
                    <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}`} />
                    <span className="truncate">{item.title}</span>
                    {isActive && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />}
                  </>
                );
                if (item.external) {
                  return (
                    <li key={item.href}>
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={className}
                        onClick={onItemClick}
                      >
                        {inner}
                      </a>
                    </li>
                  );
                }
                return (
                  <li key={item.href}>
                    <Link to={item.href} onClick={handleClick(item)} className={className}>
                      {inner}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-4 bg-muted/60">
        <div className="text-xs text-muted-foreground mb-2">Need help?</div>
        <a
          href="mailto:support@beepbite.io"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:text-primary/80"
        >
          Contact support
          <ChevronRight className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
};

const Breadcrumbs = ({ title }) => (
  <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground mb-6 flex items-center gap-1.5 flex-wrap">
    <Link to="/" className="inline-flex items-center gap-1 hover:text-primary transition-colors">
      <Home className="w-3.5 h-3.5" />
      Home
    </Link>
    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />
    <Link to="/docs" className="hover:text-primary transition-colors">
      Docs
    </Link>
    {title && (
      <>
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />
        <span className="text-foreground font-medium truncate max-w-[200px] sm:max-w-none">{title}</span>
      </>
    )}
  </nav>
);

const DocsLayout = ({ children, title, description, hideSidebar = false }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  const isHome = location.pathname === '/docs';

  return (
    <div className="bg-background text-foreground">
      <div className="lg:flex">
        {/* ===== Sidebar (desktop) ===== */}
        {!hideSidebar && (
          <aside className="hidden lg:block w-72 xl:w-80 flex-shrink-0 border-r border-border bg-background sticky top-16 self-start h-[calc(100vh-4rem)]">
            <div className="h-full flex flex-col">
              <div className="px-5 pt-6 pb-4 border-b border-border flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-primary">BeepBite</div>
                  <div className="text-base font-bold text-foreground">Documentation</div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate('/')}
                  className="text-xs text-muted-foreground hover:text-foreground px-2"
                >
                  <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                  Site
                </Button>
              </div>
              <Sidebar pathname={location.pathname} />
            </div>
          </aside>
        )}

        {/* ===== Mobile top bar ===== */}
        <div className="lg:hidden sticky top-16 z-30 bg-background/90 backdrop-blur border-b border-border">
          <div className="flex items-center gap-3 px-4 py-2.5">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="px-2.5 h-9">
                  <MenuIcon className="w-4 h-4" />
                  <span className="text-xs ml-1.5">Docs menu</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-80 p-0">
                <VisuallyHidden>
                  <SheetTitle>Documentation navigation</SheetTitle>
                </VisuallyHidden>
                <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-primary">BeepBite</div>
                    <div className="text-base font-bold text-foreground">Documentation</div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setOpen(false)} className="px-2">
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                <Sidebar pathname={location.pathname} onItemClick={() => setOpen(false)} />
              </SheetContent>
            </Sheet>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-wider text-primary font-semibold leading-tight">
                {isHome ? 'Documentation' : 'Guide'}
              </div>
              <div className="text-sm font-bold text-foreground truncate">{title || 'Docs'}</div>
            </div>
          </div>
        </div>

        {/* ===== Main ===== */}
        <main className="flex-1 min-w-0">
          {/* Subtle decorative banner on docs home */}
          {isHome && (
            <div className="absolute inset-x-0 top-16 h-64 -z-10 bg-gradient-to-b from-primary/5 to-transparent" />
          )}

          <div className={`mx-auto px-4 sm:px-6 lg:px-10 py-8 sm:py-12 ${isHome ? 'max-w-6xl' : 'max-w-3xl xl:max-w-4xl'}`}>
            {!isHome && <Breadcrumbs title={title} />}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};

export default DocsLayout;
