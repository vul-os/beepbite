import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { 
  TreePine, 
  ChevronRight,
  ChevronDown,
  Package,
  ChefHat,
  Utensils,
  Search,
  Filter,
  Layers,
  Hash,
  DollarSign,
  Calculator,
  ArrowRight,
  CircleDot,
  Minus,
  Plus,
  Eye,
  EyeOff
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useMoney } from '@/context/locale-context';
import { supabase } from '@/services/supabase-client';
import { cn } from "@/lib/utils";

const RecipeBreakdown = ({ activeLocation }) => {
  const { format: formatMoneyValue, scale: currencyScaleValue } = useMoney();
  const [breakdownData, setBreakdownData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRecipe, setSelectedRecipe] = useState('all');
  const [expandedItems, setExpandedItems] = useState(new Set());
  const [showCosts, setShowCosts] = useState(true);
  const [showOnlyRecipes, setShowOnlyRecipes] = useState(false);
  const [recipes, setRecipes] = useState([]);

  useEffect(() => {
    if (activeLocation) {
      fetchBreakdownData();
      fetchRecipes();
    }
  }, [activeLocation]);

  const fetchRecipes = async () => {
    if (!activeLocation) return;
    
    try {
      const { data, error } = await supabase
        .from('items')
        .select('id, name, recipe_type')
        .eq('location_id', activeLocation.id)
        .eq('recipe_type', 'recipe')
        .order('name', { ascending: true });
      
      if (error) throw error;
      setRecipes(data || []);
    } catch (error) {
      console.error('Error fetching recipes:', error);
    }
  };

  const fetchBreakdownData = async () => {
    if (!activeLocation) return;
    
    setLoading(true);
    try {
      // Use the recipe_breakdown view we created in the SQL
      const { data, error } = await supabase
        .from('recipe_breakdown')
        .select('*')
        .order('parent_item_name', { ascending: true })
        .order('level_depth', { ascending: true })
        .order('component_name', { ascending: true });
      
      if (error) throw error;
      setBreakdownData(data || []);
    } catch (error) {
      console.error('Error fetching breakdown data:', error);
      // Fallback to manual query if view doesn't exist
      await fetchBreakdownDataFallback();
    } finally {
      setLoading(false);
    }
  };

  const fetchBreakdownDataFallback = async () => {
    try {
      // Get all items with their recipe relationships
      const { data: items, error: itemsError } = await supabase
        .from('items')
        .select(`
          id,
          name,
          price,
          cost_price,
          recipe_type,
          max_recipe_level,
          total_components,
          recipe_complexity
        `)
        .eq('location_id', activeLocation.id)
        .neq('recipe_type', 'simple');

      if (itemsError) throw itemsError;

      // Get all recipe relationships
      const { data: relationships, error: relError } = await supabase
        .from('item_recipes')
        .select(`
          parent_item_id,
          child_item_id,
          quantity_needed,
          unit,
          cost_per_unit,
          recipe_level,
          child_item:items!item_recipes_child_item_id_fkey (
            id,
            name,
            price,
            cost_price,
            recipe_type
          )
        `);

      if (relError) throw relError;

      // Transform into breakdown format
      const breakdown = [];
      items.forEach(item => {
        const itemRelationships = relationships.filter(rel => rel.parent_item_id === item.id);
        
        itemRelationships.forEach(rel => {
          breakdown.push({
            parent_item_id: item.id,
            parent_item_name: item.name,
            recipe_complexity: item.recipe_complexity,
            max_recipe_level: item.max_recipe_level,
            total_components: item.total_components,
            component_item_id: rel.child_item_id,
            component_name: rel.child_item.name,
            total_quantity: rel.quantity_needed,
            unit: rel.unit,
            level_depth: rel.recipe_level,
            cost_contribution: (rel.quantity_needed || 0) * (rel.cost_per_unit || rel.child_item.cost_price || 0),
            cost_percentage: 0 // Will be calculated
          });
        });
      });

      setBreakdownData(breakdown);
    } catch (error) {
      console.error('Error in fallback breakdown fetch:', error);
    }
  };

  // Cost contributions are major-unit floats, so scale up to minor units
  // before handing them to the minor-unit-based formatter.
  const formatCurrency = (amount) => {
    return formatMoneyValue(Math.round((amount || 0) * currencyScaleValue));
  };

  const getItemTypeIcon = (type) => {
    switch (type) {
      case 'recipe': return <ChefHat className="h-4 w-4" />;
      case 'component': return <Package className="h-4 w-4" />;
      default: return <Utensils className="h-4 w-4" />;
    }
  };

  const getComplexityColor = (complexity) => {
    switch (complexity) {
      case 'simple': return 'bg-green-100 text-green-800';
      case 'moderate': return 'bg-yellow-100 text-yellow-800';
      case 'complex': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getLevelIndentation = (level) => {
    return `${level * 24}px`;
  };

  const toggleExpanded = (itemId) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(itemId)) {
      newExpanded.delete(itemId);
    } else {
      newExpanded.add(itemId);
    }
    setExpandedItems(newExpanded);
  };

  // Group breakdown data by parent item
  const groupedBreakdown = breakdownData.reduce((acc, item) => {
    if (!acc[item.parent_item_id]) {
      acc[item.parent_item_id] = {
        parentInfo: {
          id: item.parent_item_id,
          name: item.parent_item_name,
          complexity: item.recipe_complexity,
          maxLevel: item.max_recipe_level,
          totalComponents: item.total_components
        },
        components: []
      };
    }
    acc[item.parent_item_id].components.push(item);
    return acc;
  }, {});

  // Filter data
  const filteredBreakdown = Object.entries(groupedBreakdown).filter(([parentId, group]) => {
    const matchesSearch = !searchTerm || 
      group.parentInfo.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      group.components.some(comp => comp.component_name.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesRecipe = selectedRecipe === 'all' || parentId === selectedRecipe;
    
    return matchesSearch && matchesRecipe;
  });

  if (!activeLocation) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <TreePine className="h-8 w-8 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600">Please select a location to view recipe breakdown</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Search recipes or components..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            
            <Select value={selectedRecipe} onValueChange={setSelectedRecipe}>
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue placeholder="All Recipes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Recipes</SelectItem>
                {recipes.map((recipe) => (
                  <SelectItem key={recipe.id} value={recipe.id}>
                    {recipe.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <div className="flex items-center gap-4">
              <div className="flex items-center space-x-2">
                <Switch
                  id="show-costs"
                  checked={showCosts}
                  onCheckedChange={setShowCosts}
                />
                <Label htmlFor="show-costs" className="text-sm">Show costs</Label>
              </div>
              
              <div className="flex items-center space-x-2">
                <Switch
                  id="show-only-recipes"
                  checked={showOnlyRecipes}
                  onCheckedChange={setShowOnlyRecipes}
                />
                <Label htmlFor="show-only-recipes" className="text-sm">Recipes only</Label>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Breakdown Tree */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TreePine className="h-5 w-5" />
            Recipe Breakdown Tree
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mr-3"></div>
              <span className="text-gray-600">Loading breakdown data...</span>
            </div>
          ) : filteredBreakdown.length === 0 ? (
            <div className="text-center py-12">
              <TreePine className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No breakdown data found</h3>
              <p className="text-gray-600">
                {breakdownData.length === 0 
                  ? 'No recipes with components found. Create some recipes first.'
                  : 'No items match your current filters. Try adjusting your search criteria.'
                }
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredBreakdown.map(([parentId, group]) => {
                const isExpanded = expandedItems.has(parentId);
                const totalCost = group.components.reduce((sum, comp) => sum + (comp.cost_contribution || 0), 0);
                
                return (
                  <div key={parentId} className="border border-gray-200 rounded-lg overflow-hidden">
                    {/* Parent Recipe Header */}
                    <div 
                      className="flex items-center gap-3 p-4 bg-gray-50 hover:bg-gray-100 cursor-pointer transition-colors"
                      onClick={() => toggleExpanded(parentId)}
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </Button>
                      
                      <div className="flex items-center gap-2">
                        <ChefHat className="h-5 w-5 text-blue-600" />
                        <span className="font-semibold text-gray-900">{group.parentInfo.name}</span>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className={getComplexityColor(group.parentInfo.complexity)}>
                          {group.parentInfo.complexity}
                        </Badge>
                        
                        <Badge variant="outline" className="text-xs">
                          <Layers className="h-3 w-3 mr-1" />
                          Level {group.parentInfo.maxLevel}
                        </Badge>
                        
                        <Badge variant="outline" className="text-xs">
                          <Hash className="h-3 w-3 mr-1" />
                          {group.parentInfo.totalComponents} components
                        </Badge>
                      </div>
                      
                      {showCosts && (
                        <div className="ml-auto">
                          <span className="text-lg font-semibold text-gray-900">
                            {formatCurrency(totalCost)}
                          </span>
                          <span className="text-sm text-gray-600 ml-2">total cost</span>
                        </div>
                      )}
                    </div>
                    
                    {/* Components List */}
                    {isExpanded && (
                      <div className="divide-y divide-gray-100">
                        {group.components
                          .sort((a, b) => a.level_depth - b.level_depth || a.component_name.localeCompare(b.component_name))
                          .map((component, index) => (
                          <div 
                            key={`${component.component_item_id}-${index}`}
                            className="flex items-center gap-3 p-3 hover:bg-gray-50 transition-colors"
                            style={{ paddingLeft: `${20 + (component.level_depth * 24)}px` }}
                          >
                            <div className="flex items-center gap-2 text-gray-400">
                              <div className="w-4 h-4 flex items-center justify-center">
                                {component.level_depth === 1 ? (
                                  <CircleDot className="h-2 w-2" />
                                ) : (
                                  <Minus className="h-3 w-3" />
                                )}
                              </div>
                              <span className="text-xs min-w-[20px]">L{component.level_depth}</span>
                            </div>
                            
                            <div className="flex items-center gap-2 flex-1">
                              {getItemTypeIcon('component')}
                              <span className="font-medium text-gray-800">{component.component_name}</span>
                            </div>
                            
                            <div className="flex items-center gap-4 text-sm text-gray-600">
                              <div className="flex items-center gap-1">
                                <span className="font-medium">{component.total_quantity}</span>
                                <span>{component.unit}</span>
                              </div>
                              
                              {showCosts && (
                                <>
                                  <div className="flex items-center gap-1">
                                    <Calculator className="h-3 w-3" />
                                    <span>{formatCurrency(component.cost_contribution)}</span>
                                  </div>
                                  
                                  {component.cost_percentage > 0 && (
                                    <div className="flex items-center gap-1">
                                      <span>{component.cost_percentage.toFixed(1)}%</span>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Summary Stats */}
      {filteredBreakdown.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-gray-900">
                  {filteredBreakdown.length}
                </p>
                <p className="text-sm text-gray-600">Recipes Analyzed</p>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-gray-900">
                  {filteredBreakdown.reduce((sum, [, group]) => sum + group.components.length, 0)}
                </p>
                <p className="text-sm text-gray-600">Total Components</p>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-gray-900">
                  {Math.max(...filteredBreakdown.map(([, group]) => group.parentInfo.maxLevel))}
                </p>
                <p className="text-sm text-gray-600">Max Recipe Depth</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default RecipeBreakdown; 