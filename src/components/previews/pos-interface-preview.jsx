import React, { useState } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Clock,
  ShoppingCart,
  Search,
  Plus,
  PanelLeftOpen,
  Filter,
  CreditCard,
  Package,
  Utensils,
  Eye,
  Edit
} from 'lucide-react';
import { cn } from "@/lib/utils";

const POSInterfacePreview = ({ className }) => {
  const [activeTab, setActiveTab] = useState('orders');
  const [isOrdersExpanded, setIsOrdersExpanded] = useState(false);

  // Sample data that matches your app structure
  const sampleOrders = [
    {
      id: 1,
      order_number: "ORD001",
      status: "preparing",
      customer_phone: "+27123456789",
      created_at: "2024-01-15T10:30:00Z",
      total: 85.50,
      items_count: 3
    },
    {
      id: 2,
      order_number: "ORD002", 
      status: "ready",
      customer_phone: "+27987654321",
      created_at: "2024-01-15T10:45:00Z",
      total: 42.00,
      items_count: 2
    },
    {
      id: 3,
      order_number: "ORD003",
      status: "confirmed", 
      customer_phone: "+27456789123",
      created_at: "2024-01-15T11:00:00Z",
      total: 127.25,
      items_count: 5
    }
  ];

  const sampleCart = [
    {
      id: 1,
      name: "Chicken Burger",
      price: 45.00,
      quantity: 2
    },
    {
      id: 2, 
      name: "Fries (Large)",
      price: 25.00,
      quantity: 1
    }
  ];

  const sampleMenuItems = [
    { id: 1, name: "Chicken Burger", price: 45.00, category: "Burgers", description: "Grilled chicken with lettuce & mayo" },
    { id: 2, name: "Beef Burger", price: 55.00, category: "Burgers", description: "Juicy beef patty with cheese" },
    { id: 3, name: "Fries (Large)", price: 25.00, category: "Sides", description: "Crispy golden fries" },
    { id: 4, name: "Fries (Regular)", price: 18.00, category: "Sides", description: "Perfect portion of fries" },
    { id: 5, name: "Coca Cola", price: 15.00, category: "Drinks", description: "330ml can" },
    { id: 6, name: "Chicken Wings", price: 65.00, category: "Mains", description: "6 piece spicy wings" }
  ];

  const sampleCategories = [
    { id: 'burgers', name: 'Burgers' },
    { id: 'mains', name: 'Mains' },
    { id: 'sides', name: 'Sides' },
    { id: 'drinks', name: 'Drinks' }
  ];

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'confirmed': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'preparing': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'ready': return 'bg-green-100 text-green-800 border-green-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusLabel = (status) => {
    const labels = {
      'pending': 'Pending',
      'confirmed': 'Confirmed', 
      'preparing': 'Preparing',
      'ready': 'Ready'
    };
    return labels[status] || status;
  };

  const cartTotal = sampleCart.reduce((total, item) => total + (item.price * item.quantity), 0);

  return (
    <div className={cn("relative bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl overflow-hidden border border-orange-200", className)}>
      <div className="flex h-[350px] sm:h-[400px]">
        {/* Left Sidebar - Orders & Cart */}
        <div className="bg-white border-r border-orange-200 flex flex-col shadow-lg w-[300px] sm:w-[350px] flex-shrink-0">
          {/* Header with Tabs */}
          <div className="bg-gradient-to-r from-orange-500 to-orange-600 px-3 py-2 sm:px-4 sm:py-3">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2 bg-white/20 backdrop-blur-sm">
                <TabsTrigger 
                  value="orders" 
                  className="data-[state=active]:bg-white data-[state=active]:text-orange-600 text-white/90 text-xs"
                >
                  <Clock className="w-3 h-3 mr-1" />
                  Orders ({sampleOrders.length})
                </TabsTrigger>
                <TabsTrigger 
                  value="cart" 
                  className="data-[state=active]:bg-white data-[state=active]:text-orange-600 text-white/90 text-xs"
                >
                  <ShoppingCart className="w-3 h-3 mr-1" />
                  Cart ({sampleCart.length})
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-hidden">
            <Tabs value={activeTab} className="h-full flex flex-col">
              {/* Orders Tab */}
              <TabsContent value="orders" className="flex-1 overflow-y-auto m-0 p-2 sm:p-3 space-y-2">
                {sampleOrders.map((order) => (
                  <Card key={order.id} className="border border-orange-200 hover:border-orange-400 transition-colors cursor-pointer">
                    <CardContent className="p-2 sm:p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-xs sm:text-sm">#{order.order_number}</span>
                        <Badge className={cn("text-xs px-1 sm:px-2 py-1", getStatusColor(order.status))}>
                          {getStatusLabel(order.status)}
                        </Badge>
                      </div>
                      <div className="text-xs text-gray-600 space-y-1">
                        <p className="truncate">{order.customer_phone}</p>
                        <p>R{order.total.toFixed(2)} • {order.items_count} items</p>
                        <p>10:30 AM</p>
                      </div>
                      <div className="flex gap-1 mt-2">
                        <Button size="sm" variant="ghost" className="h-5 px-2 text-xs">
                          <Eye className="w-3 h-3 mr-1" />
                          View
                        </Button>
                        <Button size="sm" variant="ghost" className="h-5 px-2 text-xs">
                          <Edit className="w-3 h-3 mr-1" />
                          Edit
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </TabsContent>

              {/* Cart Tab */}
              <TabsContent value="cart" className="flex-1 flex flex-col m-0">
                <div className="flex-1 overflow-y-auto p-2 sm:p-3 space-y-2">
                  {sampleCart.map((item) => (
                    <Card key={item.id} className="border border-orange-200">
                      <CardContent className="p-2 sm:p-3">
                        <div className="flex justify-between items-start">
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium text-xs sm:text-sm truncate">{item.name}</h4>
                            <p className="text-xs text-gray-600">R{item.price.toFixed(2)} each</p>
                          </div>
                          <div className="text-right ml-2">
                            <span className="text-xs sm:text-sm font-bold">Qty: {item.quantity}</span>
                            <p className="text-xs text-gray-600">R{(item.price * item.quantity).toFixed(2)}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
                
                {/* Cart Footer */}
                <div className="border-t border-gray-200 p-2 sm:p-3 bg-gray-50">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-bold text-sm">Total:</span>
                    <span className="font-bold text-orange-600">R{cartTotal.toFixed(2)}</span>
                  </div>
                  <Button className="w-full bg-orange-500 hover:bg-orange-600 text-white text-xs h-7 sm:h-8">
                    <Plus className="w-3 h-3 mr-1" />
                    Create Order
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>

        {/* Main POS Area */}
        <div className="flex flex-col flex-1 min-w-0">
          {/* Search Bar */}
          <div className="p-2 sm:p-3 bg-white border-b border-orange-200">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-3 h-3 sm:w-4 sm:h-4" />
              <Input
                placeholder="Search menu items..."
                className="pl-8 h-7 sm:h-8 text-xs sm:text-sm border-2 border-orange-200 focus:border-orange-400"
              />
            </div>
          </div>

          {/* Categories */}
          <div className="p-2 bg-white border-b border-orange-200">
            <div className="flex gap-1 overflow-x-auto scrollbar-hide">
              <Button
                variant="default"
                className="whitespace-nowrap flex-shrink-0 h-5 sm:h-6 px-2 sm:px-3 rounded-full bg-orange-500 hover:bg-orange-600 text-white text-xs"
              >
                <Filter className="w-2 h-2 mr-1" />
                All
              </Button>
              {sampleCategories.slice(0, 3).map((category) => (
                <Button
                  key={category.id}
                  variant="outline"
                  className="whitespace-nowrap flex-shrink-0 h-5 sm:h-6 px-2 sm:px-3 rounded-full border-orange-200 text-gray-700 hover:bg-orange-50 text-xs"
                >
                  {category.name}
                </Button>
              ))}
            </div>
          </div>

          {/* Items Grid */}
          <div className="flex-1 overflow-y-auto p-2">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-1 sm:gap-2">
              {sampleMenuItems.slice(0, 6).map((item) => (
                <Card
                  key={item.id}
                  className="border-2 border-orange-200 hover:border-orange-400 transition-all duration-200 hover:shadow-lg cursor-pointer transform hover:scale-105"
                >
                  <CardContent className="p-1.5 sm:p-2">
                    <div className="h-14 sm:h-16 flex flex-col justify-between">
                      <div className="min-h-0">
                        <h3 className="font-bold text-xs leading-tight overflow-hidden text-ellipsis">
                          {item.name.length > 12 ? item.name.substring(0, 12) + '...' : item.name}
                        </h3>
                        <p className="text-xs text-gray-600 overflow-hidden text-ellipsis whitespace-nowrap">
                          {item.description && item.description.length > 15 
                            ? item.description.substring(0, 15) + '...'
                            : item.description
                          }
                        </p>
                      </div>
                      <div className="flex justify-between items-center mt-1">
                        <span className="font-bold text-xs text-orange-600">R{item.price.toFixed(0)}</span>
                        <Button size="sm" className="h-4 w-4 sm:h-5 sm:w-5 p-0 bg-orange-500 hover:bg-orange-600">
                          <Plus className="w-2 h-2" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default POSInterfacePreview; 