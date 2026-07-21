import { Check, Circle, Clock } from 'lucide-react';
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const Stepper = ({ 
  steps = [], 
  currentStep = 0, 
  orientation = 'horizontal',
  className,
  showStepNumbers = true,
  variant = 'default' // 'default' | 'minimal' | 'cards'
}) => {
  const getStepStatus = (stepIndex) => {
    if (stepIndex < currentStep) return 'completed';
    if (stepIndex === currentStep) return 'current';
    return 'upcoming';
  };

  const getStepIcon = (stepIndex, step) => {
    const status = getStepStatus(stepIndex);
    
    if (status === 'completed') {
      return <Check className="w-5 h-5 text-white" />;
    }
    
    if (status === 'current') {
      return step.icon ? (
        <step.icon className="w-5 h-5 text-white" />
      ) : showStepNumbers ? (
        <span className="text-white font-semibold text-sm">{stepIndex + 1}</span>
      ) : (
        <Clock className="w-5 h-5 text-white" />
      );
    }
    
    return step.icon ? (
      <step.icon className="w-5 h-5 text-gray-400" />
    ) : showStepNumbers ? (
      <span className="text-gray-400 font-semibold text-sm">{stepIndex + 1}</span>
    ) : (
      <Circle className="w-5 h-5 text-gray-400" />
    );
  };

  const getStepIconBg = (stepIndex) => {
    const status = getStepStatus(stepIndex);
    
    if (status === 'completed') return 'bg-gray-600 border-gray-600';
    if (status === 'current') return 'beepbite-gradient border-orange-500';
    return 'bg-white border-gray-300';
  };

  const getConnectorColor = (stepIndex) => {
    return stepIndex < currentStep ? 'bg-gray-600' : 'bg-gray-200';
  };

  if (variant === 'cards') {
    return (
      <div className={cn("space-y-4", className)}>
        <div className="grid gap-4 sm:gap-6">
          {steps.map((step, index) => {
            const status = getStepStatus(index);
            
            return (
              <Card 
                key={index}
                className={cn(
                  "border-2 transition-all duration-200",
                  status === 'completed' && "border-gray-600 bg-gray-50",
                  status === 'current' && "border-orange-500 bg-orange-50",
                  status === 'upcoming' && "border-gray-200"
                )}
              >
                <CardContent className="p-4 sm:p-6">
                  <div className="flex items-start gap-4">
                    {/* Icon */}
                    <div className={cn(
                      "w-12 h-12 rounded-lg border-2 flex items-center justify-center flex-shrink-0",
                      getStepIconBg(index)
                    )}>
                      {getStepIcon(index, step)}
                    </div>
                    
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className={cn(
                          "font-semibold text-lg",
                          status === 'completed' && "text-gray-700",
                          status === 'current' && "text-orange-700",
                          status === 'upcoming' && "text-gray-500"
                        )}>
                          {step.title}
                        </h3>
                        
                        <Badge 
                          variant="outline"
                          className={cn(
                            "text-xs font-medium",
                            status === 'completed' && "bg-gray-100 text-gray-700 border-gray-300",
                            status === 'current' && "bg-orange-100 text-orange-700 border-orange-300",
                            status === 'upcoming' && "bg-gray-50 text-gray-500 border-gray-200"
                          )}
                        >
                          {status === 'completed' ? 'Completed' : 
                           status === 'current' ? 'In Progress' : 'Upcoming'}
                        </Badge>
                      </div>
                      
                      {step.description && (
                        <p className={cn(
                          "text-sm",
                          status === 'completed' && "text-gray-600",
                          status === 'current' && "text-orange-600",
                          status === 'upcoming' && "text-gray-400"
                        )}>
                          {step.description}
                        </p>
                      )}
                      
                      {step.details && status === 'current' && (
                        <div className="mt-3 p-3 bg-orange-50 rounded-lg border border-orange-200">
                          <p className="text-sm text-orange-700">{step.details}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    );
  }

  if (orientation === 'vertical') {
    return (
      <div className={cn("space-y-4", className)}>
        {steps.map((step, index) => {
          const status = getStepStatus(index);
          const isLast = index === steps.length - 1;
          
          return (
            <div key={index} className="flex items-start gap-4">
              {/* Icon and Connector */}
              <div className="flex flex-col items-center">
                <div className={cn(
                  "w-10 h-10 rounded-full border-2 flex items-center justify-center z-10",
                  getStepIconBg(index)
                )}>
                  {getStepIcon(index, step)}
                </div>
                
                {!isLast && (
                  <div className={cn(
                    "w-0.5 h-16 mt-2",
                    getConnectorColor(index)
                  )} />
                )}
              </div>
              
              {/* Content */}
              <div className="flex-1 min-w-0 pb-8">
                <h3 className={cn(
                  "font-semibold text-base mb-1",
                  status === 'completed' && "text-gray-700",
                  status === 'current' && "text-orange-700",
                  status === 'upcoming' && "text-gray-500"
                )}>
                  {step.title}
                </h3>
                
                {step.description && (
                  <p className={cn(
                    "text-sm",
                    status === 'completed' && "text-gray-600",
                    status === 'current' && "text-orange-600",
                    status === 'upcoming' && "text-gray-400"
                  )}>
                    {step.description}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Horizontal stepper (default)
  return (
    <div className={cn("w-full", className)}>
      {/* Mobile: Vertical layout */}
      <div className="block sm:hidden">
        <div className="space-y-4">
          {steps.map((step, index) => {
            const status = getStepStatus(index);
            
            return (
              <div key={index} className="flex items-center gap-4">
                <div className={cn(
                  "w-10 h-10 rounded-full border-2 flex items-center justify-center flex-shrink-0",
                  getStepIconBg(index)
                )}>
                  {getStepIcon(index, step)}
                </div>
                
                <div className="flex-1 min-w-0">
                  <h3 className={cn(
                    "font-semibold text-sm",
                    status === 'completed' && "text-gray-700",
                    status === 'current' && "text-orange-700",
                    status === 'upcoming' && "text-gray-500"
                  )}>
                    {step.title}
                  </h3>
                  {step.description && (
                    <p className={cn(
                      "text-xs mt-1",
                      status === 'completed' && "text-gray-600",
                      status === 'current' && "text-orange-600",
                      status === 'upcoming' && "text-gray-400"
                    )}>
                      {step.description}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Tablet & Desktop: Horizontal layout */}
      <div className="hidden sm:block">
        <div className="flex items-center justify-between relative">
          {steps.map((step, index) => {
            const status = getStepStatus(index);
            const isLast = index === steps.length - 1;
            
            return (
              <div key={index} className="flex flex-col items-center relative z-10">
                {/* Icon */}
                <div className={cn(
                  "w-12 h-12 rounded-full border-2 flex items-center justify-center mb-3 bg-white",
                  getStepIconBg(index)
                )}>
                  {getStepIcon(index, step)}
                </div>
                
                {/* Content */}
                <div className="text-center max-w-32">
                  <h3 className={cn(
                    "font-semibold text-sm mb-1",
                    status === 'completed' && "text-gray-700",
                    status === 'current' && "text-orange-700",
                    status === 'upcoming' && "text-gray-500"
                  )}>
                    {step.title}
                  </h3>
                  
                  {step.description && (
                    <p className={cn(
                      "text-xs",
                      status === 'completed' && "text-gray-600",
                      status === 'current' && "text-orange-600",
                      status === 'upcoming' && "text-gray-400"
                    )}>
                      {step.description}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
          
          {/* Connector lines */}
          <div className="absolute top-6 left-6 right-6 h-0.5 bg-gray-200 -z-10" />
          <div 
            className="absolute top-6 left-6 h-0.5 bg-gray-600 -z-10 transition-all duration-500"
            style={{ 
              width: `${((currentStep) / (steps.length - 1)) * 100}%` 
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default Stepper; 