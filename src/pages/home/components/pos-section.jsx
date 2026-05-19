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

// Pick a food emoji for an item. Tries name keywords first, then falls back
// to the item's category name. A new keyword takes a few seconds to add —
// extend the list as new menu items appear.
const ITEM_EMOJI_KEYWORDS = [
  { match: /burger|patty|cheeseburger/i, emoji: '🍔' },
  { match: /pizza/i, emoji: '🍕' },
  { match: /fries|chips/i, emoji: '🍟' },
  { match: /onion ring/i, emoji: '🧅' },
  { match: /sweet potato/i, emoji: '🍠' },
  { match: /chicken|wing|nugget/i, emoji: '🍗' },
  { match: /salad|veggie|lettuce/i, emoji: '🥗' },
  { match: /hot dog|sausage/i, emoji: '🌭' },
  { match: /taco/i, emoji: '🌮' },
  { match: /burrito|wrap/i, emoji: '🌯' },
  { match: /sushi|roll/i, emoji: '🍣' },
  { match: /noodle|ramen|pasta/i, emoji: '🍜' },
  { match: /rice/i, emoji: '🍚' },
  { match: /coke|cola|pepsi|soda|sprite|fanta/i, emoji: '🥤' },
  { match: /water/i, emoji: '💧' },
  { match: /coffee|espresso|latte|cappuccino/i, emoji: '☕' },
  { match: /tea/i, emoji: '🍵' },
  { match: /beer|lager|stout/i, emoji: '🍺' },
  { match: /wine/i, emoji: '🍷' },
  { match: /juice/i, emoji: '🧃' },
  { match: /milkshake|shake/i, emoji: '🥛' },
  { match: /ice cream|gelato|sundae/i, emoji: '🍨' },
  { match: /brownie|cake|cupcake/i, emoji: '🍰' },
  { match: /donut|doughnut/i, emoji: '🍩' },
  { match: /cookie|biscuit/i, emoji: '🍪' },
  { match: /chocolate/i, emoji: '🍫' },
  { match: /fruit|apple/i, emoji: '🍎' },
];
const CATEGORY_EMOJI = {
  burgers: '🍔',
  sides: '🍟',
  drinks: '🥤',
  desserts: '🍰',
  pizza: '🍕',
  salads: '🥗',
  chicken: '🍗',
  breakfast: '🍳',
  seafood: '🦐',
  coffee: '☕',
  alcohol: '🍺',
};
function emojiForItem(item) {
  const name = item?.name || '';
  for (const { match, emoji } of ITEM_EMOJI_KEYWORDS) {
    if (match.test(name)) return emoji;
  }
  const cat = (item?.categories?.name || '').toLowerCase().trim();
  if (CATEGORY_EMOJI[cat]) return CATEGORY_EMOJI[cat];
  return '🍽️';
}

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
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-2">
          <Button
            variant={selectedCategory === 'all' ? 'default' : 'outline'}
            onClick={() => setSelectedCategory('all')}
            className={cn(
              "flex items-center justify-center h-9 px-3 rounded-full font-medium transition-all text-sm w-full min-w-0",
              selectedCategory === 'all'
                ? "bg-orange-500 hover:bg-orange-600 text-white shadow-md"
                : "border-orange-200 text-gray-700 hover:bg-orange-50 hover:border-orange-300"
            )}
          >
            <Filter className="w-3 h-3 flex-shrink-0 mr-1.5" />
            <span className="truncate">All Items</span>
          </Button>
          {categories.map((category) => (
            <Button
              key={category.id}
              variant={selectedCategory === category.id ? 'default' : 'outline'}
              onClick={() => setSelectedCategory(category.id)}
              className={cn(
                "flex items-center justify-center h-9 px-3 rounded-full font-medium transition-all text-sm w-full min-w-0",
                selectedCategory === category.id
                  ? "bg-orange-500 hover:bg-orange-600 text-white shadow-md"
                  : "border-orange-200 text-gray-700 hover:bg-orange-50 hover:border-orange-300"
              )}
            >
              <span className="truncate" title={category.name}>{category.name}</span>
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
                className="group relative overflow-hidden border border-gray-200/80 bg-white rounded-2xl shadow-sm hover:shadow-xl hover:border-orange-300 cursor-pointer transition-all duration-300 ease-out hover:-translate-y-1"
                onClick={() => addToCart(item)}
              >
                <CardContent className={cn(
                  "flex flex-col p-0",
                  isOrdersExpanded ? "h-72" : "h-52"
                )}>
                  {/* Emoji "image" tile — soft warm gradient backdrop */}
                  <div
                    className={cn(
                      "relative flex items-center justify-center bg-gradient-to-br from-orange-50 via-amber-50 to-orange-100/60",
                      isOrdersExpanded ? "h-32" : "h-20"
                    )}
                  >
                    <span
                      className={cn(
                        "leading-none select-none transition-transform duration-300 ease-out group-hover:scale-110 group-hover:-rotate-3",
                        isOrdersExpanded ? "text-6xl" : "text-4xl"
                      )}
                      aria-hidden="true"
                    >
                      {emojiForItem(item)}
                    </span>
                  </div>

                  {/* Body */}
                  <div className={cn(
                    "flex flex-col flex-1 min-h-0",
                    isOrdersExpanded ? "px-5 pt-4 pb-4" : "px-3.5 pt-3 pb-3"
                  )}>
                    <div className="flex-1 min-h-0">
                      <h3 className={cn(
                        "font-semibold text-gray-900 leading-snug tracking-tight",
                        isOrdersExpanded ? "text-lg line-clamp-2" : "text-sm line-clamp-2"
                      )}>
                        {item.name}
                      </h3>

                      {item.description && (
                        <p className={cn(
                          "text-gray-500 leading-relaxed mt-1",
                          isOrdersExpanded ? "text-sm line-clamp-2" : "text-xs line-clamp-1"
                        )}>
                          {item.description}
                        </p>
                      )}

                      {item.item_variations && item.item_variations.length > 0 && (
                        <p className={cn(
                          "mt-1.5 inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-orange-700/80 bg-orange-50 px-1.5 py-0.5 rounded-full",
                          isOrdersExpanded && "text-xs px-2 py-0.5"
                        )}>
                          {item.item_variations.length} option{item.item_variations.length === 1 ? '' : 's'}
                        </p>
                      )}
                    </div>

                    {/* Price + add — locked to bottom */}
                    <div className={cn(
                      "flex justify-between items-center mt-2 pt-2 border-t border-gray-100"
                    )}>
                      <div className="flex flex-col leading-none">
                        <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-0.5">Price</span>
                        <span className={cn(
                          "font-bold text-gray-900 tabular-nums",
                          isOrdersExpanded ? "text-xl" : "text-base"
                        )}>
                          R{parseFloat(item.price || 0).toFixed(2)}
                        </span>
                      </div>

                      <Button
                        size="sm"
                        aria-label={`Add ${item.name} to cart`}
                        className={cn(
                          "bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white p-0 rounded-full flex-shrink-0 shadow-sm hover:shadow-md transition-all duration-200 group-hover:scale-110",
                          isOrdersExpanded ? "h-11 w-11" : "h-8 w-8"
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          addToCart(item);
                        }}
                      >
                        <Plus className={cn(isOrdersExpanded ? "w-5 h-5" : "w-4 h-4")} strokeWidth={2.5} />
                      </Button>
                    </div>
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