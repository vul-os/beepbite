import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { 
  Plus,
  Edit,
  Trash2,
  Eye,
  EyeOff,
  Package,
  DollarSign,
  ChefHat,
  Clock,
  Search,
  Filter
} from 'lucide-react';
import { cn } from "@/lib/utils";

const MenuManagementPreview = ({ className }) => {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  const sampleCategories = [
    { id: 'all', name: 'All Items', count: 24 },
    { id: 'burgers', name: 'Burgers', count: 8 },
    { id: 'mains', name: 'Mains', count: 6 },
    { id: 'sides', name: 'Sides', count: 5 },
    { id: 'drinks', name: 'Drinks', count: 5 }
  ];

  const sampleMenuItems = [
    {
      id: 1,
      name: "Chicken Burger",
      category: "Burgers",
      price: 45.00,
      description: "Grilled chicken breast with lettuce, tomato, and mayo",
      is_available: true,
      prep_time: 15,
      variations: ['Small', 'Large'],
      inventory_count: 25
    },
    {
      id: 2,
      name: "Beef Burger",
      category: "Burgers",
      price: 55.00,
      description: "Juicy beef patty with cheese, lettuce, and tomato",
      is_available: true,
      prep_time: 18,
      variations: ['Regular', 'Double'],
      inventory_count: 18
    },
    {
      id: 3,
      name: "Margherita Pizza",
      category: "Mains",
      price: 75.00,
      description: "Classic pizza with tomato sauce and mozzarella",
      is_available: false,
      prep_time: 25,
      variations: ['Small', 'Medium', 'Large'],
      inventory_count: 0
    },
    {
      id: 4,
      name: "Fries (Large)",
      category: "Sides",
      price: 25.00,
      description: "Crispy golden potato fries",
      is_available: true,
      prep_time: 8,
      variations: [],
      inventory_count: 45
    },
    {
      id: 5,
      name: "Coca Cola",
      category: "Drinks",
      price: 15.00,
      description: "330ml chilled can",
      is_available: true,
      prep_time: 2,
      variations: ['Can', 'Bottle'],
      inventory_count: 67
    },
    {
      id: 6,
      name: "Caesar Salad",
      category: "Mains",
      price: 38.00,
      description: "Fresh romaine lettuce with caesar dressing and croutons",
      is_available: true,
      prep_time: 12,
      variations: ['Regular', 'Large'],
      inventory_count: 12
    }
  ];

  const filteredItems = sampleMenuItems.filter(item => {
    const matchesCategory = selectedCategory === 'all' || item.category.toLowerCase() === selectedCategory;
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         item.description.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const getStockStatus = (count) => {
    if (count === 0) return { label: 'Out of Stock', color: 'bg-red-100 text-red-800 border-red-200' };
    if (count < 10) return { label: 'Low Stock', color: 'bg-yellow-100 text-yellow-800 border-yellow-200' };
    return { label: 'In Stock', color: 'bg-green-100 text-green-800 border-green-200' };
  };

  return (
    <div className={cn("bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl overflow-hidden border border-orange-200", className)}>
      <div className="bg-white p-4 sm:p-6 border-b border-orange-200">
        <div className="flex items-center justify-between mb-4 sm:mb-6">
          <div>
            <h3 className="text-lg sm:text-xl font-semibold text-orange-800">Menu Management</h3>
            <p className="text-xs sm:text-sm text-gray-600">Manage your restaurant's menu items and inventory</p>
          </div>
          <Button className="bg-orange-500 hover:bg-orange-600 text-white text-xs sm:text-sm h-7 sm:h-9 px-3 sm:px-4">
            <Plus className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
            Add Item
          </Button>
        </div>

        {/* Search and Filter */}
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 mb-4 sm:mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-3 h-3 sm:w-4 sm:h-4" />
            <Input
              placeholder="Search menu items..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 sm:pl-10 border-2 border-orange-200 focus:border-orange-400 h-8 sm:h-10 text-xs sm:text-sm"
            />
          </div>
          <div className="flex gap-1 sm:gap-2 overflow-x-auto">
            {sampleCategories.slice(0, 4).map((category) => (
              <Button
                key={category.id}
                variant={selectedCategory === category.id ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedCategory(category.id)}
                className={cn(
                  "whitespace-nowrap flex-shrink-0 text-xs h-7 sm:h-8 px-2 sm:px-3",
                  selectedCategory === category.id
                    ? "bg-orange-500 hover:bg-orange-600 text-white"
                    : "border-orange-200 text-orange-700 hover:bg-orange-50"
                )}
              >
                {category.name} ({category.count})
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Menu Items Grid */}
      <div className="p-3 sm:p-6">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {filteredItems.slice(0, 6).map((item) => {
            const stockStatus = getStockStatus(item.inventory_count);
            
            return (
              <Card
                key={item.id}
                className={cn(
                  "border-2 transition-all duration-200 hover:shadow-lg",
                  item.is_available 
                    ? "border-orange-200 hover:border-orange-400" 
                    : "border-gray-200 opacity-75"
                )}
              >
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-center justify-between mb-2 sm:mb-3">
                    <Badge variant="outline" className="text-xs">
                      {item.category}
                    </Badge>
                    <div className="flex items-center gap-1">
                      {item.is_available ? (
                        <Eye className="w-3 h-3 sm:w-4 sm:h-4 text-green-500" />
                      ) : (
                        <EyeOff className="w-3 h-3 sm:w-4 sm:h-4 text-gray-400" />
                      )}
                    </div>
                  </div>

                  <h4 className="font-bold text-sm sm:text-base text-gray-900 mb-2 truncate">{item.name}</h4>
                  
                  <p className="text-xs sm:text-sm text-gray-600 mb-2 sm:mb-3 line-clamp-2">
                    {item.description}
                  </p>

                  <div className="space-y-1 sm:space-y-2 mb-3 sm:mb-4">
                    <div className="flex items-center justify-between text-xs sm:text-sm">
                      <span className="flex items-center gap-1">
                        <DollarSign className="w-3 h-3 text-orange-500" />
                        <span className="font-semibold text-orange-600">R{item.price.toFixed(2)}</span>
                      </span>
                      <span className="flex items-center gap-1 text-gray-500">
                        <Clock className="w-3 h-3" />
                        {item.prep_time}min
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs sm:text-sm">
                      <span className="flex items-center gap-1 text-gray-500">
                        <Package className="w-3 h-3" />
                        Stock: {item.inventory_count}
                      </span>
                      <Badge className={cn("text-xs px-1 sm:px-2 py-1", stockStatus.color)}>
                        {stockStatus.label}
                      </Badge>
                    </div>

                    {item.variations.length > 0 && (
                      <div className="text-xs text-gray-500">
                        <span className="font-medium">Variations:</span> {item.variations.join(', ')}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-1 sm:gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 border-orange-200 text-orange-600 hover:bg-orange-50 h-7 sm:h-8 text-xs"
                    >
                      <Edit className="w-3 h-3 mr-1" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-red-200 text-red-600 hover:bg-red-50 h-7 sm:h-8 px-2 sm:px-3"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {filteredItems.length === 0 && (
          <div className="text-center py-8 sm:py-12">
            <ChefHat className="w-12 h-12 sm:w-16 sm:h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-base sm:text-lg font-medium text-gray-900 mb-2">No items found</h3>
            <p className="text-sm text-gray-500">
              {searchTerm ? 'Try a different search term' : 'No items in this category'}
            </p>
          </div>
        )}
      </div>

      {/* Quick Stats */}
      <div className="bg-white border-t border-orange-200 p-4 sm:p-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <div className="text-center">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-orange-100 rounded-lg flex items-center justify-center mx-auto mb-2">
              <Package className="w-5 h-5 sm:w-6 sm:h-6 text-orange-600" />
            </div>
            <p className="text-lg sm:text-xl font-bold text-gray-900">24</p>
            <p className="text-xs sm:text-sm text-gray-600">Total Items</p>
          </div>
          <div className="text-center">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-green-100 rounded-lg flex items-center justify-center mx-auto mb-2">
              <Eye className="w-5 h-5 sm:w-6 sm:h-6 text-green-600" />
            </div>
            <p className="text-lg sm:text-xl font-bold text-gray-900">21</p>
            <p className="text-xs sm:text-sm text-gray-600">Available</p>
          </div>
          <div className="text-center">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-yellow-100 rounded-lg flex items-center justify-center mx-auto mb-2">
              <Clock className="w-5 h-5 sm:w-6 sm:h-6 text-yellow-600" />
            </div>
            <p className="text-lg sm:text-xl font-bold text-gray-900">3</p>
            <p className="text-xs sm:text-sm text-gray-600">Low Stock</p>
          </div>
          <div className="text-center">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-red-100 rounded-lg flex items-center justify-center mx-auto mb-2">
              <EyeOff className="w-5 h-5 sm:w-6 sm:h-6 text-red-600" />
            </div>
            <p className="text-lg sm:text-xl font-bold text-gray-900">1</p>
            <p className="text-xs sm:text-sm text-gray-600">Out of Stock</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MenuManagementPreview; 