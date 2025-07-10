import React from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { 
  Plus, 
  Search,
  Utensils,
  Filter,
  X
} from 'lucide-react';
import { cn } from "@/lib/utils";

const POSSection = ({
  searchTerm,
  setSearchTerm,
  categories,
  selectedCategory,
  setSelectedCategory,
  filteredItems,
  loadingItems,
  isOrdersExpanded,
  addToCart
}) => {
  return (
    <>
      {/* Top Search Bar */}
      <div className="p-4 bg-white border-b border-orange-200 shadow-sm">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-6 h-6" />
          <Input
            placeholder="Search menu items..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-12 h-12 text-lg font-medium border-2 border-orange-200 focus:border-orange-400 focus:ring-orange-200 rounded-xl"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Categories Row */}
      <div className="p-3 bg-white border-b border-orange-200">
        <div className="flex gap-2 overflow-x-auto pb-2">
          <Button
            variant={selectedCategory === 'all' ? 'default' : 'outline'}
            onClick={() => setSelectedCategory('all')}
            className={cn(
              "whitespace-nowrap flex-shrink-0 h-9 px-4 rounded-full font-medium transition-all text-sm",
              selectedCategory === 'all'
                ? "bg-orange-500 hover:bg-orange-600 text-white shadow-md"
                : "border-orange-200 text-gray-700 hover:bg-orange-50 hover:border-orange-300"
            )}
          >
            <Filter className="w-3 h-3 mr-2" />
            All Items
          </Button>
          {categories.map((category) => (
            <Button
              key={category.id}
              variant={selectedCategory === category.id ? 'default' : 'outline'}
              onClick={() => setSelectedCategory(category.id)}
              className={cn(
                "whitespace-nowrap flex-shrink-0 h-9 px-4 rounded-full font-medium transition-all text-sm",
                selectedCategory === category.id
                  ? "bg-orange-500 hover:bg-orange-600 text-white shadow-md"
                  : "border-orange-200 text-gray-700 hover:bg-orange-50 hover:border-orange-300"
              )}
            >
              {category.name}
            </Button>
          ))}
        </div>
      </div>

      {/* Items Grid - Fixed layout for consistent card sizes */}
      <div className="flex-1 overflow-y-auto p-4">
        {loadingItems ? (
          <div className={cn(
            "grid gap-4",
            isOrdersExpanded 
              ? "grid-cols-1 xl:grid-cols-2" 
              : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
          )}>
            {[...Array(isOrdersExpanded ? 8 : 24)].map((_, i) => (
              <div key={i} className="h-32 bg-gray-200 rounded-xl animate-pulse"></div>
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-12">
            <Utensils className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No items found</h3>
            <p className="text-gray-500">
              {searchTerm ? 'Try a different search term' : 'No items in this category'}
            </p>
          </div>
        ) : (
          <div className={cn(
            "grid gap-4",
            isOrdersExpanded 
              ? "grid-cols-1 xl:grid-cols-2" 
              : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
          )}>
            {filteredItems.map((item) => (
              <Card
                key={item.id}
                className="border-2 border-orange-200 hover:border-orange-400 transition-all duration-200 hover:shadow-lg cursor-pointer transform hover:scale-105"
                onClick={() => addToCart(item)}
              >
                <CardContent className={cn(
                  "p-4 flex flex-col justify-between",
                  isOrdersExpanded ? "h-40" : "h-32"
                )}>
                  <div className="flex-1 min-h-0">
                    <h3 className={cn(
                      "font-bold text-gray-900 mb-1 leading-tight overflow-hidden text-ellipsis whitespace-nowrap",
                      isOrdersExpanded ? "text-base" : "text-sm"
                    )}>
                      {item.name.length > (isOrdersExpanded ? 25 : 20) 
                        ? item.name.substring(0, isOrdersExpanded ? 25 : 20) + '...'
                        : item.name
                      }
                    </h3>
                    
                    {item.description && (
                      <p className={cn(
                        "text-gray-600 mb-1 overflow-hidden text-ellipsis whitespace-nowrap",
                        isOrdersExpanded ? "text-sm" : "text-xs"
                      )}>
                        {item.description.length > (isOrdersExpanded ? 50 : 35) 
                          ? item.description.substring(0, isOrdersExpanded ? 50 : 35) + '...'
                          : item.description
                        }
                      </p>
                    )}

                    {/* Show variations preview - more compact */}
                    {item.item_variations && item.item_variations.length > 0 && (
                      <div className="text-xs text-gray-500">
                        {item.item_variations.slice(0, isOrdersExpanded ? 2 : 1).map((variation, index) => (
                          <span key={variation.id}>
                            {variation.name}
                            {index < Math.min(item.item_variations.length, isOrdersExpanded ? 2 : 1) - 1 && ', '}
                          </span>
                        ))}
                        {item.item_variations.length > (isOrdersExpanded ? 2 : 1) && '...'}
                      </div>
                    )}
                  </div>
                  
                  <div className="flex justify-between items-center mt-auto pt-2">
                    <span className={cn(
                      "font-bold text-orange-600",
                      isOrdersExpanded ? "text-lg" : "text-base"
                    )}>
                      R{parseFloat(item.price || 0).toFixed(2)}
                    </span>
                    
                    <Button
                      size="sm"
                      className={cn(
                        "bg-orange-500 hover:bg-orange-600 text-white p-0 rounded-full flex-shrink-0",
                        isOrdersExpanded ? "h-8 w-8" : "h-7 w-7"
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        addToCart(item);
                      }}
                    >
                      <Plus className="w-3 h-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  );
};

export default POSSection; 