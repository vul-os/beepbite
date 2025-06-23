import React from 'react';

const Logo = ({ className = "" }) => {
  return (
    <div className={`text-center ${className}`}>
      <div className="flex justify-center items-center mb-2 sm:mb-3">
        <div className="flex items-center -space-x-2">
          <span className="text-3xl sm:text-4xl font-serif font-bold tracking-tight text-gray-900">
            Case
          </span>
          <img 
            src="/icon.svg" 
            alt="CaseOn Logo" 
            className="h-12 w-12 sm:h-14 sm:w-14 mt-2 sm:mt-3" 
          />
        </div>
      </div>
      <p className="text-sm sm:text-base text-gray-600 font-medium tracking-wide uppercase">
        LEGAL INTELLIGENCE
      </p>
    </div>
  );
};

export default Logo; 