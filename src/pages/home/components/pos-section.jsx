import React, { useState, useEffect, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { 
  Plus, 
  Search,
  Utensils,
  Filter,
  X,
  ChevronDown,
  ChevronUp
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
  const [isCategoriesExpanded, setIsCategoriesExpanded] = useState(false);
  const [showExpandButton, setShowExpandButton] = useState(false);
  const categoriesContainerRef = useRef(null);
  const allCategoriesRef = useRef(null);

  // Check if categories overflow and need expand/collapse functionality
  useEffect(() => {
    const checkOverflow = () => {
      if (categoriesContainerRef.current && allCategoriesRef.current) {
        // Create a temporary container to measure the full height
        const tempContainer = allCategoriesRef.current.cloneNode(true);
        tempContainer.style.position = 'absolute';
        tempContainer.style.visibility = 'hidden';
        tempContainer.style.height = 'auto';
        tempContainer.style.maxHeight = 'none';
        document.body.appendChild(tempContainer);
        
        const fullHeight = tempContainer.scrollHeight;
        document.body.removeChild(tempContainer);
        
        // Calculate approximate height for 2 lines (button height + gap + padding)
        const buttonHeight = 36; // h-9 = 36px
        const gap = 8; // gap-2 = 8px
        const twoLinesHeight = (buttonHeight * 2) + gap;
        
        setShowExpandButton(fullHeight > twoLinesHeight);
      }
    };

    checkOverflow();
    // Re-check when categories change or window resizes
    window.addEventListener('resize', checkOverflow);
    return () => window.removeEventListener('resize', checkOverflow);
  }, [categories]);

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

      {/* Categories Section - Multiline with Expand/Collapse */}
      <div className="p-3 bg-white border-b border-orange-200">
        <div className="relative">
          <div 
            ref={categoriesContainerRef}
            className={cn(
              "overflow-hidden transition-all duration-300 ease-in-out",
              !isCategoriesExpanded && showExpandButton ? "max-h-20" : "max-h-none"
            )}
          >
            <div 
              ref={allCategoriesRef}
              className="flex flex-wrap gap-2"
            >
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
          
          {/* Expand/Collapse Button */}
          {showExpandButton && (
            <div className="flex justify-center mt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsCategoriesExpanded(!isCategoriesExpanded)}
                className="text-gray-500 hover:text-gray-700 hover:bg-gray-100 h-8 px-3 rounded-full text-xs"
              >
                {isCategoriesExpanded ? (
                  <>
                    <ChevronUp className="w-3 h-3 mr-1" />
                    Show Less
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-3 h-3 mr-1" />
                    Show More
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Items Grid - Fixed layout for consistent card sizes */}
      <div className="flex-1 overflow-y-auto p-4">
        {loadingItems ? (
          <div className={cn(
            "grid gap-4",
            isOrdersExpanded 
              ? "grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" 
              : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-4"
          )}>
            {[...Array(isOrdersExpanded ? 8 : 24)].map((_, i) => (
              <div key={i} className={cn(
                "bg-gray-200 rounded-xl animate-pulse",
                isOrdersExpanded ? "h-64" : "h-44"
              )}></div>
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
              ? "grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" 
              : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-4"
          )}>
            {filteredItems.map((item) => (
              <Card
                key={item.id}
                className="border-2 border-orange-200 hover:border-orange-400 transition-all duration-200 hover:shadow-lg cursor-pointer transform hover:scale-105"
                onClick={() => addToCart(item)}
              >
                <CardContent className={cn(
                  "flex flex-col justify-between",
                  isOrdersExpanded ? "p-6 h-64" : "p-5 h-44"
                )}>
                  <div className="flex-1 min-h-0">
                    <h3 className={cn(
                      "font-bold text-gray-900 mb-2 leading-tight",
                      isOrdersExpanded ? "text-xl line-clamp-3" : "text-base line-clamp-2"
                    )}>
                      {item.name}
                    </h3>
                    
                    {item.description && (
                      <p className={cn(
                        "text-gray-600 mb-2 leading-relaxed",
                        isOrdersExpanded ? "text-base line-clamp-4" : "text-sm line-clamp-2"
                      )}>
                        {item.description}
                      </p>
                    )}

                    {/* Show variations preview */}
                    {item.item_variations && item.item_variations.length > 0 && (
                      <div className={cn(
                        "text-xs text-gray-500",
                        isOrdersExpanded ? "mb-3" : "mb-2"
                      )}>
                        <span className="font-medium">Variations: </span>
                        {item.item_variations.slice(0, isOrdersExpanded ? 3 : 2).map((variation, index) => (
                          <span key={variation.id}>
                            {variation.name}
                            {index < Math.min(item.item_variations.length, isOrdersExpanded ? 3 : 2) - 1 && ', '}
                          </span>
                        ))}
                        {item.item_variations.length > (isOrdersExpanded ? 3 : 2) && '...'}
                      </div>
                    )}
                  </div>
                  
                  <div className={cn(
                    "flex justify-between items-center mt-auto",
                    isOrdersExpanded ? "pt-4" : "pt-3"
                  )}>
                    <span className={cn(
                      "font-bold text-orange-600",
                      isOrdersExpanded ? "text-2xl" : "text-lg"
                    )}>
                      R{parseFloat(item.price || 0).toFixed(2)}
                    </span>
                    
                    <Button
                      size="sm"
                      className={cn(
                        "bg-orange-500 hover:bg-orange-600 text-white p-0 rounded-full flex-shrink-0 shadow-md hover:shadow-lg transition-all",
                        isOrdersExpanded ? "h-12 w-12" : "h-9 w-9"
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        addToCart(item);
                      }}
                    >
                      <Plus className={cn(isOrdersExpanded ? "w-5 h-5" : "w-3.5 h-3.5")} />
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