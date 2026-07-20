import React from 'react';

const Logo = ({ className = "", variant = "default" }) => {
  if (variant === "minimal") {
    return (
      <div className={`flex items-center ${className}`}>
        <div className="relative">
          <div className="w-10 h-10 bg-card rounded-xl shadow-md flex items-center justify-center border border-border">
            <img
              src="/icon.svg"
              alt="BeepBite"
              className="w-6 h-6"
            />
          </div>
        </div>
        <span className="ml-3 text-2xl font-bold">
          <span className="text-foreground">Beep</span>
          <span className="text-primary">Bite</span>
        </span>
      </div>
    );
  }

  return (
    <div className={`text-center ${className}`}>
      <div className="flex justify-center items-center mb-4">
        <div className="relative">
          {/* Main logo with icon.svg */}
          <div className="w-20 h-20 beepbite-gradient rounded-2xl flex items-center justify-center shadow-xl transform hover:scale-105 transition-transform duration-300 border-4 border-background">
            <img
              src="/icon.svg"
              alt="BeepBite Bell Icon"
              className="w-12 h-12 filter brightness-0 invert"
            />
            {/* Small notification dot */}
            <div className="absolute -top-1 -right-1 w-4 h-4 bg-destructive rounded-full animate-pulse shadow-lg"></div>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
          <span className="beepbite-gradient-text">Beep</span>
          <span className="text-foreground">Bite</span>
        </h1>
        <p className="text-sm sm:text-base text-muted-foreground font-semibold tracking-wide uppercase">
          Restaurant Order Management
        </p>
      </div>
    </div>
  );
};

export default Logo; 