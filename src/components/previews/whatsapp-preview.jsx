import React, { useState, useEffect } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Smartphone,
  MessageCircle,
  Clock,
  CheckCircle,
  Phone,
  Bell,
  ArrowDown
} from 'lucide-react';
import { cn } from "@/lib/utils";

// WhatsApp SVG Icon Component
const WhatsAppIcon = ({ className = "w-5 h-5" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.465 3.488"/>
  </svg>
);

const WhatsAppPreview = ({ className }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [showNotification, setShowNotification] = useState(false);

  // Auto-advance the demo
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentStep((prev) => {
        if (prev >= 4) {
          setShowNotification(true);
          setTimeout(() => setShowNotification(false), 2000);
          return 0;
        }
        return prev + 1;
      });
    }, 3000);

    return () => clearInterval(timer);
  }, []);

  const chatMessages = [
    {
      id: 1,
      sender: 'customer',
      message: 'Hi! I\'d like to place an order 🍔',
      time: '10:30',
      visible: currentStep >= 0
    },
    {
      id: 2,
      sender: 'restaurant',
      message: 'Welcome to BeepBite Restaurant! 🎉\n\nHere\'s our menu:\n\n🍔 Chicken Burger - R45\n🍟 Fries (Large) - R25\n🥤 Coca Cola - R15\n\nJust reply with what you\'d like!',
      time: '10:30',
      visible: currentStep >= 1
    },
    {
      id: 3,
      sender: 'customer',
      message: '1x Chicken Burger\n1x Fries (Large)\n1x Coca Cola',
      time: '10:31',
      visible: currentStep >= 2
    },
    {
      id: 4,
      sender: 'restaurant',
      message: '✅ Order confirmed!\n\nOrder #ORD001\nTotal: R85.00\n\nEstimated time: 15 minutes\n\nYou\'ll receive a WhatsApp notification when your order is ready for pickup! 📱',
      time: '10:31',
      visible: currentStep >= 3
    },
    {
      id: 5,
      sender: 'restaurant',
      message: '🔔 Your order #ORD001 is ready for pickup!\n\n📍 BeepBite Restaurant\n123 Main Street\n\nTotal: R85.00\nThank you! 🙏',
      time: '10:45',
      visible: currentStep >= 4,
      isNotification: true
    }
  ];

  return (
    <div className={cn("relative", className)}>
      <div className="grid lg:grid-cols-2 gap-4 sm:gap-6 items-start">
        {/* WhatsApp Chat Interface */}
        <Card className="border-2 border-green-200 bg-white shadow-lg">
          <CardContent className="p-0">
            {/* WhatsApp Header */}
            <div className="bg-green-600 text-white p-3 sm:p-4 flex items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 bg-white rounded-full flex items-center justify-center">
                <WhatsAppIcon className="w-4 h-4 sm:w-6 sm:h-6 text-green-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-sm sm:text-base">BeepBite Restaurant</h3>
                <p className="text-xs sm:text-sm text-green-100">Online now</p>
              </div>
              <Phone className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>

            {/* Chat Messages */}
            <div className="h-64 sm:h-80 lg:h-96 overflow-y-auto p-3 sm:p-4 bg-gray-50 space-y-2 sm:space-y-3">
              {chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    "flex transition-all duration-500",
                    msg.sender === 'customer' ? 'justify-end' : 'justify-start',
                    msg.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
                  )}
                >
                  <div
                    className={cn(
                      "max-w-xs rounded-lg p-2 sm:p-3 shadow-sm",
                      msg.sender === 'customer'
                        ? 'bg-green-500 text-white rounded-br-none'
                        : msg.isNotification
                        ? 'bg-orange-100 text-orange-800 border border-orange-200 rounded-bl-none'
                        : 'bg-white text-gray-800 rounded-bl-none'
                    )}
                  >
                    <p className="text-xs sm:text-sm whitespace-pre-line">{msg.message}</p>
                    <p className={cn(
                      "text-xs mt-1",
                      msg.sender === 'customer' ? 'text-green-100' : 'text-gray-500'
                    )}>
                      {msg.time}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Input Area */}
            <div className="p-2 sm:p-3 bg-white border-t border-gray-200 flex items-center gap-2">
              <div className="flex-1 bg-gray-100 rounded-full px-3 sm:px-4 py-1 sm:py-2 text-xs sm:text-sm text-gray-500">
                Type a message...
              </div>
              <Button size="sm" className="bg-green-600 hover:bg-green-700 rounded-full h-8 w-8 sm:h-10 sm:w-10 p-0">
                <ArrowDown className="w-3 h-3 sm:w-4 sm:h-4 text-white" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Feature Explanation */}
        <div className="space-y-4 sm:space-y-6">
          <div>
            <h3 className="text-lg sm:text-xl font-semibold mb-3 sm:mb-4 text-orange-800">
              WhatsApp Digital Pagers
            </h3>
            <p className="text-sm sm:text-base text-gray-600 mb-4 sm:mb-6">
              Replace traditional buzzer systems with smart WhatsApp notifications. 
              Customers receive instant alerts when their orders are ready.
            </p>
          </div>

          {/* Features List */}
          <div className="space-y-3 sm:space-y-4">
            <div className="flex items-start gap-2 sm:gap-3">
              <div className="w-6 h-6 sm:w-8 sm:h-8 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <MessageCircle className="w-3 h-3 sm:w-4 sm:h-4 text-green-600" />
              </div>
              <div>
                <h4 className="font-semibold text-sm sm:text-base text-gray-900">Menu Browsing</h4>
                <p className="text-xs sm:text-sm text-gray-600">Customers browse and order directly via WhatsApp</p>
              </div>
            </div>

            <div className="flex items-start gap-2 sm:gap-3">
              <div className="w-6 h-6 sm:w-8 sm:h-8 bg-orange-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Clock className="w-3 h-3 sm:w-4 sm:h-4 text-orange-600" />
              </div>
              <div>
                <h4 className="font-semibold text-sm sm:text-base text-gray-900">Order Processing</h4>
                <p className="text-xs sm:text-sm text-gray-600">Orders sync with your main POS system automatically</p>
              </div>
            </div>

            <div className="flex items-start gap-2 sm:gap-3">
              <div className="w-6 h-6 sm:w-8 sm:h-8 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Bell className="w-3 h-3 sm:w-4 sm:h-4 text-blue-600" />
              </div>
              <div>
                <h4 className="font-semibold text-sm sm:text-base text-gray-900">Ready Notifications</h4>
                <p className="text-xs sm:text-sm text-gray-600">Automatic WhatsApp alerts when orders are ready</p>
              </div>
            </div>

            <div className="flex items-start gap-2 sm:gap-3">
              <div className="w-6 h-6 sm:w-8 sm:h-8 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <CheckCircle className="w-3 h-3 sm:w-4 sm:h-4 text-purple-600" />
              </div>
              <div>
                <h4 className="font-semibold text-sm sm:text-base text-gray-900">Professional Branding</h4>
                <p className="text-xs sm:text-sm text-gray-600">Branded messages with restaurant details and location</p>
              </div>
            </div>
          </div>

          {/* Status Indicator */}
          <Card className="bg-orange-50 border border-orange-200">
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-2 h-2 sm:w-3 sm:h-3 bg-orange-500 rounded-full animate-pulse"></div>
                <span className="text-xs sm:text-sm font-medium text-orange-700">
                  Demo running: Order flow simulation
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Notification Popup */}
      {showNotification && (
        <div className="fixed top-4 right-4 z-50 animate-in slide-in-from-right">
          <Card className="bg-green-600 text-white border-green-500 shadow-xl">
            <CardContent className="p-3 sm:p-4 flex items-center gap-2 sm:gap-3">
              <Smartphone className="w-5 h-5 sm:w-6 sm:h-6" />
              <div>
                <p className="font-semibold text-sm sm:text-base">WhatsApp Notification Sent!</p>
                <p className="text-xs sm:text-sm text-green-100">Customer notified: Order ready</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default WhatsAppPreview; 