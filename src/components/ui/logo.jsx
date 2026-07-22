// Logo — two lockups: `minimal` (top bar, small) and `default` (auth pages,
// empty states). The old "default" mark carried a pulsing red notification
// dot on the icon tile — a leftover from BeepBite's earlier life as a table-
// ready notifier. That's gone: this is a point-of-sale now, and a badge that
// reads "something needs your attention" has no business sitting on the
// wordmark of every screen.
const Logo = ({ className = "", variant = "default" }) => {
  if (variant === "minimal") {
    return (
      <div className={`flex items-center ${className}`}>
        <div className="flex h-10 w-10 items-center justify-center rounded-md border-2 border-border bg-card shadow-card">
          <img src="/icon.svg" alt="" className="h-6 w-6" />
        </div>
        <span className="font-display ml-3 text-2xl leading-none">
          <span className="text-foreground">Beep</span>
          <span className="text-primary">Bite</span>
        </span>
      </div>
    );
  }

  return (
    <div className={`text-center ${className}`}>
      <div className="mb-4 flex items-center justify-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-lg border-2 border-background bg-primary shadow-elevated">
          <img src="/icon.svg" alt="BeepBite" className="h-11 w-11 brightness-0 invert" />
        </div>
      </div>

      <div className="space-y-2">
        <h1 className="font-display text-4xl leading-none sm:text-5xl">
          <span className="text-primary">Beep</span>
          <span className="text-foreground">Bite</span>
        </h1>
        <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground sm:text-base">
          Restaurant point-of-sale
        </p>
      </div>
    </div>
  );
};

export default Logo;
