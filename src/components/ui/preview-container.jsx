import React from 'react';
import { cn } from "@/lib/utils";

const PreviewContainer = ({ 
  children, 
  className, 
  scale = { sm: 0.75, md: 0.85, lg: 1.0 },
  maxWidth = 'max-w-full',
  ...props 
}) => {
  return (
    <div 
      className={cn(
        "w-full overflow-hidden rounded-2xl",
        className
      )} 
      {...props}
    >
      <div 
        className={cn(
          "transform origin-top-left transition-transform duration-300",
          maxWidth,
          // Responsive scaling
          `scale-[${scale.sm}] md:scale-[${scale.md}] lg:scale-[${scale.lg}]`
        )}
        style={{
          // Fallback for custom scale values
          transform: `scale(${scale.sm})`,
        }}
      >
        <style jsx>{`
          @media (min-width: 768px) {
            div {
              transform: scale(${scale.md}) !important;
            }
          }
          @media (min-width: 1024px) {
            div {
              transform: scale(${scale.lg}) !important;
            }
          }
        `}</style>
        {children}
      </div>
    </div>
  );
};

export default PreviewContainer; 