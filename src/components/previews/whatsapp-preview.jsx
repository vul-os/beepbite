import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Badge } from "@/components/ui/badge";
import { MessageSquare, CheckCheck, ArrowLeft, Phone, MoreVertical } from 'lucide-react';
import { cn } from "@/lib/utils";
import { formatMoney, currencyScale } from "@/lib/currency";

// WhatsApp SVG Icon Component
const WhatsAppIcon = ({ className = "w-4 h-4" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.465 3.488"/>
  </svg>
);

// This preview's order amounts are illustrative sample data, not tied to any
// real store — no currency is assumed (see src/lib/currency.js). Mock values
// stay major-unit floats and are scaled to minor units right before
// formatMoney renders them, the same convention real money uses elsewhere.
const DEMO_MONEY_SCALE = currencyScale();
const money = (major) => formatMoney(Math.round((major || 0) * DEMO_MONEY_SCALE));

const WhatsAppPreview = ({ className }) => {
  const [messageIndex, setMessageIndex] = useState(0);
  const [isTyping, setIsTyping] = useState(false);

  // Simple realistic conversation flow
  const conversation = [
    { 
      id: 1, 
      type: 'customer', 
      text: 'Hi! Can I see your menu please?', 
      time: '2:45 PM',
      status: 'read'
    },
    { 
      id: 2, 
      type: 'business', 
      text: `Hello! 👋 Here's our menu:\n\n🍔 Chicken Burger - ${money(45)}\n🥩 Beef Burger - ${money(55)}\n🍟 Fries - ${money(25)}\n🥤 Coca Cola - ${money(15)}`,
      time: '2:46 PM',
      status: 'read'
    },
    { 
      id: 3, 
      type: 'customer', 
      text: 'Perfect! I\'d like 2 Chicken Burgers and 1 Fries please', 
      time: '2:48 PM',
      status: 'read'
    },
    { 
      id: 4, 
      type: 'business', 
      text: `Great choice! 😊\n\nYour order:\n• 2x Chicken Burger (${money(90)})\n• 1x Fries (${money(25)})\n\nTotal: ${money(115)}\n\nShall I confirm this order?`,
      time: '2:49 PM',
      status: 'read'
    },
    { 
      id: 5, 
      type: 'customer', 
      text: 'Yes please! How long will it take?', 
      time: '2:50 PM',
      status: 'read'
    },
    { 
      id: 6, 
      type: 'business', 
      text: 'Perfect! ✅ Order confirmed.\n\nEstimated time: 15-20 minutes\nOrder #ORD247\n\nI\'ll send you a notification when it\'s ready for pickup!', 
      time: '2:51 PM',
      status: 'delivered'
    }
  ];

  // Auto-advance conversation
  useEffect(() => {
    const timer = setInterval(() => {
      if (messageIndex < conversation.length - 1) {
        setIsTyping(true);
        setTimeout(() => {
          setIsTyping(false);
          setMessageIndex(prev => prev + 1);
        }, 1500);
      } else {
        // Reset after showing all messages
        setTimeout(() => {
          setMessageIndex(0);
        }, 3000);
      }
    }, 3000);

    return () => clearInterval(timer);
  }, [messageIndex, conversation.length]);

  const visibleMessages = conversation.slice(0, messageIndex + 1);

  return (
    <motion.div 
      className={cn("bg-gradient-to-br from-green-50 to-emerald-100 rounded-2xl overflow-hidden border border-green-200 shadow-2xl w-full max-w-full", className)}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
    >
      <div className="h-[450px] flex justify-center items-center p-6">
        {/* Phone Mockup */}
        <motion.div 
          className="w-80 h-full bg-black rounded-3xl p-2 shadow-2xl"
          initial={{ scale: 0.9 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.5 }}
        >
          {/* Phone Screen */}
          <div className="w-full h-full bg-white rounded-2xl overflow-hidden flex flex-col">
            {/* WhatsApp Header */}
            <div className="bg-green-600 text-white px-4 py-3 flex items-center gap-3">
              <ArrowLeft className="w-5 h-5" />
              <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center text-sm font-bold">
                BB
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-sm">BeepBite Restaurant</h3>
                <p className="text-xs text-green-100">Online • Tap here for more info</p>
              </div>
              <Phone className="w-5 h-5" />
              <MoreVertical className="w-5 h-5" />
            </div>

            {/* Chat Background */}
            <div 
              className="flex-1 px-4 py-2 overflow-y-auto"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23f0f0f0' fill-opacity='0.1'%3E%3Ccircle cx='30' cy='30' r='2'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
                backgroundColor: '#e5ddd5'
              }}
            >
              <div className="space-y-3 py-2">
                <AnimatePresence>
                  {visibleMessages.map((message, index) => (
                    <motion.div
                      key={message.id}
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ duration: 0.3 }}
                      className={cn(
                        "flex",
                        message.type === 'business' ? "justify-start" : "justify-end"
                      )}
                    >
                      <div className={cn(
                        "max-w-[85%] px-3 py-2 rounded-lg shadow-sm",
                        message.type === 'business' 
                          ? "bg-white text-gray-900 rounded-bl-none" 
                          : "bg-green-500 text-white rounded-br-none"
                      )}>
                        <p className="text-sm whitespace-pre-line">{message.text}</p>
                        <div className={cn(
                          "flex items-center justify-end gap-1 mt-1",
                          message.type === 'business' ? "text-gray-500" : "text-green-100"
                        )}>
                          <span className="text-xs">{message.time}</span>
                          {message.type === 'business' && (
                            <CheckCheck className="w-3 h-3 text-blue-500" />
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>

                {/* Typing Indicator */}
                <AnimatePresence>
                  {isTyping && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="flex justify-start"
                    >
                      <div className="bg-white px-4 py-3 rounded-lg rounded-bl-none shadow-sm">
                        <div className="flex gap-1">
                          <motion.div
                            className="w-2 h-2 bg-gray-400 rounded-full"
                            animate={{ scale: [1, 1.2, 1] }}
                            transition={{ duration: 0.8, repeat: Infinity, delay: 0 }}
                          />
                          <motion.div
                            className="w-2 h-2 bg-gray-400 rounded-full"
                            animate={{ scale: [1, 1.2, 1] }}
                            transition={{ duration: 0.8, repeat: Infinity, delay: 0.2 }}
                          />
                          <motion.div
                            className="w-2 h-2 bg-gray-400 rounded-full"
                            animate={{ scale: [1, 1.2, 1] }}
                            transition={{ duration: 0.8, repeat: Infinity, delay: 0.4 }}
                          />
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Message Input */}
            <div className="bg-gray-100 px-3 py-2 flex items-center gap-2">
              <div className="flex-1 bg-white rounded-full px-4 py-2 flex items-center">
                <span className="text-sm text-gray-500">Type a message</span>
              </div>
              <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                <MessageSquare className="w-4 h-4 text-white" />
              </div>
            </div>
          </div>
        </motion.div>

        {/* Info Panel */}
        <motion.div 
          className="ml-8 space-y-4"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3 }}
        >
          <div className="bg-white rounded-xl p-4 shadow-lg border border-gray-200">
            <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <WhatsAppIcon className="w-5 h-5 text-green-500" />
              WhatsApp Ordering
            </h4>
            <div className="space-y-2 text-sm text-gray-600">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span>Direct menu sharing</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                <span>Real-time order updates</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                <span>Pickup notifications</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl p-4 shadow-lg border border-gray-200">
            <h5 className="font-medium text-gray-900 mb-2">Order Progress</h5>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Order #ORD247</span>
                <Badge className="bg-green-100 text-green-800 text-xs">
                  Confirmed
                </Badge>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Total</span>
                <span className="font-medium">{money(115)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">ETA</span>
                <span className="font-medium">15-20 min</span>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
};

export default WhatsAppPreview; 