/**
 * AuthLayout — shared two-panel shell for all auth pages.
 *
 * Desktop (lg+): left = form card, right = branded panel.
 * Mobile: full-screen form, branded panel hidden.
 *
 * Usage:
 *   <AuthLayout heading="Welcome back" sub="Sign in to manage your restaurant">
 *     {formJSX}
 *   </AuthLayout>
 */
import React from 'react';
import { Reveal } from '@/components/ui/motion';
import Logo from '@/components/ui/logo';
import { ChefHat, Bell, BarChart3, Zap } from 'lucide-react';

// Feature bullets shown in the branded right panel
const FEATURES = [
  { icon: Bell,      text: 'Instant order alerts, zero missed tickets' },
  { icon: ChefHat,   text: 'AI-powered floor plans in seconds' },
  { icon: BarChart3, text: 'Live sales analytics for every location' },
  { icon: Zap,       text: 'Self-hosted and yours — no per-order platform fee' },
];

const AuthLayout = ({ children }) => (
  <div className="min-h-screen flex items-stretch bg-background overflow-hidden">

    {/* ── Left: form panel ── */}
    <div className="flex-1 flex flex-col items-center justify-center px-5 py-10 sm:px-8 relative z-10 bg-background">
      {/* Soft ambient blobs — mobile only (hidden behind right panel on desktop) */}
      <div
        aria-hidden="true"
        className="lg:hidden absolute -top-24 -left-24 w-72 h-72 rounded-full bg-primary/8 blur-3xl pointer-events-none"
      />
      <div
        aria-hidden="true"
        className="lg:hidden absolute -bottom-24 -right-16 w-64 h-64 rounded-full bg-primary/6 blur-3xl pointer-events-none"
      />

      {/* Mobile logo — hidden on desktop where right panel has one */}
      <div className="lg:hidden mb-8 flex flex-col items-center gap-1">
        <Logo variant="minimal" />
        <p className="text-xs text-muted-foreground tracking-wide uppercase mt-1">
          Restaurant Management
        </p>
      </div>

      {/* Form card */}
      <Reveal
        y={16}
        delay={0.05}
        inView={false}
        className="w-full max-w-[420px]"
      >
        {children}
      </Reveal>

      <footer className="mt-8 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} BeepBite
      </footer>
    </div>

    {/* ── Right: branded panel (desktop only) ── */}
    <div className="hidden lg:flex lg:w-[480px] xl:w-[540px] flex-col items-center justify-center relative overflow-hidden beepbite-gradient">
      {/* Grid texture overlay */}
      <div aria-hidden="true" className="absolute inset-0 bg-grid-orange opacity-30 pointer-events-none" />

      {/* Animated blobs */}
      <div
        aria-hidden="true"
        className="animate-blob absolute top-[-80px] right-[-60px] w-72 h-72 rounded-full bg-white/10 pointer-events-none"
      />
      <div
        aria-hidden="true"
        className="animate-blob animation-delay-2000 absolute bottom-[-60px] left-[-40px] w-64 h-64 rounded-full bg-white/10 pointer-events-none"
      />
      <div
        aria-hidden="true"
        className="animate-blob animation-delay-4000 absolute top-1/2 left-1/3 w-48 h-48 rounded-full bg-white/8 pointer-events-none"
      />

      <div className="relative z-10 flex flex-col items-center gap-10 px-10 text-center">
        {/* Logo — floats gently */}
        <div className="animate-float-slow">
          <div className="w-20 h-20 rounded-3xl bg-white/20 border border-white/30 flex items-center justify-center shadow-elevated backdrop-blur-sm">
            <img
              src="/icon.svg"
              alt=""
              aria-hidden="true"
              className="w-11 h-11 filter brightness-0 invert"
            />
          </div>
        </div>

        {/* Brand name */}
        <div className="space-y-2">
          <h2 className="text-4xl font-display font-semibold text-white leading-tight text-balance">
            Run your restaurant<br />
            with <span className="font-display-italic text-white/90">confidence</span>
          </h2>
          <p className="text-base text-white/75 text-pretty">
            Everything from orders to analytics, beautifully unified.
          </p>
        </div>

        {/* Feature list */}
        <ul className="w-full space-y-3" aria-label="Platform highlights">
          {FEATURES.map(({ icon: Icon, text }) => (
            <li
              key={text}
              className="flex items-center gap-3 bg-white/10 border border-white/15 rounded-xl px-4 py-3 text-sm text-white/90 text-left backdrop-blur-sm"
            >
              <span className="flex-none w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center">
                <Icon className="w-3.5 h-3.5 text-white" aria-hidden="true" />
              </span>
              {text}
            </li>
          ))}
        </ul>

        <p className="text-xs text-white/50">
          Trusted by restaurants and cafés everywhere
        </p>
      </div>
    </div>
  </div>
);

export default AuthLayout;
