import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import DocsLayout from '@/components/layout/docs-layout';
import { Screenshot, TopicCard, Callout } from '@/components/docs/docs-primitives';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Zap, CreditCard, Utensils, User, Shield, FileText, Cookie, HelpCircle, Sparkles, ArrowRight, ChevronRight, Mail, BookOpen, PlayCircle, Compass } from 'lucide-react';

const WhatsAppIcon = ({ className = 'w-5 h-5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.465 3.488" />
  </svg>
);

const TOPICS = [
  {
    title: 'Getting Started',
    description: 'Set up your account, import your menu, take your first order.',
    color: 'from-orange-100 to-rose-100 text-orange-600',
    items: [
      { title: 'Quick start guide', to: '/docs/getting-started', icon: <Zap className="w-4 h-4" />, badge: 'Start here' },
    ],
  },
  {
    title: 'Restaurant Operations',
    description: 'Run service, manage your menu, take orders.',
    color: 'from-amber-100 to-orange-100 text-amber-700',
    items: [
      { title: 'POS overview', to: '/docs/pos-overview', icon: <CreditCard className="w-4 h-4" /> },
      { title: 'Menu management', to: '/docs/menu-management', icon: <Utensils className="w-4 h-4" /> },
      { title: 'WhatsApp setup', to: '/docs/whatsapp-setup', icon: <WhatsAppIcon className="w-4 h-4" /> },
    ],
  },
  {
    title: 'Account & Settings',
    description: 'Customise your profile, manage members and locations.',
    color: 'from-violet-100 to-indigo-100 text-violet-600',
    items: [
      { title: 'Custom avatar URLs', to: '/docs/custom-avatar-url', icon: <User className="w-4 h-4" /> },
    ],
  },
  {
    title: 'Legal',
    description: 'Privacy, terms, and how we handle data.',
    color: 'from-sky-100 to-blue-100 text-sky-600',
    items: [
      { title: 'Privacy Policy', to: '/docs/privacy', icon: <Shield className="w-4 h-4" /> },
      { title: 'Terms of Service', to: '/docs/terms', icon: <FileText className="w-4 h-4" /> },
      { title: 'Cookie Policy', to: '/docs/cookies', icon: <Cookie className="w-4 h-4" /> },
    ],
  },
];

const FEATURED = [
  {
    to: '/docs/getting-started',
    icon: <Zap className="w-5 h-5" />,
    title: 'Quick start',
    description: 'Sign up, connect WhatsApp, take your first order in 10 minutes.',
    badge: 'New',
  },
  {
    to: '/docs/whatsapp-setup',
    icon: <WhatsAppIcon className="w-5 h-5" />,
    title: 'WhatsApp setup',
    description: 'Connect your WhatsApp Business number and configure pickup notifications.',
  },
  {
    to: '/docs/pos-overview',
    icon: <CreditCard className="w-5 h-5" />,
    title: 'Use the POS',
    description: 'Take orders at the counter, manage the live queue, settle payments.',
  },
  {
    to: '/docs/menu-management',
    icon: <Utensils className="w-5 h-5" />,
    title: 'Build your menu',
    description: 'Add items, modifiers and categories — sync everywhere instantly.',
  },
];

const POPULAR = [
  { to: '/docs/whatsapp-setup', title: 'How customers receive pickup notifications', section: 'WhatsApp' },
  { to: '/docs/pos-overview', title: 'Refunds, voids and re-opening orders', section: 'POS' },
  { to: '/docs/menu-management', title: 'Setting up modifiers (e.g. extra cheese)', section: 'Menu' },
  { to: '/docs/getting-started', title: 'Inviting staff and assigning roles', section: 'Setup' },
  { to: '/docs/custom-avatar-url', title: 'Changing your profile photo with a URL', section: 'Account' },
  { to: '/docs/privacy', title: 'What data does BeepBite store?', section: 'Legal' },
];

const DocsIndex = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const filteredTopics = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return TOPICS;
    return TOPICS.map((t) => ({
      ...t,
      items: t.items.filter((it) => it.title.toLowerCase().includes(q)),
    })).filter((t) => t.items.length > 0 || t.title.toLowerCase().includes(q));
  }, [query]);

  return (
    <DocsLayout title="Documentation">
      {/* ====== Hero ====== */}
      <section className="relative overflow-hidden rounded-3xl border border-orange-100 bg-gradient-to-br from-orange-50 via-white to-amber-50 p-6 sm:p-10 lg:p-12 mb-12">
        <div className="absolute -top-16 -right-16 w-64 h-64 bg-orange-200/40 rounded-full blur-3xl" />
        <div className="absolute -bottom-16 -left-16 w-64 h-64 bg-rose-200/40 rounded-full blur-3xl" />

        <div className="relative max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-card/80 backdrop-blur border border-orange-200 px-3 py-1 text-xs font-semibold text-orange-700 mb-5">
            <Sparkles className="w-3.5 h-3.5" />
            BeepBite Documentation
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-foreground leading-[1.1]">
            Everything you need to run BeepBite
          </h1>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground max-w-2xl">
            Guides, walk-throughs and references for setting up your POS, connecting WhatsApp, managing your menu and
            more.
          </p>

          <div className="mt-7 relative max-w-xl">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search guides, e.g. 'menu' or 'WhatsApp'"
              className="pl-10 h-12 text-base bg-card border-border shadow-sm focus-visible:ring-orange-300"
            />
            <kbd className="hidden sm:inline-flex absolute right-3 top-1/2 -translate-y-1/2 items-center gap-1 text-[11px] font-mono text-muted-foreground bg-muted border border-border px-1.5 py-0.5 rounded">
              ⌘K
            </kbd>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className="text-muted-foreground">Popular:</span>
            {['WhatsApp setup', 'Menu', 'Refunds', 'Staff'].map((p) => (
              <Button
                key={p}
                variant="link"
                size="sm"
                onClick={() => setQuery(p.toLowerCase())}
                className="h-auto p-0 text-orange-600 hover:text-orange-700"
              >
                {p}
              </Button>
            ))}
          </div>
        </div>
      </section>

      {/* ====== Featured guides ====== */}
      {!query && (
        <section className="mb-14">
          <div className="flex items-end justify-between mb-5 sm:mb-6">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-orange-600 mb-1">Featured</div>
              <h2 className="text-xl sm:text-2xl font-bold text-foreground">Start here</h2>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {FEATURED.map((f) => (
              <TopicCard key={f.to} {...f} />
            ))}
          </div>
        </section>
      )}

      {/* ====== Topic categories ====== */}
      <section className="mb-14">
        <div className="flex items-end justify-between mb-5 sm:mb-6">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-orange-600 mb-1">Browse by topic</div>
            <h2 className="text-xl sm:text-2xl font-bold text-foreground">All guides</h2>
          </div>
          <span className="text-sm text-muted-foreground">
            {filteredTopics.reduce((sum, t) => sum + t.items.length, 0)} guides
          </span>
        </div>

        {filteredTopics.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center">
            <Compass className="w-6 h-6 mx-auto text-muted-foreground" />
            <div className="mt-2 text-sm font-semibold text-muted-foreground">No guides match "{query}"</div>
            <div className="mt-1 text-sm text-muted-foreground">Try a different search or browse the sidebar.</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {filteredTopics.map((t) => (
              <div
                key={t.title}
                className="group rounded-2xl border border-border bg-card p-5 sm:p-6 hover:border-orange-200 transition-colors"
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <h3 className="text-lg font-bold text-foreground">{t.title}</h3>
                    <p className="text-sm text-muted-foreground mt-0.5">{t.description}</p>
                  </div>
                  <div className={`shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br ${t.color} flex items-center justify-center`}>
                    <BookOpen className="w-5 h-5" />
                  </div>
                </div>
                <ul className="divide-y divide-border -mx-2">
                  {t.items.map((it) => (
                    <li key={it.to}>
                      <Link
                        to={it.to}
                        className="group/item flex items-center gap-3 px-2 py-2.5 rounded-md hover:bg-orange-50 transition-colors"
                      >
                        <span className="w-7 h-7 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center group-hover/item:bg-orange-100 transition-colors">
                          {it.icon}
                        </span>
                        <span className="flex-1 text-sm font-medium text-foreground group-hover/item:text-orange-700 transition-colors truncate">
                          {it.title}
                        </span>
                        {it.badge && (
                          <span className="text-[10px] font-bold uppercase tracking-wider bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">
                            {it.badge}
                          </span>
                        )}
                        <ChevronRight className="w-4 h-4 text-muted-foreground group-hover/item:text-orange-500 group-hover/item:translate-x-0.5 transition-all" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ====== Quick tour with screenshot ====== */}
      {!query && (
        <section className="mb-14">
          <div className="rounded-3xl border border-border bg-card p-5 sm:p-8 lg:p-10 grid lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-5">
              <div className="text-xs font-semibold uppercase tracking-wider text-orange-600 mb-1">Tour</div>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                A quick visual tour of BeepBite
              </h2>
              <p className="mt-3 text-muted-foreground leading-relaxed">
                Take a look at the dashboard, the order queue, the menu editor and how WhatsApp orders flow through your
                kitchen.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Button
                  onClick={() => navigate('/docs/getting-started')}
                  className="bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-600 hover:to-rose-600 text-white"
                >
                  Start the tour
                  <ArrowRight className="w-4 h-4 ml-1.5" />
                </Button>
                <Button
                  variant="outline"
                  onClick={() => navigate('/signup')}
                  className="border-border hover:border-orange-300 hover:text-orange-600"
                >
                  <PlayCircle className="w-4 h-4 mr-1.5" />
                  Try the live demo
                </Button>
              </div>
            </div>
            <div className="lg:col-span-7">
              <Screenshot
                variant="browser"
                url="app.beepbite.io/dashboard"
                alt="The main BeepBite dashboard with live revenue, channel mix and the active order queue."
                caption="Dashboard preview — drop the real screenshot in /public/docs/dashboard.png"
                ratio="16/10"
              />
            </div>
          </div>
        </section>
      )}

      {/* ====== Popular articles ====== */}
      {!query && (
        <section className="mb-14">
          <div className="flex items-end justify-between mb-5 sm:mb-6">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-orange-600 mb-1">Popular</div>
              <h2 className="text-xl sm:text-2xl font-bold text-foreground">Frequently read</h2>
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-card divide-y divide-border">
            {POPULAR.map((p) => (
              <Link
                key={p.title}
                to={p.to}
                className="group flex items-center gap-4 px-4 sm:px-5 py-3.5 hover:bg-orange-50/50 transition-colors first:rounded-t-2xl last:rounded-b-2xl"
              >
                <span className="w-9 h-9 rounded-lg bg-gradient-to-br from-orange-100 to-rose-100 text-orange-600 flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground group-hover:text-orange-700 transition-colors truncate">
                    {p.title}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{p.section}</div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-orange-500 group-hover:translate-x-0.5 transition-all" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ====== Troubleshooting / Help ====== */}
      <section id="troubleshooting" className="mb-12 scroll-mt-24">
        <div className="grid md:grid-cols-2 gap-5">
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center mb-3">
              <HelpCircle className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-bold text-foreground">Common issues</h3>
            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
              Quick answers to the things people ask most.
            </p>
            <ul className="mt-4 space-y-3 text-sm">
              {[
                {
                  q: 'WhatsApp notification not sending',
                  a: "Check the customer phone number includes a country code (a '+' followed by the dialling code) and that your WhatsApp Business number is verified.",
                },
                {
                  q: 'Card payment declined',
                  a: 'BeepBite records the tender, it does not process the card. Retry on your card machine, or settle the order as cash.',
                },
                {
                  q: 'Staff cannot access a feature',
                  a: 'Visit Settings → Team. Each role has explicit permissions you can toggle.',
                },
              ].map((item) => (
                <li key={item.q} className="rounded-lg bg-muted border border-border p-3">
                  <div className="font-semibold text-foreground text-sm">{item.q}</div>
                  <div className="text-muted-foreground mt-1">{item.a}</div>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-border bg-gradient-to-br from-orange-50 to-amber-50 p-6">
            <div className="w-10 h-10 rounded-xl bg-card text-orange-600 flex items-center justify-center mb-3 shadow-sm">
              <Mail className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-bold text-foreground">Talk to a human</h3>
            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
              Real people. Most replies in under five minutes during business hours.
            </p>
            <div className="mt-5 grid sm:grid-cols-2 gap-3">
              <a
                href="mailto:support@beepbite.io"
                className="rounded-xl bg-card border border-orange-200 p-3 hover:border-orange-300 hover:shadow-sm transition-all"
              >
                <div className="text-xs text-muted-foreground">Email</div>
                <div className="text-sm font-bold text-foreground">support@beepbite.io</div>
              </a>
              {/* Deliberately not a wa.me link. The support number this used to
                  hardcode was South African, and the obvious replacement — a
                  placeholder wa.me short link — is worse than none: it looks
                  clickable and 404s. Email is the one support channel that is
                  real and country-neutral, so this points at it until a
                  verified WhatsApp support number exists to link to. */}
              <a
                href="mailto:support@beepbite.io?subject=WhatsApp%20support"
                className="rounded-xl bg-card border border-emerald-200 p-3 hover:border-emerald-300 hover:shadow-sm transition-all"
              >
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <WhatsAppIcon className="w-3 h-3 text-emerald-500" />
                  WhatsApp
                </div>
                <div className="text-sm font-bold text-foreground">Ask us to set up WhatsApp</div>
              </a>
            </div>
            <div className="mt-4">
              <Callout tone="tip" title="Pro tip">
                Include a screenshot when you ask for help — it usually means we can fix it on the first reply.
              </Callout>
            </div>
          </div>
        </div>
      </section>

      {/* ====== Footer CTA ====== */}
      <section className="mb-4">
        <div className="rounded-3xl bg-gradient-to-br from-orange-500 via-rose-500 to-amber-500 text-white p-6 sm:p-10 relative overflow-hidden">
          <div className="absolute inset-0 [background-image:radial-gradient(rgba(255,255,255,0.18)_1px,transparent_1px)] [background-size:14px_14px] opacity-30" />
          <div className="relative grid md:grid-cols-3 gap-6 items-center">
            <div className="md:col-span-2">
              <h3 className="text-2xl sm:text-3xl font-black tracking-tight">Ready to try it yourself?</h3>
              <p className="mt-2 text-white/90">
                The fastest way to learn BeepBite is to use it. Start a free trial — no card required.
              </p>
            </div>
            <div className="md:text-right">
              <Button
                size="lg"
                onClick={() => navigate('/signup')}
                className="bg-card text-orange-600 hover:bg-orange-50 font-semibold px-7 py-6 rounded-2xl shadow-xl"
              >
                Start free trial
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            </div>
          </div>
        </div>
      </section>
    </DocsLayout>
  );
};

export default DocsIndex;
