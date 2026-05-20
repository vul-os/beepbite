import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { 
  UtensilsCrossed, 
  Search, 
  Plus,
  Edit,
  Trash2,
  Eye,
  EyeOff,
  Clock,
  Package,
  AlertCircle,
  CheckCircle,
  XCircle,
  MapPin,
  Filter,
  ChefHat,
  Minus,
  ArrowUp,
  ArrowDown,
  Sparkles,
  Zap,
  TreePine,
  Calculator,
  Layers,
  Target,
  DollarSign,
  Utensils,
  FlaskConical,
  MoreHorizontal,
  ChevronRight,
  ChevronDown,
  Hash,
  TrendingUp,
  TrendingDown,
  CircleDot
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/services/supabase-client';
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from 'date-fns';
// Import recipe components
import RecipeBuilder from './recipe-builder';
import RecipeBreakdown from './recipe-breakdown';
import CostAnalysis from './cost-analysis';
import PrepStepsEditor from './prep-steps-editor';
import ModifierGroupsEditor from './modifier-groups-editor';

const Menu = () => {
  const { activeLocation } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [recipeBreakdown, setRecipeBreakdown] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [recipeTypeFilter, setRecipeTypeFilter] = useState('all');
  const [complexityFilter, setComplexityFilter] = useState('all');
  const [itemUsageFilter, setItemUsageFilter] = useState('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isRecipeBuilderOpen, setIsRecipeBuilderOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [buildingRecipe, setBuildingRecipe] = useState(null);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [expandedRecipes, setExpandedRecipes] = useState(new Set());
  const [activeTab, setActiveTab] = useState('overview');
  
  // Enhanced form data for recipes
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
    cost_price: '',
    category_id: '',
    preparation_time: 15,
    sort_order: 0,
    is_active: true,
    track_inventory: false,
    current_stock: 0,
    low_stock_threshold: 5,
    recipe_type: 'simple',
    auto_calculate_cost: false,
    is_recipe_ingredient: false
  });

  // Recipe builder data
  const [recipeComponents, setRecipeComponents] = useState([]);
  const [availableItems, setAvailableItems] = useState([]);

  useEffect(() => {
    if (activeLocation) {
      fetchData();
    } else {
      resetData();
    }
  }, [activeLocation]);

  const resetData = () => {
    setItems([]);
    setCategories([]);
    setRecipes([]);
    setRecipeBreakdown([]);
    setLoading(false);
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        fetchItems(),
        fetchCategories(),
        fetchRecipeBreakdown()
      ]);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchItems = async () => {
    if (!activeLocation) return;
    
    try {
      const { data, error } = await supabase
        .from('items')
        .select(`
          *,
          categories (
            id,
            name,
            parent_id
          )
        `)
        .eq('location_id', activeLocation.id)
        .order('recipe_complexity', { ascending: false })
        .order('max_recipe_level', { ascending: false })
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      
      if (error) throw error;
      setItems(data || []);
      
      // Separate into different arrays for easier filtering
      const allRecipes = data?.filter(item => item.recipe_type !== 'simple') || [];
      setRecipes(allRecipes);
      
      // Available items for recipe building (exclude the item being edited)
      const available = data?.filter(item => 
        item.id !== buildingRecipe?.id && item.is_active
      ) || [];
      setAvailableItems(available);
      
    } catch (error) {
      console.error('Error fetching items:', error);
    }
  };

  const fetchCategories = async () => {
    if (!activeLocation) return;
    
    try {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .eq('location_id', activeLocation.id)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      
      if (error) throw error;
      setCategories(data || []);
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  };

  const fetchRecipeBreakdown = async () => {
    if (!activeLocation) return;
    
    try {
      const { data, error } = await supabase
        .from('recipe_breakdown')
        .select('*')
        .order('parent_item_name', { ascending: true })
        .order('level_depth', { ascending: true });
      
      if (error) throw error;
      setRecipeBreakdown(data || []);
    } catch (error) {
      console.error('Error fetching recipe breakdown:', error);
    }
  };

  const fetchRecipeComponents = async (itemId) => {
    if (!itemId) return;
    
    try {
      const { data, error } = await supabase
        .from('item_recipes')
        .select(`
          *,
          child_item:child_item_id (
            id,
            name,
            price,
            cost_price,
            recipe_type,
            max_recipe_level
          )
        `)
        .eq('parent_item_id', itemId)
        .order('recipe_level', { ascending: true })
        .order('created_at', { ascending: true });
      
      if (error) throw error;
      setRecipeComponents(data || []);
    } catch (error) {
      console.error('Error fetching recipe components:', error);
    }
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      price: '',
      cost_price: '',
      category_id: '',
      preparation_time: 15,
      sort_order: 0,
      is_active: true,
      track_inventory: false,
      current_stock: 0,
      low_stock_threshold: 5,
      recipe_type: 'simple',
      auto_calculate_cost: false,
      is_recipe_ingredient: false
    });
  };

  const addItem = async () => {
    if (!activeLocation || !formData.name.trim() || !formData.price || !formData.category_id) {
      alert('Please fill in all required fields');
      return;
    }
    
    setSaving(true);
    try {
      const itemData = {
        location_id: activeLocation.id,
        category_id: formData.category_id,
        name: formData.name.trim(),
        description: formData.description.trim() || null,
        price: parseFloat(formData.price),
        cost_price: formData.cost_price ? parseFloat(formData.cost_price) : null,
        preparation_time: parseInt(formData.preparation_time) || 15,
        sort_order: parseInt(formData.sort_order) || 0,
        is_active: formData.is_active,
        track_inventory: formData.track_inventory,
        current_stock: formData.track_inventory ? parseInt(formData.current_stock) || 0 : 0,
        low_stock_threshold: formData.track_inventory ? parseInt(formData.low_stock_threshold) || 5 : 5,
        recipe_type: formData.recipe_type,
        auto_calculate_cost: formData.auto_calculate_cost,
        is_recipe_ingredient: formData.is_recipe_ingredient
      };

      const { data, error } = await supabase
        .from('items')
        .insert(itemData)
        .select()
        .single();

      if (error) throw error;

      setIsAddModalOpen(false);
      resetForm();
      await fetchData();
      alert('Menu item added successfully!');
    } catch (error) {
      console.error('Error adding item:', error);
      alert(error.message || 'Failed to add menu item');
    } finally {
      setSaving(false);
    }
  };

  const editItem = async () => {
    if (!editingItem || !formData.name.trim() || !formData.price || !formData.category_id) {
      alert('Please fill in all required fields');
      return;
    }
    
    setSaving(true);
    try {
      const itemData = {
        category_id: formData.category_id,
        name: formData.name.trim(),
        description: formData.description.trim() || null,
        price: parseFloat(formData.price),
        cost_price: formData.cost_price ? parseFloat(formData.cost_price) : null,
        preparation_time: parseInt(formData.preparation_time) || 15,
        sort_order: parseInt(formData.sort_order) || 0,
        is_active: formData.is_active,
        track_inventory: formData.track_inventory,
        current_stock: formData.track_inventory ? parseInt(formData.current_stock) || 0 : 0,
        low_stock_threshold: formData.track_inventory ? parseInt(formData.low_stock_threshold) || 5 : 5,
        recipe_type: formData.recipe_type,
        auto_calculate_cost: formData.auto_calculate_cost,
        is_recipe_ingredient: formData.is_recipe_ingredient,
        updated_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('items')
        .update(itemData)
        .eq('id', editingItem.id);

      if (error) throw error;

      setIsEditModalOpen(false);
      setEditingItem(null);
      resetForm();
      await fetchData();
      alert('Menu item updated successfully!');
    } catch (error) {
      console.error('Error updating item:', error);
      alert(error.message || 'Failed to update menu item');
    } finally {
      setSaving(false);
    }
  };

  const deleteItem = async (item) => {
    if (!confirm(`Are you sure you want to delete "${item.name}"? This action cannot be undone.`)) return;
    
    setActionLoading(item.id);
    try {
      const { error } = await supabase
        .from('items')
        .delete()
        .eq('id', item.id);
      
      if (error) throw error;
      await fetchData();
      alert('Menu item deleted successfully');
    } catch (error) {
      console.error('Error deleting item:', error);
      alert('Failed to delete menu item');
    } finally {
      setActionLoading('');
    }
  };

  const toggleItemStatus = async (item) => {
    setActionLoading(item.id);
    try {
      const { error } = await supabase
        .from('items')
        .update({ 
          is_active: !item.is_active,
          updated_at: new Date().toISOString()
        })
        .eq('id', item.id);
      
      if (error) throw error;
      await fetchData();
    } catch (error) {
      console.error('Error updating item status:', error);
      alert('Failed to update item status');
    } finally {
      setActionLoading('');
    }
  };

  const updateSortOrder = async (itemId, newSortOrder) => {
    setActionLoading(itemId);
    try {
      const { error } = await supabase
        .from('items')
        .update({ 
          sort_order: newSortOrder,
          updated_at: new Date().toISOString()
        })
        .eq('id', itemId);
      
      if (error) throw error;
      await fetchData();
    } catch (error) {
      console.error('Error updating sort order:', error);
      alert('Failed to update sort order');
    } finally {
      setActionLoading('');
    }
  };

  // Recipe-specific functions
  const handleRecipeBuilder = async (item) => {
    setBuildingRecipe(item);
    await fetchRecipeComponents(item.id);
    setIsRecipeBuilderOpen(true);
  };

  const updateRecipeMetadata = async (itemId) => {
    setActionLoading(itemId);
    try {
      const { error } = await supabase.rpc('update_recipe_metadata', {
        item_uuid: itemId
      });
      
      if (error) throw error;
      await fetchData();
    } catch (error) {
      console.error('Error updating recipe metadata:', error);
      alert('Failed to update recipe metadata');
    } finally {
      setActionLoading('');
    }
  };

  const toggleRecipeExpanded = (itemId) => {
    const newExpanded = new Set(expandedRecipes);
    if (newExpanded.has(itemId)) {
      newExpanded.delete(itemId);
    } else {
      newExpanded.add(itemId);
    }
    setExpandedRecipes(newExpanded);
  };

  const openEditModal = (item) => {
    setEditingItem(item);
    setFormData({
      name: item.name || '',
      description: item.description || '',
      price: item.price || '',
      cost_price: item.cost_price || '',
      category_id: item.category_id || '',
      preparation_time: item.preparation_time || 15,
      sort_order: item.sort_order || 0,
      is_active: item.is_active ?? true,
      track_inventory: item.track_inventory ?? false,
      current_stock: item.current_stock || 0,
      low_stock_threshold: item.low_stock_threshold || 5,
      recipe_type: item.recipe_type || 'simple',
      auto_calculate_cost: item.auto_calculate_cost || false,
      is_recipe_ingredient: item.is_recipe_ingredient || false
    });
    setIsEditModalOpen(true);
  };

  // Helper functions
  const calculateProfitMargin = (price, costPrice) => {
    if (!price || !costPrice) return null;
    const margin = ((price - costPrice) / price) * 100;
    return margin.toFixed(1);
  };

  const getCategoryName = (categoryId) => {
    const category = categories.find(cat => cat.id === categoryId);
    return category?.name || 'Unknown Category';
  };

  const getRecipeTypeIcon = (type) => {
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

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR'
    }).format(amount || 0);
  };

  // Enhanced filtering
  const filteredItems = items.filter(item => {
    const name = item.name?.toLowerCase() || '';
    const description = item.description?.toLowerCase() || '';
    const categoryName = getCategoryName(item.category_id).toLowerCase();
    const search = searchTerm.toLowerCase();
    
    const matchesSearch = name.includes(search) || description.includes(search) || categoryName.includes(search);
    const matchesCategory = selectedCategory === 'all' || item.category_id === selectedCategory;
    const matchesRecipeType = recipeTypeFilter === 'all' || item.recipe_type === recipeTypeFilter;
    const matchesComplexity = complexityFilter === 'all' || item.recipe_complexity === complexityFilter;
    const matchesItemUsage = itemUsageFilter === 'all' || 
      (itemUsageFilter === 'menu_item' && (item.recipe_type === 'recipe' || item.recipe_type === 'simple')) ||
      (itemUsageFilter === 'recipe_ingredient' && item.is_recipe_ingredient);
    
    return matchesSearch && matchesCategory && matchesRecipeType && matchesComplexity && matchesItemUsage;
  });

  if (!activeLocation) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <AlertCircle className="w-16 h-16 text-gray-400 mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">No Location Selected</h2>
        <p className="text-gray-600">Please select a location to manage menu items.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-12 bg-gray-200 rounded animate-pulse"></div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-32 bg-gray-200 rounded animate-pulse"></div>
          ))}
        </div>
      </div>
    );
  }

  const ItemForm = ({ isEdit = false }) => (
    <div className="space-y-4 mt-4 max-h-96 overflow-y-auto">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="name">Name *</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => handleInputChange('name', e.target.value)}
            placeholder="Enter item name"
            required
          />
        </div>
        
        <div>
          <Label htmlFor="category_id">Category *</Label>
          <Select
            value={formData.category_id}
            onValueChange={(value) => handleInputChange('category_id', value)}
            required
          >
            <SelectTrigger>
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        <div>
          <Label htmlFor="price">Selling Price *</Label>
          <Input
            id="price"
            type="number"
            step="0.01"
            min="0"
            value={formData.price}
            onChange={(e) => handleInputChange('price', e.target.value)}
            placeholder="0.00"
            required
          />
        </div>
        
        <div>
          <Label htmlFor="cost_price">Cost Price</Label>
          <Input
            id="cost_price"
            type="number"
            step="0.01"
            min="0"
            value={formData.cost_price}
            onChange={(e) => handleInputChange('cost_price', e.target.value)}
            placeholder="0.00"
          />
        </div>
        
        <div>
          <Label htmlFor="recipe_type">Recipe Type</Label>
          <Select
            value={formData.recipe_type}
            onValueChange={(value) => handleInputChange('recipe_type', value)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="simple">Simple Item</SelectItem>
              <SelectItem value="component">Component (Used in recipes)</SelectItem>
              <SelectItem value="recipe">Recipe (Made from other items)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <div>
          <Label htmlFor="preparation_time">Prep Time (minutes)</Label>
          <Input
            id="preparation_time"
            type="number"
            min="0"
            value={formData.preparation_time}
            onChange={(e) => handleInputChange('preparation_time', e.target.value)}
            placeholder="15"
          />
        </div>
      </div>
      
      <div>
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) => handleInputChange('description', e.target.value)}
          placeholder="Enter item description"
          rows={3}
        />
      </div>
      
      <div className="flex items-center space-x-6">
        <div className="flex items-center space-x-2">
          <Switch
            id="is_active"
            checked={formData.is_active}
            onCheckedChange={(checked) => handleInputChange('is_active', checked)}
          />
          <Label htmlFor="is_active">Active</Label>
        </div>
        
        <div className="flex items-center space-x-2">
          <Switch
            id="auto_calculate_cost"
            checked={formData.auto_calculate_cost}
            onCheckedChange={(checked) => handleInputChange('auto_calculate_cost', checked)}
          />
          <Label htmlFor="auto_calculate_cost">Auto-calculate cost from recipe</Label>
        </div>
        
        <div className="flex items-center space-x-2">
          <Switch
            id="track_inventory"
            checked={formData.track_inventory}
            onCheckedChange={(checked) => handleInputChange('track_inventory', checked)}
          />
          <Label htmlFor="track_inventory">Track inventory</Label>
        </div>
        
        <div className="flex items-center space-x-2">
          <Switch
            id="is_recipe_ingredient"
            checked={formData.is_recipe_ingredient}
            onCheckedChange={(checked) => handleInputChange('is_recipe_ingredient', checked)}
          />
          <Label htmlFor="is_recipe_ingredient">Recipe ingredient</Label>
        </div>
      </div>
      
      {formData.track_inventory && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="current_stock">Current Stock</Label>
            <Input
              id="current_stock"
              type="number"
              min="0"
              value={formData.current_stock}
              onChange={(e) => handleInputChange('current_stock', e.target.value)}
              placeholder="0"
            />
          </div>
          
          <div>
            <Label htmlFor="low_stock_threshold">Low Stock Alert</Label>
            <Input
              id="low_stock_threshold"
              type="number"
              min="0"
              value={formData.low_stock_threshold}
              onChange={(e) => handleInputChange('low_stock_threshold', e.target.value)}
              placeholder="5"
            />
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
            <UtensilsCrossed className="w-8 h-8 text-orange-500" />
            Menu & Recipes
          </h1>
          <p className="text-gray-600 mt-1">
            Manage menu items, recipes and their components for {activeLocation?.name}
          </p>
        </div>
        <Button onClick={() => {
          resetForm();
          setIsAddModalOpen(true);
        }} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Add Item
        </Button>
      </div>

      {/* Enhanced Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Items</p>
                <p className="text-2xl font-bold text-gray-900">{items.length}</p>
              </div>
              <Utensils className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Recipes</p>
                <p className="text-2xl font-bold text-gray-900">
                  {items.filter(i => i.recipe_type === 'recipe').length}
                </p>
              </div>
              <ChefHat className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Components</p>
                <p className="text-2xl font-bold text-gray-900">
                  {items.filter(i => i.recipe_type === 'component').length}
                </p>
              </div>
              <Package className="h-8 w-8 text-yellow-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Active Items</p>
                <p className="text-2xl font-bold text-gray-900">
                  {items.filter(i => i.is_active).length}
                </p>
              </div>
              <CheckCircle className="h-8 w-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Enhanced Filters and Search */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Search items by name or description..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Select value={recipeTypeFilter} onValueChange={setRecipeTypeFilter}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="Recipe Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="simple">Simple Items</SelectItem>
                <SelectItem value="component">Components</SelectItem>
                <SelectItem value="recipe">Recipes</SelectItem>
              </SelectContent>
            </Select>
            
            <Select value={complexityFilter} onValueChange={setComplexityFilter}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="Complexity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Complexity</SelectItem>
                <SelectItem value="simple">Simple</SelectItem>
                <SelectItem value="moderate">Moderate</SelectItem>
                <SelectItem value="complex">Complex</SelectItem>
              </SelectContent>
            </Select>

            <Select value={itemUsageFilter} onValueChange={setItemUsageFilter}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="Item Usage" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Items</SelectItem>
                <SelectItem value="menu_item">Menu Items</SelectItem>
                <SelectItem value="recipe_ingredient">Recipe Ingredients</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* AI Menu Creator FAB - Only show when there are items */}
      {items.length > 0 && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={() => navigate('/menu/ai-menu-creator')}
                className="fixed bottom-6 right-6 w-12 h-12 rounded-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white shadow-xl hover:shadow-2xl transition-all duration-300 z-40 flex items-center justify-center"
                size="lg"
              >
                <Sparkles className="w-5 h-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left" className="bg-gray-900 text-white">
              <p className="flex items-center gap-2">
                <Zap className="w-4 h-4" />
                Try AI Menu Creator
                <Badge className="bg-orange-500 text-white text-xs ml-1">Beta</Badge>
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="breakdown">Recipe Breakdown</TabsTrigger>
          <TabsTrigger value="analysis">Cost Analysis</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {/* Items Grid */}
          <div className="grid gap-4">
            {filteredItems.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <ChefHat className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No items found</h3>
                  <p className="text-gray-600 mb-4">
                    {searchTerm || selectedCategory !== 'all' || recipeTypeFilter !== 'all' || complexityFilter !== 'all' || itemUsageFilter !== 'all'
                      ? 'No items match your current filters. Try adjusting your search criteria.'
                      : 'Get started by adding your first menu item or recipe.'
                    }
                  </p>
                  {(!searchTerm && selectedCategory === 'all' && recipeTypeFilter === 'all' && complexityFilter === 'all' && itemUsageFilter === 'all') && (
                    <div className="space-y-4">
                      {/* AI Menu Creator suggestion */}
                      <div className="bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-200 rounded-lg p-6 mb-6">
                        <div className="flex items-center justify-center gap-2 mb-3">
                          <Sparkles className="w-5 h-5 text-orange-500" />
                          <h4 className="font-semibold text-gray-900">Try Our AI Menu Creator</h4>
                          <Badge className="bg-orange-500 text-white text-xs px-2 py-1">Beta</Badge>
                        </div>
                        <p className="text-sm text-gray-600 mb-4">
                          Upload menu images or paste text and let AI automatically create your menu items with smart categorization and pricing.
                        </p>
                        <Button 
                          onClick={() => navigate('/menu/ai-menu-creator')}
                          className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-medium shadow-lg hover:shadow-xl transition-all"
                        >
                          <Zap className="w-4 h-4 mr-2" />
                          Try AI Menu Creator
                        </Button>
                      </div>
                      
                      {/* Or divider */}
                      <div className="flex items-center gap-4 my-6">
                        <div className="flex-1 h-px bg-gray-200"></div>
                        <span className="text-sm text-gray-500 font-medium">or</span>
                        <div className="flex-1 h-px bg-gray-200"></div>
                      </div>
                      
                      {/* Manual add button */}
                      <Button 
                        onClick={() => {
                          resetForm();
                          setIsAddModalOpen(true);
                        }}
                        variant="outline"
                        className="border-orange-200 text-orange-600 hover:bg-orange-50"
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        Add Items Manually
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {filteredItems.map((item) => {
                  const isLoading = actionLoading === item.id;
                  const profitMargin = calculateProfitMargin(item.price, item.cost_price);
                  const isLowStock = item.track_inventory && item.current_stock <= item.low_stock_threshold;
                  
                  return (
                    <Card key={item.id} className="hover:shadow-md transition-shadow">
                      <CardContent className="p-6">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 mb-2">
                              <div className="flex items-center gap-2">
                                {getRecipeTypeIcon(item.recipe_type)}
                                <h3 className="text-lg font-semibold text-gray-900 truncate">
                                  {item.name}
                                </h3>
                              </div>
                              
                              <div className="flex items-center gap-2">
                                <Badge variant="secondary" className={getComplexityColor(item.recipe_complexity)}>
                                  {item.recipe_complexity || 'simple'}
                                </Badge>
                                
                                <Badge variant="outline">
                                  {item.recipe_type || 'simple'}
                                </Badge>
                                
                                {item.max_recipe_level > 0 && (
                                  <Badge variant="outline" className="text-xs">
                                    <Layers className="h-3 w-3 mr-1" />
                                    Level {item.max_recipe_level}
                                  </Badge>
                                )}
                                
                                {item.total_components > 0 && (
                                  <Badge variant="outline" className="text-xs">
                                    <Hash className="h-3 w-3 mr-1" />
                                    {item.total_components} components
                                  </Badge>
                                )}
                                
                                {/* Menu/Recipe usage indicators */}
                                {(item.recipe_type === 'recipe' || item.recipe_type === 'simple') && (
                                  <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                                    <Utensils className="h-3 w-3 mr-1" />
                                    Menu Item
                                  </Badge>
                                )}
                                
                                {item.is_recipe_ingredient && (
                                  <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
                                    <FlaskConical className="h-3 w-3 mr-1" />
                                    Ingredient
                                  </Badge>
                                )}
                              </div>
                              
                              {!item.is_active && (
                                <Badge variant="destructive">Inactive</Badge>
                              )}
                            </div>
                            
                            {item.description && (
                              <p className="text-gray-600 text-sm mb-3 line-clamp-2">
                                {item.description}
                              </p>
                            )}
                            
                            <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
                              <div className="flex items-center gap-1">
                                <DollarSign className="h-4 w-4" />
                                <span className="font-medium">{formatCurrency(item.price)}</span>
                              </div>
                              
                              {item.cost_price > 0 && (
                                <div className="flex items-center gap-1">
                                  <Calculator className="h-4 w-4" />
                                  <span>Cost: {formatCurrency(item.cost_price)}</span>
                                </div>
                              )}
                              
                              {item.preparation_time && (
                                <div className="flex items-center gap-1">
                                  <Clock className="h-4 w-4" />
                                  <span>{item.preparation_time} min</span>
                                </div>
                              )}
                              
                              {item.categories && (
                                <div className="flex items-center gap-1">
                                  <Package className="h-4 w-4" />
                                  <span>{item.categories.name}</span>
                                </div>
                              )}
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2 ml-4">
                            {item.recipe_type !== 'simple' && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleRecipeBuilder(item)}
                                      className="h-8 w-8 p-0"
                                    >
                                      <TreePine className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>Recipe Builder</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                            
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 w-8 p-0"
                                  disabled={isLoading}
                                >
                                  {isLoading ? (
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600"></div>
                                  ) : (
                                    <MoreHorizontal className="h-4 w-4" />
                                  )}
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => openEditModal(item)}>
                                  <Edit className="h-4 w-4 mr-2" />
                                  Edit
                                </DropdownMenuItem>
                                
                                <DropdownMenuItem onClick={() => toggleItemStatus(item)}>
                                  {item.is_active ? (
                                    <>
                                      <EyeOff className="h-4 w-4 mr-2" />
                                      Deactivate
                                    </>
                                  ) : (
                                    <>
                                      <Eye className="h-4 w-4 mr-2" />
                                      Activate
                                    </>
                                  )}
                                </DropdownMenuItem>
                                
                                {item.recipe_type !== 'simple' && (
                                  <DropdownMenuItem onClick={() => updateRecipeMetadata(item.id)}>
                                    <Calculator className="h-4 w-4 mr-2" />
                                    Update Recipe Data
                                  </DropdownMenuItem>
                                )}
                                
                                <DropdownMenuSeparator />
                                
                                <DropdownMenuItem 
                                  onClick={() => deleteItem(item)}
                                  className="text-red-600 hover:text-red-700"
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="breakdown" className="space-y-4">
          <RecipeBreakdown activeLocation={activeLocation} />
        </TabsContent>

        <TabsContent value="analysis" className="space-y-4">
          <CostAnalysis activeLocation={activeLocation} />
        </TabsContent>
      </Tabs>

      {/* Add Item Dialog */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5 text-orange-500" />
              Add New Menu Item
            </DialogTitle>
            <DialogDescription>
              Add a new item to your menu for {activeLocation?.name}.
            </DialogDescription>
          </DialogHeader>
          
          <ItemForm />
          
          <div className="flex gap-3 pt-4">
            <Button 
              variant="outline" 
              onClick={() => setIsAddModalOpen(false)}
              className="flex-1"
              disabled={saving}
            >
              Cancel
            </Button>
            <Button 
              onClick={addItem}
              disabled={saving}
              className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
            >
              {saving ? (
                <Clock className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Plus className="w-4 h-4 mr-2" />
              )}
              Add Menu Item
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Item Dialog */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit className="w-5 h-5 text-blue-500" />
              Edit Menu Item
            </DialogTitle>
            <DialogDescription>
              Update information for "{editingItem?.name}".
            </DialogDescription>
          </DialogHeader>
          
          <ItemForm isEdit={true} />
          
          <div className="flex gap-3 pt-4">
            <Button 
              variant="outline" 
              onClick={() => setIsEditModalOpen(false)}
              className="flex-1"
              disabled={saving}
            >
              Cancel
            </Button>
            <Button 
              onClick={editItem}
              disabled={saving}
              className="flex-1 bg-blue-500 hover:bg-blue-600 text-white"
            >
              {saving ? (
                <Clock className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Edit className="w-4 h-4 mr-2" />
              )}
              Update Menu Item
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Recipe & Prep Steps Modal — two tabs: Ingredients (recipe tree) + Prep Steps (cook instructions) */}
      <Dialog open={isRecipeBuilderOpen} onOpenChange={setIsRecipeBuilderOpen}>
        <DialogContent className="max-w-7xl max-h-[95vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TreePine className="h-5 w-5 text-orange-500" />
              Recipe — {buildingRecipe?.name || 'Item'}
            </DialogTitle>
            <DialogDescription>
              Define what goes into this item (ingredients) and how the kitchen makes it (prep steps).
              Both feed straight onto the Kitchen Display when an order fires.
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="ingredients" className="mt-2">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="ingredients">Ingredients</TabsTrigger>
              <TabsTrigger value="prep">Prep Steps</TabsTrigger>
              <TabsTrigger value="modifiers">Modifiers</TabsTrigger>
            </TabsList>

            <TabsContent value="ingredients" className="mt-3">
              <RecipeBuilder
                item={buildingRecipe}
                availableItems={availableItems}
                onClose={() => setIsRecipeBuilderOpen(false)}
                onSave={() => {
                  fetchData();
                  // Don't auto-close — user may want to switch to Prep Steps tab next.
                }}
              />
            </TabsContent>

            <TabsContent value="prep" className="mt-3">
              <PrepStepsEditor
                itemId={buildingRecipe?.id || null}
                onSaved={() => fetchData()}
              />
            </TabsContent>

            <TabsContent value="modifiers" className="mt-3">
              <ModifierGroupsEditor itemId={buildingRecipe?.id || null} />
            </TabsContent>
          </Tabs>

          <div className="flex justify-end pt-3 border-t mt-3">
            <Button variant="outline" onClick={() => setIsRecipeBuilderOpen(false)}>
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Menu; 