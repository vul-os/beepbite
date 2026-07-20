import React from 'react';
import { Link } from 'react-router-dom';
import {
  Image as ImageIcon,
  Info,
  AlertTriangle,
  CheckCircle2,
  Lightbulb,
  ChevronRight,
  ChevronLeft,
  Copy,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ----- Page header -----
export const PageHeader = ({ eyebrow, title, description, lastUpdated, readTime }) => (
  <header className="mb-8 sm:mb-10">
    {eyebrow && (
      <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-orange-600 mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
        {eyebrow}
      </div>
    )}
    <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-foreground">{title}</h1>
    {description && (
      <p className="mt-3 sm:mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed max-w-3xl">{description}</p>
    )}
    {(lastUpdated || readTime) && (
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {readTime && <span>{readTime} read</span>}
        {readTime && lastUpdated && <span aria-hidden>·</span>}
        {lastUpdated && <span>Updated {lastUpdated}</span>}
      </div>
    )}
  </header>
);

// ----- Screenshot placeholder -----
// Renders a polished frame meant to host a screenshot. Variant "browser" gets
// a fake chrome bar; "mobile" renders a phone shell; "plain" is just a card.
export const Screenshot = ({
  caption,
  alt = 'Screenshot',
  src,
  variant = 'browser',
  ratio = '16/10',
  url,
  className,
}) => {
  const ratioStyle = { aspectRatio: ratio };

  const Body = (
    <div className="relative w-full overflow-hidden bg-gradient-to-br from-orange-50 via-white to-amber-50">
      <div style={ratioStyle} className="w-full" />
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6">
        {src ? (
          <img src={src} alt={alt} className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <>
            <div className="w-12 h-12 rounded-2xl bg-card border border-primary/15 shadow-sm flex items-center justify-center mb-3">
              <ImageIcon className="w-5 h-5 text-orange-500" />
            </div>
            <div className="text-sm font-semibold text-foreground">Screenshot placeholder</div>
            <div className="text-xs text-muted-foreground mt-0.5 max-w-md">{alt}</div>
          </>
        )}
        {/* Subtle dotted background */}
        {!src && (
          <div className="absolute inset-0 -z-0 [background-image:radial-gradient(circle,rgba(249,115,22,0.18)_1px,transparent_1px)] [background-size:14px_14px] opacity-40" />
        )}
      </div>
    </div>
  );

  if (variant === 'mobile') {
    return (
      <figure className={cn('my-6 mx-auto max-w-xs', className)}>
        <div className="relative rounded-[2.5rem] bg-gray-900 p-2 shadow-2xl shadow-orange-900/10">
          <div className="rounded-[2rem] overflow-hidden bg-white">
            <div className="bg-gray-900 text-white text-[10px] flex items-center justify-between px-5 py-1.5">
              <span>9:41</span>
              <span>•••</span>
            </div>
            {Body}
          </div>
        </div>
        {caption && (
          <figcaption className="mt-3 text-center text-xs text-muted-foreground">{caption}</figcaption>
        )}
      </figure>
    );
  }

  if (variant === 'plain') {
    return (
      <figure className={cn('my-6', className)}>
        <div className="rounded-2xl border border-border overflow-hidden shadow-sm">{Body}</div>
        {caption && <figcaption className="mt-2.5 text-sm text-muted-foreground">{caption}</figcaption>}
      </figure>
    );
  }

  return (
    <figure className={cn('my-6 sm:my-8', className)}>
      <div className="rounded-2xl border border-border overflow-hidden shadow-sm bg-card">
        <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border/60 bg-muted">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-300" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber-300" />
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-300" />
          {url && (
            <div className="ml-3 flex-1 min-w-0">
              <div className="text-xs text-muted-foreground bg-card border border-border rounded-md px-2.5 py-1 truncate">{url}</div>
            </div>
          )}
        </div>
        {Body}
      </div>
      {caption && (
        <figcaption className="mt-2.5 text-sm text-muted-foreground text-center sm:text-left">{caption}</figcaption>
      )}
    </figure>
  );
};

// ----- Callout (info / tip / warn / success) -----
const calloutTone = {
  info: { ring: 'ring-sky-100', bg: 'bg-sky-50', text: 'text-sky-900', icon: 'text-sky-500', title: 'text-sky-700' },
  tip: { ring: 'ring-violet-100', bg: 'bg-violet-50', text: 'text-violet-900', icon: 'text-violet-500', title: 'text-violet-700' },
  warn: { ring: 'ring-amber-100', bg: 'bg-amber-50', text: 'text-amber-900', icon: 'text-amber-500', title: 'text-amber-700' },
  success: {
    ring: 'ring-emerald-100',
    bg: 'bg-emerald-50',
    text: 'text-emerald-900',
    icon: 'text-emerald-500',
    title: 'text-emerald-700',
  },
};

const calloutIcon = {
  info: Info,
  tip: Lightbulb,
  warn: AlertTriangle,
  success: CheckCircle2,
};

export const Callout = ({ tone = 'info', title, children }) => {
  const t = calloutTone[tone] ?? calloutTone.info;
  const Icon = calloutIcon[tone] ?? Info;
  return (
    <div className={cn('not-prose my-5 rounded-xl ring-1 p-4 sm:p-5 flex gap-3', t.ring, t.bg, t.text)}>
      <Icon className={cn('w-5 h-5 flex-shrink-0 mt-0.5', t.icon)} />
      <div className="min-w-0 text-sm sm:text-[15px] leading-relaxed">
        {title && <div className={cn('font-semibold mb-1', t.title)}>{title}</div>}
        <div>{children}</div>
      </div>
    </div>
  );
};

// ----- Numbered Steps -----
export const Steps = ({ children }) => {
  const items = React.Children.toArray(children);
  return (
    <ol className="not-prose my-6 space-y-5 relative">
      {items.map((child, i) => (
        <li key={i} className="relative pl-12 sm:pl-14">
          <span className="absolute left-0 top-0 flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gradient-to-br from-orange-500 to-rose-500 text-white text-sm font-bold shadow-md shadow-orange-500/30">
            {i + 1}
          </span>
          {i < items.length - 1 && (
            <span className="absolute left-[17px] sm:left-[19px] top-10 sm:top-11 bottom-[-1.25rem] w-px bg-gradient-to-b from-orange-200 to-transparent" />
          )}
          <div className="pt-1">{child}</div>
        </li>
      ))}
    </ol>
  );
};

export const Step = ({ title, children }) => (
  <div>
    {title && <h3 className="text-base sm:text-lg font-bold text-foreground mb-1.5">{title}</h3>}
    <div className="text-sm sm:text-base text-muted-foreground leading-relaxed">{children}</div>
  </div>
);

// ----- Section heading -----
export const Section = ({ id, title, kicker, children }) => (
  <section id={id} className="scroll-mt-24 mt-12 sm:mt-14">
    {kicker && (
      <div className="text-xs uppercase tracking-wider text-orange-600 font-semibold mb-1.5">{kicker}</div>
    )}
    <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
      <a href={id ? `#${id}` : undefined} className="group inline-flex items-center gap-2 hover:text-primary transition-colors">
        {title}
        {id && <span className="opacity-0 group-hover:opacity-50 text-base">#</span>}
      </a>
    </h2>
    <div className="mt-4 text-[15px] sm:text-base text-foreground leading-relaxed">{children}</div>
  </section>
);

// ----- Key/value table for definitions, requirements -----
export const KeyValueList = ({ items }) => (
  <dl className="not-prose my-5 divide-y divide-border rounded-xl border border-border bg-card overflow-hidden">
    {items.map((item) => (
      <div key={item.label} className="grid grid-cols-3 gap-3 px-4 sm:px-5 py-3 text-sm">
        <dt className="font-semibold text-foreground col-span-1">{item.label}</dt>
        <dd className="col-span-2 text-muted-foreground">{item.value}</dd>
      </div>
    ))}
  </dl>
);

// ----- Code block with copy -----
export const Code = ({ children, language }) => {
  const [copied, setCopied] = React.useState(false);
  const text = String(children);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <div className="not-prose relative my-5 rounded-xl bg-gray-950 text-gray-100 overflow-hidden border border-gray-800">
      {language && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-900/60 text-xs">
          <span className="font-mono text-gray-400">{language}</span>
          <button
            onClick={onCopy}
            className="inline-flex items-center gap-1.5 text-gray-300 hover:text-white text-xs"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
      <pre className="overflow-x-auto p-4 text-sm leading-relaxed font-mono">
        <code>{text}</code>
      </pre>
    </div>
  );
};

// ----- Prev / Next nav -----
export const PrevNext = ({ prev, next }) => (
  <nav className="not-prose mt-14 grid grid-cols-1 sm:grid-cols-2 gap-3">
    {prev ? (
      <Link
        to={prev.href}
        className="group rounded-xl border border-border bg-card p-4 hover:border-primary/40 hover:bg-primary/5 transition-colors"
      >
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
          <ChevronLeft className="w-3.5 h-3.5" />
          Previous
        </div>
        <div className="font-semibold text-foreground group-hover:text-primary transition-colors">{prev.title}</div>
      </Link>
    ) : (
      <span />
    )}
    {next ? (
      <Link
        to={next.href}
        className="group rounded-xl border border-border bg-card p-4 sm:text-right hover:border-primary/40 hover:bg-primary/5 transition-colors"
      >
        <div className="flex sm:justify-end items-center gap-1.5 text-xs text-muted-foreground mb-1">
          Next
          <ChevronRight className="w-3.5 h-3.5" />
        </div>
        <div className="font-semibold text-foreground group-hover:text-primary transition-colors">{next.title}</div>
      </Link>
    ) : (
      <span />
    )}
  </nav>
);

// ----- Feature/topic card grid -----
export const TopicCard = ({ to, icon, title, description, badge }) => (
  <Link
    to={to}
    className="group relative block rounded-2xl border border-border bg-card p-5 sm:p-6 hover:border-primary/40 hover:shadow-lg hover:-translate-y-0.5 transition-all"
  >
    {badge && (
      <span className="absolute top-3 right-3 text-[10px] font-bold uppercase tracking-wider bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">
        {badge}
      </span>
    )}
    <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-br from-orange-100 to-rose-100 text-orange-600 mb-3.5">
      {icon}
    </div>
    <h3 className="text-base sm:text-lg font-bold text-foreground group-hover:text-primary transition-colors">{title}</h3>
    <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{description}</p>
    <div className="mt-3.5 inline-flex items-center gap-1 text-sm font-semibold text-orange-600">
      Read guide
      <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
    </div>
  </Link>
);

// ----- Inline TOC for long pages -----
export const TableOfContents = ({ items }) => (
  <div className="not-prose hidden xl:block xl:fixed xl:top-32 xl:right-8 w-56">
    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">On this page</div>
    <ul className="space-y-2 text-sm border-l border-border">
      {items.map((it) => (
        <li key={it.id}>
          <a
            href={`#${it.id}`}
            className="block pl-3 -ml-px border-l border-transparent text-muted-foreground hover:text-primary hover:border-primary/60 transition-colors"
          >
            {it.title}
          </a>
        </li>
      ))}
    </ul>
  </div>
);
