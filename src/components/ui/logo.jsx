import React from 'react';

const Logo = ({ className = "", variant = "default" }) => {
  if (variant === "minimal") {
    return (
      <div className={`flex items-center ${className}`}>
        <div className="relative">
          <div className="w-8 h-8 beepbite-gradient rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-lg">B</span>
          </div>
        </div>
        <span className="ml-2 text-xl font-bold text-foreground">BeepBite</span>
      </div>
    );
  }

  return (
    <div className={`text-center ${className}`}>
      <div className="flex justify-center items-center mb-3">
        <div className="relative">
          {/* Animated orange circle background */}
          <div className="w-16 h-16 beepbite-gradient rounded-full flex items-center justify-center shadow-lg transform hover:scale-105 transition-transform duration-300">
            {/* Bell/notification icon made with text */}
            <div className="text-white font-bold text-2xl relative">
              🔔
              {/* Small notification dot */}
              <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
            </div>
          </div>
        </div>
      </div>
      
      <div className="space-y-1">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
          <span className="beepbite-gradient-text">Beep</span>
          <span className="text-secondary">Bite</span>
        </h1>
        <p className="text-sm sm:text-base text-muted-foreground font-medium tracking-wide uppercase">
          Restaurant Order Management
        </p>
      </div>
    </div>
  );
};

export default Logo; 