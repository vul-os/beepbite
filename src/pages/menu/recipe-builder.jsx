import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { 
  TreePine, 
  Plus,
  Minus,
  Trash2,
  Save,
  X,
  Calculator,
  Layers,
  DollarSign,
  Package,
  ChefHat,
  Utensils,
  Hash,
  AlertCircle,
  CheckCircle,
  Info,
  ArrowRight,
  ArrowDown,
  GripVertical,
  Search,
  Filter,
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useMoney } from '@/context/locale-context';
import { supabase } from '@/services/supabase-client';
import { cn } from "@/lib/utils";
import { COMPLEXITY_COLORS } from '@/lib/status-colors';

const RecipeBuilder = ({ 
  item, 
  onClose, 
  onSave,
  availableItems = []
}) => {
  const [components, setComponents] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draggedItem, setDraggedItem] = useState(null);
  const [errors, setErrors] = useState([]);
  const [recipeStats, setRecipeStats] = useState({
    totalCost: 0,
    totalComponents: 0,
    maxLevel: 0,
    complexity: 'simple'
  });
  const [showOnlyUsed, setShowOnlyUsed] = useState(false);
  const { format: formatMoneyValue, scale: currencyScaleValue } = useMoney();

  useEffect(() => {
    if (item) {
      fetchRecipeComponents();
    }
  }, [item]);

  useEffect(() => {
    calculateRecipeStats();
  }, [components]);

  const fetchRecipeComponents = async () => {
    if (!item?.id) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('item_recipes')
        .select(`
          *,
          child_item:items!item_recipes_child_item_id_fkey (
            id,
            name,
            price,
            cost_price,
            recipe_type,
            max_recipe_level,
            recipe_complexity,
            categories (
              id,
              name
            )
          )
        `)
        .eq('parent_item_id', item.id)
        .order('recipe_level', { ascending: true })
        .order('created_at', { ascending: true });
      
      if (error) throw error;
      setComponents(data || []);
    } catch (error) {
      console.error('Error fetching recipe components:', error);
      setErrors(['Failed to load recipe components']);
    } finally {
      setLoading(false);
    }
  };

  const calculateRecipeStats = () => {
    let totalCost = 0;
    let maxLevel = 0;
    
    components.forEach(component => {
      const componentCost = (component.quantity_needed || 0) * (component.cost_per_unit || component.child_item?.cost_price || 0);
      totalCost += componentCost;
      
      const componentLevel = (component.child_item?.max_recipe_level || 0) + 1;
      maxLevel = Math.max(maxLevel, componentLevel);
    });

    let complexity = 'simple';
    if (maxLevel > 2 || components.length > 5) {
      complexity = 'complex';
    } else if (maxLevel > 1 || components.length > 2) {
      complexity = 'moderate';
    }

    setRecipeStats({
      totalCost,
      totalComponents: components.length,
      maxLevel,
      complexity
    });
  };

  const validateRecipe = () => {
    const newErrors = [];
    
    // Check for circular dependencies
    const hasCircularDep = components.some(comp => comp.child_item_id === item.id);
    if (hasCircularDep) {
      newErrors.push('Recipe cannot include itself as a component');
    }
    
    // Check for missing quantities
    const missingQuantities = components.filter(comp => !comp.quantity_needed || comp.quantity_needed <= 0);
    if (missingQuantities.length > 0) {
      newErrors.push(`${missingQuantities.length} component(s) are missing valid quantities`);
    }
    
    // Check for duplicate components
    const componentIds = components.map(comp => comp.child_item_id);
    const uniqueIds = new Set(componentIds);
    if (componentIds.length !== uniqueIds.size) {
      newErrors.push('Recipe contains duplicate components');
    }
    
    setErrors(newErrors);
    return newErrors.length === 0;
  };

  const addComponent = (selectedItem) => {
    if (!selectedItem || components.some(comp => comp.child_item_id === selectedItem.id)) {
      return; // Already added or invalid
    }

    const newComponent = {
      id: `temp_${Date.now()}`, // Temporary ID for new components
      parent_item_id: item.id,
      child_item_id: selectedItem.id,
      quantity_needed: 1,
      unit: 'piece',
      cost_per_unit: selectedItem.cost_price || 0,
      notes: '',
      child_item: selectedItem,
      isNew: true
    };

    setComponents(prev => [...prev, newComponent]);
  };

  const updateComponent = (componentId, updates) => {
    setComponents(prev => prev.map(comp => 
      comp.id === componentId 
        ? { ...comp, ...updates, isModified: true }
        : comp
    ));
  };

  const removeComponent = (componentId) => {
    setComponents(prev => prev.filter(comp => comp.id !== componentId));
  };

  const handleSave = async () => {
    if (!validateRecipe()) {
      return;
    }

    setSaving(true);
    try {
      // Delete existing components
      const { error: deleteError } = await supabase
        .from('item_recipes')
        .delete()
        .eq('parent_item_id', item.id);
      
      if (deleteError) throw deleteError;

      // Insert new/updated components
      if (components.length > 0) {
        const componentsToInsert = components.map(comp => ({
          parent_item_id: item.id,
          child_item_id: comp.child_item_id,
          quantity_needed: comp.quantity_needed,
          unit: comp.unit || 'piece',
          cost_per_unit: comp.cost_per_unit || comp.child_item?.cost_price || 0,
          notes: comp.notes || '',
          recipe_level: 1 // Will be recalculated by triggers
        }));

        const { error: insertError } = await supabase
          .from('item_recipes')
          .insert(componentsToInsert);
        
        if (insertError) throw insertError;
      }

      // Update recipe metadata
      const { error: metadataError } = await supabase.rpc('update_recipe_metadata', {
        item_uuid: item.id
      });
      
      if (metadataError) throw metadataError;

      onSave?.();
      onClose?.();
    } catch (error) {
      console.error('Error saving recipe:', error);
      setErrors(['Failed to save recipe. Please try again.']);
    } finally {
      setSaving(false);
    }
  };

  // Component costs are major-unit floats, so scale up to minor units before
  // handing them to the minor-unit-based formatter.
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

  const getComplexityColor = (complexity) => COMPLEXITY_COLORS[complexity] || 'bg-muted text-muted-foreground';

  // Filter available items - only show recipe ingredients
  const filteredAvailableItems = availableItems.filter(availableItem => {
    if (availableItem.id === item?.id) return false; // Can't add self
    if (components.some(comp => comp.child_item_id === availableItem.id)) return false; // Already added
    if (!availableItem.is_recipe_ingredient) return false; // Only show items that can be used as ingredients
    
    const matchesSearch = !searchTerm || 
      availableItem.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      availableItem.description?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesCategory = selectedCategory === 'all' || 
      availableItem.category_id === selectedCategory;
    
    return matchesSearch && matchesCategory;
  });

  if (!item) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertCircle className="h-8 w-8 text-yellow-600 mx-auto mb-4" />
          <p className="text-muted-foreground">No item selected for recipe building</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with item info */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            {getItemTypeIcon(item.recipe_type)}
            <h2 className="text-xl font-semibold text-foreground">{item.name}</h2>
            <Badge variant="outline">{item.recipe_type}</Badge>
          </div>
          {item.description && (
            <p className="text-muted-foreground text-sm">{item.description}</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold text-foreground">
            {formatCurrency(item.price)}
          </p>
          <p className="text-sm text-muted-foreground">Selling Price</p>
        </div>
      </div>

      {/* Recipe Stats */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-foreground">{recipeStats.totalComponents}</p>
              <p className="text-sm text-muted-foreground">Components</p>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-foreground">{recipeStats.maxLevel}</p>
              <p className="text-sm text-muted-foreground">Max Level</p>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="text-center">
              <p className={cn("inline-block rounded-lg px-3 py-0.5 text-2xl font-bold", getComplexityColor(recipeStats.complexity))}>
                {recipeStats.complexity}
              </p>
              <p className="text-sm text-muted-foreground">Complexity</p>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-foreground">
                {formatCurrency(recipeStats.totalCost)}
              </p>
              <p className="text-sm text-muted-foreground">Total Cost</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Errors */}
      {errors.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Recipe Validation Errors</AlertTitle>
          <AlertDescription>
            <ul className="list-disc list-inside space-y-1">
              {errors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Current Recipe Components */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle className="flex items-center gap-2">
              <TreePine className="h-5 w-5" />
              Recipe Components ({components.length})
            </CardTitle>
            <div className="text-sm text-muted-foreground">
              Total: {formatCurrency(recipeStats.totalCost)}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
              </div>
            ) : components.length === 0 ? (
              <div className="text-center py-8">
                <Package className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-muted-foreground">No components added yet</p>
                <p className="text-sm text-muted-foreground">Add items from the available items list</p>
              </div>
            ) : (
              components.map((component, index) => (
                <div
                  key={component.id}
                  className="flex items-center gap-3 p-3 border border-border rounded-lg hover:border-border transition-colors"
                >
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <GripVertical className="h-4 w-4" />
                    <span className="text-xs">{index + 1}</span>
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {getItemTypeIcon(component.child_item?.recipe_type)}
                      <span className="font-medium text-foreground truncate">
                        {component.child_item?.name}
                      </span>
                      {component.child_item?.max_recipe_level > 0 && (
                        <Badge variant="outline" className="text-xs">
                          <Layers className="h-3 w-3 mr-1" />
                          L{component.child_item.max_recipe_level}
                        </Badge>
                      )}
                    </div>
                    
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <Label className="text-xs text-muted-foreground">Quantity</Label>
                        <Input
                          type="number"
                          step="0.001"
                          min="0"
                          value={component.quantity_needed || ''}
                          onChange={(e) => updateComponent(component.id, {
                            quantity_needed: parseFloat(e.target.value) || 0
                          })}
                          className="h-8 text-xs"
                          placeholder="0"
                        />
                      </div>
                      
                      <div>
                        <Label className="text-xs text-muted-foreground">Unit</Label>
                        <Input
                          value={component.unit || ''}
                          onChange={(e) => updateComponent(component.id, {
                            unit: e.target.value
                          })}
                          className="h-8 text-xs"
                          placeholder="piece"
                        />
                      </div>
                      
                      <div>
                        <Label className="text-xs text-muted-foreground">Cost/Unit</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={component.cost_per_unit || ''}
                          onChange={(e) => updateComponent(component.id, {
                            cost_per_unit: parseFloat(e.target.value) || 0
                          })}
                          className="h-8 text-xs"
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between mt-2">
                      <div className="text-xs text-muted-foreground">
                        Subtotal: {formatCurrency((component.quantity_needed || 0) * (component.cost_per_unit || 0))}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => removeComponent(component.id)}
                        className="h-6 w-6 p-0 text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Available Items */}
        <Card>
          <CardHeader className="space-y-4">
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Available Items
            </CardTitle>
            
            {/* Search and Filter */}
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input
                  placeholder="Search items..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 h-9"
                />
              </div>
              
              <div className="flex items-center gap-2">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="show-only-used"
                    checked={showOnlyUsed}
                    onCheckedChange={setShowOnlyUsed}
                  />
                  <Label htmlFor="show-only-used" className="text-xs">Show only used in recipes</Label>
                </div>
              </div>
            </div>
          </CardHeader>
          
          <CardContent className="max-h-96 overflow-y-auto space-y-2">
            {filteredAvailableItems.length === 0 ? (
              <div className="text-center py-8">
                <Search className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-muted-foreground">No items found</p>
                <p className="text-sm text-muted-foreground">Try adjusting your search criteria</p>
              </div>
            ) : (
              filteredAvailableItems.map((availableItem) => (
                <div
                  key={availableItem.id}
                  className="flex items-center justify-between p-3 border border-border rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors cursor-pointer"
                  onClick={() => addComponent(availableItem)}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {getItemTypeIcon(availableItem.recipe_type)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-foreground truncate">
                          {availableItem.name}
                        </p>
                        <Badge variant="outline" className="text-xs">
                          {availableItem.recipe_type}
                        </Badge>
                        {availableItem.max_recipe_level > 0 && (
                          <Badge variant="outline" className="text-xs">
                            <Layers className="h-3 w-3 mr-1" />
                            L{availableItem.max_recipe_level}
                          </Badge>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>{formatCurrency(availableItem.price)}</span>
                        {availableItem.cost_price > 0 && (
                          <span>Cost: {formatCurrency(availableItem.cost_price)}</span>
                        )}
                        {availableItem.categories && (
                          <span>{availableItem.categories.name}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 w-8 p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      addComponent(availableItem);
                    }}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recipe Notes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recipe Notes & Instructions</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="Add preparation notes, special instructions, or recipe details..."
            rows={3}
            className="resize-none"
          />
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex items-center justify-between pt-4 border-t border-border">
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1">
            <Hash className="h-4 w-4" />
            <span>{components.length} components</span>
          </div>
          <div className="flex items-center gap-1">
            <Calculator className="h-4 w-4" />
            <span>Total cost: {formatCurrency(recipeStats.totalCost)}</span>
          </div>
          <div className="flex items-center gap-1">
            <Layers className="h-4 w-4" />
            <span>Max level: {recipeStats.maxLevel}</span>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button 
            onClick={handleSave} 
            disabled={saving || errors.length > 0}
            className="flex items-center gap-2"
          >
            {saving ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Save Recipe
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default RecipeBuilder; 