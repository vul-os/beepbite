import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Logo from '@/components/ui/logo';
import ScrollToTop from '@/components/ui/scroll-to-top';
import { Reveal, Stagger, StaggerItem } from '@/components/ui/motion';
import DashboardPreview from '@/components/previews/dashboard-preview';
import MenuManagementPreview from '@/components/previews/menu-management-preview';
import WhatsAppPreview from '@/components/previews/whatsapp-preview';
import POSInterfacePreview from '@/components/previews/pos-interface-preview';
import { useTheme } from '@/components/theme-provider';
import {
  Clock,
  Star,
  CheckCircle,
  ArrowRight,
  BarChart3,
  Shield,
  Zap,
  MessageSquare,
  Utensils,
  Heart,
  Phone,
  Mail,
  CreditCard,
  Sparkles,
  Bell,
  Users,
  Smartphone,
  TrendingUp,
  Moon,
  Sun,
} from 'lucide-react';

const WhatsAppIcon = ({ className = 'w-5 h-5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.465 3.488" />
  </svg>
);

// ---------- Animated counter ----------
const AnimatedNumber = ({ value, prefix = '', suffix = '', duration = 1.6 }) => {
  const [display, setDisplay] = React.useState(0);
  const ref = React.useRef(null);
  const reduce = useReducedMotion();

  React.useEffect(() => {
    if (reduce) {
      setDisplay(value);
      return;
    }
    const node = ref.current;
    if (!node) return;
    let raf;
    let started = false;

    const start = () => {
      if (started) return;
      started = true;
      const startTime = performance.now();
      const tick = (t) => {
        const progress = Math.min((t - startTime) / (duration * 1000), 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        setDisplay(Math.round(value * eased * 100) / 100);
        if (progress < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };

    const observer = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && start()),
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [value, duration, reduce]);

  const formatted = Number.isInteger(value)
    ? Math.round(display).toLocaleString()
    : display.toLocaleString(undefined, { maximumFractionDigits: 1 });

  return (
    <span ref={ref}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
};

// ---------- Hero animated mock-up ----------
const HeroMock = () => {
  const reduce = useReducedMotion();
  const [step, setStep] = React.useState(0);

  React.useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setStep((s) => (s + 1) % 3), 3200);
    return () => clearInterval(id);
  }, [reduce]);

  const orderStates = [
    { label: 'New order', color: 'bg-amber-500', tone: 'amber' },
    { label: 'Cooking', color: 'bg-orange-500', tone: 'orange' },
    { label: 'Ready', color: 'bg-emerald-500', tone: 'emerald' },
  ];
  const current = orderStates[step];

  return (
    <div className="relative w-full max-w-md sm:max-w-lg mx-auto">
      {/* Glow — brighter in dark so it reads against dark bg */}
      <div className="absolute -inset-6 bg-gradient-to-tr from-orange-300/40 via-amber-200/30 to-rose-200/40 dark:from-orange-500/20 dark:via-amber-400/15 dark:to-rose-500/20 blur-3xl rounded-[40px] -z-10" />

      {/* Main POS card */}
      <motion.div
        initial={{ opacity: 0, y: 20, rotate: -1 }}
        animate={{ opacity: 1, y: 0, rotate: -1.5 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="relative bg-white dark:bg-gray-900 rounded-3xl border border-gray-200/70 dark:border-gray-700/70 shadow-elevated overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r from-white dark:from-gray-900 to-orange-50/60 dark:to-orange-900/20">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-400" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inset-0 rounded-full bg-emerald-400 animate-pulse-ring" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            Live · BeepBite POS
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Order ticket */}
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className={`rounded-2xl border p-4 ${
              current.tone === 'orange'
                ? 'border-orange-200 bg-orange-50 dark:border-orange-700/60 dark:bg-orange-950/40'
                : current.tone === 'emerald'
                ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-700/60 dark:bg-emerald-950/40'
                : 'border-amber-200 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-950/40'
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-semibold">Order</div>
                <div className="font-bold text-gray-900 dark:text-white text-lg">#2847</div>
              </div>
              <span className={`${current.color} text-white text-xs font-semibold px-2.5 py-1 rounded-full shadow-sm`}>
                {current.label}
              </span>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-orange-400 to-rose-500 text-white text-xs font-bold flex items-center justify-center shrink-0">
                MG
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900 dark:text-white truncate">Maria Gonzalez</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">2× Spicy Burger · 1× Fries</div>
              </div>
              <div className="ml-auto text-sm font-bold text-gray-900 dark:text-white">R180</div>
            </div>
          </motion.div>

          {/* Channel pill row */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { icon: <WhatsAppIcon className="w-3.5 h-3.5" />, label: 'WhatsApp', color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-700/60' },
              { icon: <Smartphone className="w-3.5 h-3.5" />, label: 'In-store', color: 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/50 border-orange-200 dark:border-orange-700/60' },
              { icon: <CreditCard className="w-3.5 h-3.5" />, label: 'Paid', color: 'text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/50 border-violet-200 dark:border-violet-700/60' },
            ].map((p) => (
              <div
                key={p.label}
                className={`flex items-center justify-center gap-1.5 text-[11px] font-medium border rounded-lg py-1.5 ${p.color}`}
              >
                {p.icon}
                {p.label}
              </div>
            ))}
          </div>

          {/* Mini metrics */}
          <div className="grid grid-cols-3 gap-2 pt-1">
            {[
              { k: 'Today', v: 'R12.4k', up: true },
              { k: 'Orders', v: '184', up: true },
              { k: 'Avg', v: 'R67', up: false },
            ].map((m) => (
              <div key={m.k} className="rounded-xl border border-gray-100 dark:border-gray-700/60 bg-white dark:bg-gray-800/60 p-2.5 shadow-card">
                <div className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold">{m.k}</div>
                <div className="flex items-end justify-between mt-0.5">
                  <div className="text-sm font-bold text-gray-900 dark:text-white">{m.v}</div>
                  <TrendingUp className={`w-3 h-3 ${m.up ? 'text-emerald-500' : 'text-gray-300 dark:text-gray-600 rotate-180'}`} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Floating WhatsApp notification — constrained to prevent overflow on ~375px */}
      <motion.div
        initial={{ opacity: 0, y: 30, x: 20 }}
        animate={{ opacity: 1, y: 0, x: 0 }}
        transition={{ duration: 0.8, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="absolute right-0 sm:-right-6 -bottom-6 sm:-bottom-10 w-44 sm:w-64 animate-float-slow"
      >
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-elevated border border-gray-100 dark:border-gray-700/70 p-3 sm:p-3.5 rotate-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shrink-0">
              <WhatsAppIcon className="w-3.5 h-3.5 text-white" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-gray-900 dark:text-white truncate">BeepBite</div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400 truncate">to Maria · just now</div>
            </div>
          </div>
          <div className="bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-100 dark:border-emerald-800/60 rounded-xl p-2.5 text-xs text-gray-700 dark:text-emerald-100 leading-snug">
            <div className="font-semibold text-emerald-700 dark:text-emerald-400 mb-0.5">Order #2847 is ready! 🍔</div>
            <span className="hidden sm:inline">Come to the counter — show this message for pickup.</span>
            <span className="sm:hidden">Come collect your order!</span>
          </div>
        </div>
      </motion.div>

      {/* Floating live-orders pill */}
      <motion.div
        initial={{ opacity: 0, y: -20, x: -20 }}
        animate={{ opacity: 1, y: 0, x: 0 }}
        transition={{ duration: 0.8, delay: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="absolute -left-3 sm:-left-8 -top-4 sm:-top-6 animate-float-medium"
      >
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-card-hover border border-gray-100 dark:border-gray-700/70 px-3.5 py-2.5 flex items-center gap-2.5 -rotate-3">
          <div className="relative">
            <Bell className="w-4 h-4 text-orange-500" />
            <span className="absolute -top-1 -right-1 w-1.5 h-1.5 bg-rose-500 rounded-full" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold">Live</div>
            <div className="text-xs font-bold text-gray-900 dark:text-white">12 active orders</div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

// ---------- Section eyebrow badge ----------
const Eyebrow = ({ children, className = '' }) => (
  <Badge
    className={`border-0 text-xs font-semibold uppercase tracking-wide px-3 py-1 mb-5 ${className}`}
  >
    {children}
  </Badge>
);

// ---------- Landing-page theme toggle ----------
const ThemeToggle = () => {
  const { theme, setTheme } = useTheme();
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <button
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/80 backdrop-blur text-gray-600 dark:text-gray-300 hover:text-orange-600 dark:hover:text-orange-400 hover:border-orange-300 dark:hover:border-orange-600 transition-all shadow-sm"
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
};

// ---------- Page ----------
const LandingPage = () => {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const heroRef = React.useRef(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] });
  const heroParallax = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : -60]);

  const scrollToSection = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  const features = [
    {
      icon: <WhatsAppIcon className="w-5 h-5" />,
      title: 'WhatsApp + POS',
      desc: 'Run a complete restaurant POS while customers order, pay and get notified directly on WhatsApp.',
      tone: 'emerald',
    },
    {
      icon: <Bell className="w-5 h-5" />,
      title: 'Digital Pagers',
      desc: 'Replace plastic buzzers with branded WhatsApp pickup notifications customers actually love.',
      tone: 'orange',
    },
    {
      icon: <Shield className="w-5 h-5" />,
      title: 'Inventory & Staff',
      desc: 'Real-time stock, staff permissions, shifts and reporting — every classic POS feature, built-in.',
      tone: 'violet',
    },
    {
      icon: <CreditCard className="w-5 h-5" />,
      title: 'Unified Payments',
      desc: 'Card, cash and contactless at the counter — plus pay-by-WhatsApp links for remote orders.',
      tone: 'sky',
    },
    {
      icon: <BarChart3 className="w-5 h-5" />,
      title: 'Live Analytics',
      desc: 'See revenue, channel mix and top items live. Compare in-store vs WhatsApp at a glance.',
      tone: 'rose',
    },
    {
      icon: <Zap className="w-5 h-5" />,
      title: 'Instant Setup',
      desc: 'Import your menu, scan a QR, hand out the WhatsApp number. You can serve today.',
      tone: 'amber',
    },
  ];

  const toneStyles = {
    emerald: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-100 dark:ring-emerald-800/60',
    orange: 'bg-orange-50 dark:bg-orange-950/50 text-orange-600 dark:text-orange-400 ring-1 ring-orange-100 dark:ring-orange-800/60',
    violet: 'bg-violet-50 dark:bg-violet-950/50 text-violet-600 dark:text-violet-400 ring-1 ring-violet-100 dark:ring-violet-800/60',
    sky: 'bg-sky-50 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400 ring-1 ring-sky-100 dark:ring-sky-800/60',
    rose: 'bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 ring-1 ring-rose-100 dark:ring-rose-800/60',
    amber: 'bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 ring-1 ring-amber-100 dark:ring-amber-800/60',
  };

  const toneBorder = {
    emerald: 'group-hover:border-emerald-200',
    orange: 'group-hover:border-orange-200',
    violet: 'group-hover:border-violet-200',
    sky: 'group-hover:border-sky-200',
    rose: 'group-hover:border-rose-200',
    amber: 'group-hover:border-amber-200',
  };

  const stats = [
    { value: 30, suffix: 's', label: 'Avg pickup notify time', icon: <Clock className="w-5 h-5" /> },
    { value: 99.9, suffix: '%', label: 'Uptime guarantee', icon: <Shield className="w-5 h-5" /> },
    { value: 2, suffix: ' min', label: 'Menu import', icon: <Utensils className="w-5 h-5" /> },
    { value: 24, suffix: '/7', label: 'WhatsApp support', icon: <MessageSquare className="w-5 h-5" /> },
  ];

  const steps = [
    {
      n: '01',
      title: 'Import your menu',
      desc: 'Snap a photo or upload a PDF — our AI builds your menu in minutes.',
      icon: <Utensils className="w-5 h-5" />,
    },
    {
      n: '02',
      title: 'Connect WhatsApp',
      desc: 'Link your business number. Customers order and pay without an app.',
      icon: <WhatsAppIcon className="w-5 h-5" />,
    },
    {
      n: '03',
      title: 'Serve & notify',
      desc: 'Take orders at the counter or via WhatsApp. Tap "ready" — pagers gone.',
      icon: <Bell className="w-5 h-5" />,
    },
  ];

  const benefits = [
    { icon: <Zap className="w-5 h-5" />, title: 'Full POS', desc: 'Everything you expect — orders, inventory, staff, reports.' },
    { icon: <Heart className="w-5 h-5" />, title: 'Digital Pagers', desc: 'WhatsApp pickup notifications instead of buzzers.' },
    { icon: <MessageSquare className="w-5 h-5" />, title: 'Two channels', desc: 'In-store + WhatsApp orders in one queue.' },
    { icon: <Users className="w-5 h-5" />, title: 'Loyalty built-in', desc: 'Members and reviews directly on WhatsApp.' },
  ];

  const showcase = [
    {
      tag: 'Analytics',
      title: 'Real-time dashboard',
      desc: 'Track revenue, channel performance and best-selling items as orders come in.',
      bullets: ['Live order tracking', 'POS vs WhatsApp split', 'Top items & low stock'],
      Component: DashboardPreview,
      flip: false,
      color: 'orange',
      icon: <BarChart3 className="w-5 h-5" />,
    },
    {
      tag: 'Menu',
      title: 'Smart menu management',
      desc: 'One menu, every channel. Edit once and the change syncs to POS, WhatsApp and printed QRs.',
      bullets: ['Real-time inventory', 'Cross-channel sync', 'Low-stock alerts'],
      Component: MenuManagementPreview,
      flip: true,
      color: 'amber',
      icon: <Star className="w-5 h-5" />,
    },
    {
      tag: 'Point of Sale',
      title: 'Counter-fast POS',
      desc: 'A tactile, touch-first POS that handles walk-ins and remote orders from one queue.',
      bullets: ['Unified order queue', 'Quick item search', 'Live status updates'],
      Component: POSInterfacePreview,
      flip: false,
      color: 'rose',
      icon: <Utensils className="w-5 h-5" />,
    },
    {
      tag: 'WhatsApp',
      title: 'Digital pickup pagers',
      desc: 'Branded WhatsApp messages replace plastic buzzers — customers leave delighted.',
      bullets: ['Pay-by-WhatsApp links', 'Auto pickup notifications', 'On-brand messaging'],
      Component: WhatsAppPreview,
      flip: true,
      color: 'emerald',
      icon: <MessageSquare className="w-5 h-5" />,
    },
  ];

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 overflow-x-hidden text-gray-900 dark:text-gray-50 antialiased">

      {/* ============================================================
          LANDING NAV — logo + theme toggle (landing-only, not shared top-bar)
      ============================================================ */}
      <header className="fixed top-0 inset-x-0 z-50 h-16 flex items-center">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full flex items-center justify-between">
          {/* Logo */}
          <button
            onClick={() => scrollToSection('home')}
            className="flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md"
            aria-label="Back to top"
          >
            <Logo variant="minimal" />
          </button>

          {/* Right-side nav actions */}
          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate('/signin')}
              className="hidden sm:inline-flex border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/80 backdrop-blur text-gray-700 dark:text-gray-300 hover:border-orange-300 dark:hover:border-orange-600 hover:text-orange-600 dark:hover:text-orange-400"
            >
              Sign in
            </Button>
            <Button
              size="sm"
              onClick={() => navigate('/signup')}
              className="bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-600 hover:to-rose-600 text-white shadow-sm"
            >
              Get started
            </Button>
          </div>
        </div>
        {/* Glassmorphic backdrop — appears once user scrolls */}
        <div className="absolute inset-0 -z-10 bg-white/80 dark:bg-gray-950/80 backdrop-blur border-b border-gray-200/60 dark:border-gray-800/60" />
      </header>

      {/* ============================================================
          HERO
      ============================================================ */}
      <section ref={heroRef} id="home" className="relative pt-24 sm:pt-32 lg:pt-40 pb-24 sm:pb-32 lg:pb-44">
        {/* Background layers */}
        <div className="absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-orange-50/80 via-white to-white dark:from-gray-900/80 dark:via-gray-950 dark:to-gray-950" />
          <div className="absolute inset-0 bg-grid-orange opacity-50 dark:opacity-30 [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_70%)]" />
          <div className="absolute -top-32 -left-32 w-[420px] h-[420px] bg-orange-300/40 dark:bg-orange-600/15 rounded-full blur-3xl animate-blob" />
          <div className="absolute top-20 -right-32 w-[460px] h-[460px] bg-rose-300/40 dark:bg-rose-600/15 rounded-full blur-3xl animate-blob animation-delay-2000" />
          <div className="absolute top-[55%] left-1/3 w-[360px] h-[360px] bg-amber-200/40 dark:bg-amber-600/10 rounded-full blur-3xl animate-blob animation-delay-4000" />
        </div>

        <motion.div style={{ y: heroParallax }} className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">

            {/* ---- Text column ---- */}
            <div className="lg:col-span-6 space-y-8 text-center lg:text-left">

              {/* Eyebrow pill */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
                className="inline-flex items-center gap-2 rounded-full bg-white/80 dark:bg-gray-900/80 backdrop-blur border border-orange-200 dark:border-orange-700/60 px-4 py-1.5 text-xs sm:text-sm font-medium text-orange-700 dark:text-orange-400 shadow-sm"
              >
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                Built for restaurants that ship orders fast
              </motion.div>

              {/* H1 — Fraunces globally via CSS; italic accent on "WhatsApp" */}
              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.75, delay: 0.05 }}
                className="text-4xl sm:text-5xl lg:text-6xl xl:text-[4.25rem] text-balance"
              >
                The restaurant POS that{' '}
                <span className="relative inline-block">
                  <span className="font-display-italic bg-clip-text text-transparent bg-gradient-to-r from-orange-500 via-rose-500 to-amber-500 animate-gradient-shift">
                    lives on WhatsApp
                  </span>
                  <svg
                    className="absolute -bottom-1 left-0 w-full h-2 text-orange-300"
                    viewBox="0 0 200 8"
                    preserveAspectRatio="none"
                    aria-hidden
                  >
                    <path d="M2 6 Q50 1 100 4 T198 5" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
                  </svg>
                </span>
              </motion.h1>

              {/* Lead paragraph */}
              <motion.p
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.15 }}
                className="text-lg sm:text-xl text-gray-600 dark:text-gray-300 max-w-xl mx-auto lg:mx-0 leading-relaxed text-pretty"
              >
                A complete point-of-sale built for the way people actually order today — at the counter, and on the
                phone they're already holding. No app downloads. No plastic pagers.
              </motion.p>

              {/* CTA row */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.25 }}
                className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center lg:justify-start"
              >
                <Button
                  size="lg"
                  onClick={() => navigate('/signup')}
                  className="group relative bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-600 hover:to-rose-600 text-white px-7 py-6 text-base rounded-2xl shadow-glow hover:shadow-xl hover:shadow-orange-500/40 transition-all hover:-translate-y-0.5"
                >
                  Start free trial
                  <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => scrollToSection('product-previews')}
                  className="border-2 border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/70 backdrop-blur text-gray-800 dark:text-gray-200 hover:border-orange-300 dark:hover:border-orange-600 hover:text-orange-600 dark:hover:text-orange-400 px-7 py-6 text-base rounded-2xl transition-all"
                >
                  See it in action
                </Button>
              </motion.div>

              {/* Trust signals */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.8, delay: 0.4 }}
                className="flex flex-wrap items-center gap-x-5 gap-y-2 justify-center lg:justify-start text-sm text-gray-500 dark:text-gray-400"
              >
                {['No card required', 'Cancel anytime', 'Free menu import'].map((t) => (
                  <div key={t} className="flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
                    {t}
                  </div>
                ))}
              </motion.div>
            </div>

            {/* ---- Visual column ---- */}
            <div className="lg:col-span-6 relative">
              <HeroMock />
            </div>
          </div>
        </motion.div>
      </section>

      {/* ============================================================
          STATS / TRUST BAR
      ============================================================ */}
      <section className="relative py-14 sm:py-20 bg-white dark:bg-gray-950 border-y border-border/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Stagger className="grid grid-cols-2 md:grid-cols-4 gap-8 sm:gap-12">
            {stats.map((s) => (
              <StaggerItem key={s.label}>
                <div className="flex flex-col items-center sm:items-start gap-3 text-center sm:text-left">
                  <div className="inline-flex items-center justify-center w-11 h-11 rounded-2xl bg-primary/10 text-primary">
                    {s.icon}
                  </div>
                  <div>
                    <div className="text-3xl sm:text-4xl font-display font-semibold tracking-tight text-gray-900 dark:text-white">
                      <AnimatedNumber value={s.value} suffix={s.suffix} />
                    </div>
                    <div className="text-sm text-muted-foreground mt-0.5">{s.label}</div>
                  </div>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* ============================================================
          FEATURES — bento-style grid
      ============================================================ */}
      <section id="features" className="relative py-20 sm:py-28 bg-gradient-to-b from-white via-orange-50/30 to-white dark:from-gray-950 dark:via-gray-900/60 dark:to-gray-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="text-center max-w-2xl mx-auto mb-14 sm:mb-16">
              <Eyebrow className="bg-orange-100 text-orange-700">Features</Eyebrow>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl text-balance">
                Everything you need to run service —{' '}
                <span className="font-display-italic bg-clip-text text-transparent bg-gradient-to-r from-orange-500 to-rose-500">
                  without juggling apps.
                </span>
              </h2>
              <p className="mt-5 text-lg text-muted-foreground text-pretty leading-relaxed">
                A modern POS, an order channel, a notification system and an analytics dashboard. One product, one bill.
              </p>
            </div>
          </Reveal>

          {/* Bento grid — first and last cards span 2 cols on md+ */}
          <Stagger className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {features.map((f) => (
              <StaggerItem key={f.title}>
                <div
                  className={`group relative h-full rounded-2xl bg-white dark:bg-gray-900 border border-border/60 p-6 sm:p-7 shadow-card card-interactive overflow-hidden ${toneBorder[f.tone]}`}
                >
                  {/* Subtle hover bloom */}
                  <div className="absolute -top-14 -right-14 w-36 h-36 bg-orange-100 rounded-full blur-2xl opacity-0 group-hover:opacity-60 transition-opacity duration-300 pointer-events-none" />

                  <div
                    className={`relative inline-flex items-center justify-center w-11 h-11 rounded-xl ${toneStyles[f.tone]} mb-5`}
                  >
                    {f.icon}
                  </div>
                  <h3 className="relative text-lg font-semibold text-gray-900 dark:text-white mb-2">{f.title}</h3>
                  <p className="relative text-sm sm:text-base text-muted-foreground leading-relaxed">{f.desc}</p>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* ============================================================
          PRODUCT PREVIEWS
      ============================================================ */}
      <section id="product-previews" className="relative py-20 sm:py-28 bg-white dark:bg-gray-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="text-center max-w-2xl mx-auto mb-16 sm:mb-20">
              <Eyebrow className="bg-rose-100 text-rose-700">Product</Eyebrow>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl text-balance">
                See{' '}
                <span className="font-display-italic text-primary">BeepBite</span>{' '}
                in action
              </h2>
              <p className="mt-5 text-lg text-muted-foreground text-pretty leading-relaxed">
                Interactive previews of every surface — analytics, menu, POS and WhatsApp.
              </p>
            </div>
          </Reveal>

          <div className="space-y-24 sm:space-y-32">
            {showcase.map(({ Component, ...s }) => (
              <Reveal key={s.title} delay={0.05}>
                <div className="grid lg:grid-cols-12 gap-10 lg:gap-16 items-center">

                  {/* Text side */}
                  <div className={`lg:col-span-5 space-y-6 ${s.flip ? 'lg:order-2' : ''}`}>
                    <div className="inline-flex items-center gap-2.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${toneStyles[s.color] ?? toneStyles.orange}`}>
                        {s.icon}
                      </span>
                      {s.tag}
                    </div>
                    <h3 className="text-2xl sm:text-3xl lg:text-4xl text-balance">{s.title}</h3>
                    <p className="text-base sm:text-lg text-muted-foreground leading-relaxed text-pretty">{s.desc}</p>
                    <ul className="space-y-3">
                      {s.bullets.map((b) => (
                        <li key={b} className="flex items-start gap-3 text-gray-700 dark:text-gray-300">
                          <CheckCircle className="w-5 h-5 text-emerald-500 mt-0.5 shrink-0" />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Preview side */}
                  <div className={`lg:col-span-7 ${s.flip ? 'lg:order-1' : ''}`}>
                    <div className="relative">
                      <div className="absolute -inset-4 sm:-inset-6 bg-gradient-to-tr from-orange-200/50 via-rose-200/40 to-amber-200/40 rounded-[40px] blur-2xl -z-10" />
                      <div className="relative rounded-3xl bg-white dark:bg-gray-900 border border-border/60 shadow-elevated overflow-hidden">
                        <div className="overflow-hidden">
                          <div className="origin-top-left scale-[0.78] sm:scale-[0.85] md:scale-90 lg:scale-100 transition-transform">
                            <Component className="w-full" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>

          {/* Mid-section CTA */}
          <Reveal delay={0.1}>
            <div className="text-center mt-20 pt-12 border-t border-border/50 dark:border-gray-800">
              <h3 className="text-2xl sm:text-3xl text-balance">Ready to try BeepBite?</h3>
              <p className="text-muted-foreground mt-3 max-w-md mx-auto text-pretty">No credit card. Set up in minutes.</p>
              <Button
                size="lg"
                onClick={() => navigate('/signup')}
                className="mt-7 bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-600 hover:to-rose-600 text-white px-8 py-6 rounded-2xl shadow-glow hover:shadow-xl transition-all hover:-translate-y-0.5"
              >
                Start free trial <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ============================================================
          BENEFITS
      ============================================================ */}
      <section id="benefits" className="relative py-20 sm:py-28 bg-gradient-to-b from-white to-orange-50/40 dark:from-gray-950 dark:to-gray-900/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="text-center max-w-2xl mx-auto mb-14 sm:mb-16">
              <Eyebrow className="bg-emerald-100 text-emerald-700">Why BeepBite</Eyebrow>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl text-balance">
                A POS that pays for itself
              </h2>
              <p className="mt-5 text-lg text-muted-foreground text-pretty leading-relaxed">
                Stop paying for a POS, an ordering app, a payments link and a pager system separately.
              </p>
            </div>
          </Reveal>

          <Stagger className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
            {benefits.map((b) => (
              <StaggerItem key={b.title}>
                <div className="h-full rounded-2xl bg-white dark:bg-gray-900 border border-border/60 p-6 sm:p-7 text-center shadow-card card-interactive hover:border-orange-200 dark:hover:border-orange-700">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-100 to-rose-100 text-orange-600 mb-5">
                    {b.icon}
                  </div>
                  <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">{b.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{b.desc}</p>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* ============================================================
          HOW IT WORKS
      ============================================================ */}
      <section id="how-it-works" className="relative py-20 sm:py-28 bg-white dark:bg-gray-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="text-center max-w-2xl mx-auto mb-14 sm:mb-16">
              <Eyebrow className="bg-violet-100 text-violet-700">How it works</Eyebrow>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl text-balance">
                From sign-up to first order in{' '}
                <span className="font-display-italic text-primary">10 minutes</span>
              </h2>
            </div>
          </Reveal>

          <div className="relative">
            {/* Connector line — decorative */}
            <div className="hidden md:block absolute top-12 left-[calc(16.7%+28px)] right-[calc(16.7%+28px)] h-px bg-gradient-to-r from-orange-200 via-rose-200 to-amber-200 z-0" />

            <Stagger className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
              {steps.map((s) => (
                <StaggerItem key={s.n}>
                  <div className="relative h-full rounded-2xl bg-white dark:bg-gray-900 border border-border/60 p-7 sm:p-8 text-center shadow-card card-interactive hover:border-orange-200 dark:hover:border-orange-700">
                    {/* Icon + step badge */}
                    <div className="relative inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-500 to-rose-500 text-white shadow-glow">
                      {s.icon}
                      <span className="absolute -top-2 -right-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-[10px] font-bold rounded-full px-2 py-0.5 shadow-sm">
                        {s.n}
                      </span>
                    </div>
                    <h3 className="mt-6 text-lg sm:text-xl">{s.title}</h3>
                    <p className="mt-2.5 text-sm sm:text-base text-muted-foreground leading-relaxed">{s.desc}</p>
                  </div>
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        </div>
      </section>

      {/* ============================================================
          TESTIMONIAL / SOCIAL PROOF
      ============================================================ */}
      <section className="relative py-20 sm:py-24 bg-gradient-to-r from-orange-50 via-rose-50 to-amber-50 dark:from-gray-900 dark:via-gray-900/80 dark:to-gray-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="relative rounded-3xl bg-white dark:bg-gray-900 shadow-elevated border border-border/50 p-8 sm:p-12 overflow-hidden">
              {/* Decorative glows */}
              <div className="absolute -top-20 -right-20 w-56 h-56 bg-orange-100 dark:bg-orange-900/20 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute -bottom-20 -left-20 w-56 h-56 bg-rose-100 dark:bg-rose-900/20 rounded-full blur-3xl pointer-events-none" />

              <div className="relative grid sm:grid-cols-5 gap-8 sm:gap-12 items-center">
                <div className="sm:col-span-1 flex sm:justify-center">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-500 to-rose-500 text-white flex items-center justify-center text-3xl font-display shadow-glow select-none">
                    "
                  </div>
                </div>
                <div className="sm:col-span-4">
                  <div className="flex gap-1 mb-4">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />
                    ))}
                  </div>
                  <p className="text-lg sm:text-xl text-gray-800 dark:text-gray-100 leading-relaxed text-pretty">
                    Customers love getting a WhatsApp instead of a buzzer — they wander, they come back, they tip more.
                    Our prep-to-pickup time dropped by half in the first week.
                  </p>
                  <div className="mt-5 text-sm font-semibold text-gray-900 dark:text-white">
                    Sandile M. <span className="font-normal text-muted-foreground">· Owner, Bay Burgers</span>
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ============================================================
          SUPPORT
      ============================================================ */}
      <section id="support" className="relative py-20 sm:py-28 bg-gray-950 text-white overflow-hidden">
        <div className="absolute inset-0 bg-noise opacity-40 pointer-events-none" />
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-orange-500/20 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="text-center max-w-2xl mx-auto mb-14 sm:mb-16">
              <Eyebrow className="bg-white/10 text-white/80">Support</Eyebrow>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl text-balance text-white">
                We're here when you need us
              </h2>
              <p className="mt-5 text-lg text-gray-400 text-pretty leading-relaxed">
                Real humans, fast replies. Most questions answered in under five minutes.
              </p>
            </div>
          </Reveal>

          <Stagger className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
            {[
              {
                icon: <WhatsAppIcon className="w-5 h-5" />,
                title: 'WhatsApp',
                desc: 'Quick chat with our team',
                cta: 'Message us',
                href: 'https://wa.me/27118765432',
                accent: 'from-emerald-500 to-emerald-600',
                ext: true,
              },
              {
                icon: <Mail className="w-5 h-5" />,
                title: 'Email',
                desc: 'Detailed help & onboarding',
                cta: 'Email us',
                href: 'mailto:support@beepbite.io',
                accent: 'from-orange-500 to-rose-500',
                ext: false,
              },
              {
                icon: <Phone className="w-5 h-5" />,
                title: 'Phone',
                desc: 'Speak to a human',
                cta: 'Call us',
                href: 'tel:+27118765432',
                accent: 'from-amber-500 to-orange-500',
                ext: false,
              },
              {
                icon: <MessageSquare className="w-5 h-5" />,
                title: 'Docs',
                desc: 'Self-serve guides',
                cta: 'Read docs',
                href: '/docs',
                accent: 'from-violet-500 to-indigo-500',
                ext: false,
              },
            ].map((c) => (
              <StaggerItem key={c.title}>
                <a
                  href={c.href}
                  target={c.ext ? '_blank' : undefined}
                  rel={c.ext ? 'noopener noreferrer' : undefined}
                  className="group relative block h-full rounded-2xl bg-white/5 border border-white/10 p-6 sm:p-7 hover:bg-white/10 hover:border-white/20 card-interactive overflow-hidden"
                >
                  <div className={`absolute inset-x-0 -top-px h-px bg-gradient-to-r ${c.accent} opacity-0 group-hover:opacity-100 transition-opacity`} />
                  <div className={`inline-flex items-center justify-center w-11 h-11 rounded-2xl bg-gradient-to-br ${c.accent} text-white mb-5 shadow-sm`}>
                    {c.icon}
                  </div>
                  <h3 className="text-base font-semibold text-white">{c.title}</h3>
                  <p className="text-sm text-gray-400 mt-1.5 leading-relaxed">{c.desc}</p>
                  <div className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-orange-300 group-hover:text-orange-200">
                    {c.cta}
                    <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </a>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* ============================================================
          CTA — final
      ============================================================ */}
      <section id="get-started" className="relative py-24 sm:py-32 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-orange-500 via-rose-500 to-amber-500 animate-gradient-shift" />
        <div className="absolute inset-0 bg-noise opacity-30 pointer-events-none" />
        <div className="absolute -top-32 left-10 w-96 h-96 bg-white/20 rounded-full blur-3xl animate-blob" />
        <div className="absolute -bottom-32 right-10 w-96 h-96 bg-amber-200/30 rounded-full blur-3xl animate-blob animation-delay-2000" />

        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <Reveal>
            <h2 className="text-4xl sm:text-5xl lg:text-6xl text-white text-balance">
              Upgrade your POS{' '}
              <span className="font-display-italic">today.</span>
            </h2>
            <p className="mt-6 text-lg sm:text-xl text-white/85 max-w-xl mx-auto text-pretty leading-relaxed">
              Modern point of sale, WhatsApp ordering and digital pagers — all in one. Free to start.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                size="lg"
                onClick={() => navigate('/signup')}
                className="bg-white text-orange-600 hover:bg-orange-50 px-8 py-6 text-base font-semibold rounded-2xl shadow-2xl shadow-black/10 hover:-translate-y-0.5 transition-all"
              >
                Start free trial
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => navigate('/signin')}
                className="border-2 border-white/40 bg-white/10 backdrop-blur text-white hover:bg-white hover:text-orange-600 px-8 py-6 text-base font-semibold rounded-2xl transition-all"
              >
                Sign in
              </Button>
            </div>
            <p className="mt-7 text-sm text-white/75">No credit card · Cancel anytime · Setup in minutes</p>
          </Reveal>
        </div>
      </section>

      {/* ============================================================
          FOOTER
      ============================================================ */}
      <footer className="bg-white dark:bg-gray-950 border-t border-border/60 py-14 sm:py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 sm:gap-10">
            <div className="col-span-2 md:col-span-1">
              <Logo variant="minimal" className="mb-4" />
              <p className="text-sm text-muted-foreground leading-relaxed">
                Complete restaurant POS with{' '}
                <span className="text-primary font-medium">WhatsApp ordering, payments and digital pagers.</span>
              </p>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 tracking-wide">Product</h4>
              <ul className="space-y-3 text-sm text-muted-foreground">
                <li>
                  <button onClick={() => scrollToSection('features')} className="hover:text-primary transition-colors">
                    Features
                  </button>
                </li>
                <li>
                  <button onClick={() => scrollToSection('product-previews')} className="hover:text-primary transition-colors">
                    Previews
                  </button>
                </li>
                <li>
                  <button onClick={() => scrollToSection('how-it-works')} className="hover:text-primary transition-colors">
                    How it works
                  </button>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 tracking-wide">Company</h4>
              <ul className="space-y-3 text-sm text-muted-foreground">
                <li>
                  <button onClick={() => scrollToSection('home')} className="hover:text-primary transition-colors">
                    Home
                  </button>
                </li>
                <li>
                  <button onClick={() => scrollToSection('benefits')} className="hover:text-primary transition-colors">
                    Benefits
                  </button>
                </li>
                <li>
                  <button onClick={() => scrollToSection('support')} className="hover:text-primary transition-colors">
                    Support
                  </button>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 tracking-wide">Legal</h4>
              <ul className="space-y-3 text-sm text-muted-foreground">
                <li>
                  <a href="/docs/privacy" className="hover:text-primary transition-colors">
                    Privacy Policy
                  </a>
                </li>
                <li>
                  <a href="/docs/terms" className="hover:text-primary transition-colors">
                    Terms of Service
                  </a>
                </li>
                <li>
                  <a href="/docs" className="hover:text-primary transition-colors">
                    Documentation
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="border-t border-border/50 mt-12 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-xs sm:text-sm text-muted-foreground text-center md:text-left">
              &copy; {new Date().getFullYear()} BeepBite Pty, a member of Exolution Technologies Pty
            </p>
            <button
              onClick={() => scrollToSection('home')}
              className="text-xs sm:text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              Back to top ↑
            </button>
          </div>
        </div>
      </footer>

      <ScrollToTop />
    </div>
  );
};

export default LandingPage;
