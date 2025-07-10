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
  Zap
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
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/services/supabase-client';
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from 'date-fns';

const Menu = () => {
  const { activeLocation } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
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
    low_stock_threshold: 5
  });

  useEffect(() => {
    if (activeLocation) {
      fetchItems();
      fetchCategories();
    } else {
      setItems([]);
      setCategories([]);
      setLoading(false);
    }
  }, [activeLocation]);

  const fetchItems = async () => {
    if (!activeLocation) return;
    
    setLoading(true);
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
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      
      if (error) throw error;
      setItems(data || []);
    } catch (error) {
      console.error('Error fetching items:', error);
    } finally {
      setLoading(false);
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
      low_stock_threshold: 5
    });
  };

  const addItem = async () => {
    if (!activeLocation || !formData.name.trim() || !formData.price || !formData.category_id) {
      alert('Please fill in all required fields');
      return;
    }
    
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('items')
        .insert({
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
          low_stock_threshold: formData.track_inventory ? parseInt(formData.low_stock_threshold) || 5 : 5
        })
        .select()
        .single();

      if (error) throw error;

      setIsAddModalOpen(false);
      resetForm();
      fetchItems();
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
      const { error } = await supabase
        .from('items')
        .update({
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
          updated_at: new Date().toISOString()
        })
        .eq('id', editingItem.id);

      if (error) throw error;

      setIsEditModalOpen(false);
      setEditingItem(null);
      resetForm();
      fetchItems();
      alert('Menu item updated successfully!');
    } catch (error) {
      console.error('Error updating item:', error);
      alert(error.message || 'Failed to update menu item');
    } finally {
      setSaving(false);
    }
  };

  const deleteItem = async (itemId, itemName) => {
    if (!confirm(`Are you sure you want to delete "${itemName}"? This action cannot be undone.`)) return;
    
    setActionLoading(itemId);
    try {
      const { error } = await supabase
        .from('items')
        .delete()
        .eq('id', itemId);
      
      if (error) throw error;
      fetchItems();
      alert('Menu item deleted successfully');
    } catch (error) {
      console.error('Error deleting item:', error);
      alert('Failed to delete menu item');
    } finally {
      setActionLoading('');
    }
  };

  const toggleItemStatus = async (itemId, currentStatus) => {
    setActionLoading(itemId);
    try {
      const { error } = await supabase
        .from('items')
        .update({ 
          is_active: !currentStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', itemId);
      
      if (error) throw error;
      fetchItems();
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
      fetchItems();
    } catch (error) {
      console.error('Error updating sort order:', error);
      alert('Failed to update sort order');
    } finally {
      setActionLoading('');
    }
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
      low_stock_threshold: item.low_stock_threshold || 5
    });
    setIsEditModalOpen(true);
  };

  const calculateProfitMargin = (price, costPrice) => {
    if (!price || !costPrice) return null;
    const margin = ((price - costPrice) / price) * 100;
    return margin.toFixed(1);
  };

  const getCategoryName = (categoryId) => {
    const category = categories.find(cat => cat.id === categoryId);
    return category?.name || 'Unknown Category';
  };

  const filteredItems = items.filter(item => {
    const name = item.name?.toLowerCase() || '';
    const description = item.description?.toLowerCase() || '';
    const categoryName = getCategoryName(item.category_id).toLowerCase();
    const search = searchTerm.toLowerCase();
    
    const matchesSearch = name.includes(search) || description.includes(search) || categoryName.includes(search);
    const matchesCategory = selectedCategory === 'all' || item.category_id === selectedCategory;
    
    return matchesSearch && matchesCategory;
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
          <label className="text-sm font-medium text-gray-700 block mb-2">
            Item Name <span className="text-red-500">*</span>
          </label>
          <Input
            placeholder="Enter item name"
            value={formData.name}
            onChange={(e) => handleInputChange('name', e.target.value)}
            className="w-full"
            required
          />
        </div>
        
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-2">
            Category <span className="text-red-500">*</span>
          </label>
          <Select value={formData.category_id} onValueChange={(value) => handleInputChange('category_id', value)}>
            <SelectTrigger>
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {categories.map(cat => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      
      <div>
        <label className="text-sm font-medium text-gray-700 block mb-2">
          Description
        </label>
        <Textarea
          placeholder="Enter item description..."
          value={formData.description}
          onChange={(e) => handleInputChange('description', e.target.value)}
          rows={3}
          className="w-full"
        />
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-2">
            Price (R) <span className="text-red-500">*</span>
          </label>
          <Input
            type="number"
            step="0.01"
            min="0"
            placeholder="25.00"
            value={formData.price}
            onChange={(e) => handleInputChange('price', e.target.value)}
            className="w-full"
            required
          />
        </div>
        
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-2">
            Cost Price (R)
          </label>
          <Input
            type="number"
            step="0.01"
            min="0"
            placeholder="15.00"
            value={formData.cost_price}
            onChange={(e) => handleInputChange('cost_price', e.target.value)}
            className="w-full"
          />
        </div>
        
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-2">
            Prep Time (min)
          </label>
          <Input
            type="number"
            min="1"
            placeholder="15"
            value={formData.preparation_time}
            onChange={(e) => handleInputChange('preparation_time', e.target.value)}
            className="w-full"
          />
        </div>
      </div>
      
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id="track_inventory"
          checked={formData.track_inventory}
          onChange={(e) => handleInputChange('track_inventory', e.target.checked)}
          className="w-4 h-4 text-orange-600 border-gray-300 rounded focus:ring-orange-500"
        />
        <label htmlFor="track_inventory" className="text-sm font-medium text-gray-700">
          Track Inventory
        </label>
      </div>
      
      {formData.track_inventory && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 ml-7">
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-2">
              Current Stock
            </label>
            <Input
              type="number"
              min="0"
              placeholder="0"
              value={formData.current_stock}
              onChange={(e) => handleInputChange('current_stock', e.target.value)}
              className="w-full"
            />
          </div>
          
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-2">
              Low Stock Alert
            </label>
            <Input
              type="number"
              min="0"
              placeholder="5"
              value={formData.low_stock_threshold}
              onChange={(e) => handleInputChange('low_stock_threshold', e.target.value)}
              className="w-full"
            />
          </div>
        </div>
      )}
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-2">
            Sort Order
          </label>
          <Input
            type="number"
            placeholder="0"
            value={formData.sort_order}
            onChange={(e) => handleInputChange('sort_order', e.target.value)}
            className="w-full"
          />
        </div>
        
        <div className="flex items-center gap-3 pt-6">
          <input
            type="checkbox"
            id="is_active"
            checked={formData.is_active}
            onChange={(e) => handleInputChange('is_active', e.target.checked)}
            className="w-4 h-4 text-orange-600 border-gray-300 rounded focus:ring-orange-500"
          />
          <label htmlFor="is_active" className="text-sm font-medium text-gray-700">
            Active Item
          </label>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
              <UtensilsCrossed className="w-8 h-8 text-orange-500" />
              Menu Items
            </h1>
            <p className="text-gray-600 mt-1">
              Manage your menu items for {activeLocation?.name}
            </p>
          </div>
        </div>

        {/* Search and Filter Bar */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1 max-w-2xl">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <Input
              placeholder="Search menu items..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-12 h-12 text-base font-medium border-gray-200 focus:border-orange-300 focus:ring-orange-200"
            />
          </div>
          
          <div className="relative min-w-48">
            <Filter className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="pl-12 h-12">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map(cat => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* FAB - Add Item Button */}
      <Button
        onClick={() => {
          resetForm();
          setIsAddModalOpen(true);
        }}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full beepbite-gradient text-white shadow-xl hover:shadow-2xl transition-all duration-300 z-40 flex items-center justify-center sm:hidden"
        size="lg"
      >
        <Plus className="w-6 h-6" />
      </Button>

      {/* AI Menu Creator FAB - Only show when there are items */}
      {items.length > 0 && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={() => navigate('/menu/ai-menu-creator')}
                className="fixed bottom-6 right-24 w-12 h-12 rounded-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white shadow-xl hover:shadow-2xl transition-all duration-300 z-40 flex items-center justify-center sm:bottom-24 sm:right-6"
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

      {/* Desktop Add Button */}
      <div className="hidden sm:flex justify-end">
        <Button 
          onClick={() => {
            resetForm();
            setIsAddModalOpen(true);
          }}
          className="beepbite-gradient text-white shadow-lg hover:shadow-xl transition-all duration-200"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Menu Item
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-gray-200 hover:border-orange-200 transition-colors">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-3xl font-bold text-gray-900">{items.length}</p>
                <p className="text-sm text-gray-600 mt-1">Total Items</p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center">
                <UtensilsCrossed className="w-6 h-6 text-gray-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-gray-200 hover:border-green-200 transition-colors">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-3xl font-bold text-green-600">
                  {items.filter(item => item.is_active).length}
                </p>
                <p className="text-sm text-gray-600 mt-1">Active Items</p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-green-100 flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-gray-200 hover:border-blue-200 transition-colors">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-3xl font-bold text-blue-600">
                  {items.filter(item => item.track_inventory).length}
                </p>
                <p className="text-sm text-gray-600 mt-1">Tracked Items</p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center">
                <Package className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-gray-200 hover:border-orange-200 transition-colors">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-semibold text-gray-900 truncate">{categories.length}</p>
                <p className="text-sm text-gray-600 mt-1">Categories</p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-orange-100 flex items-center justify-center">
                <ChefHat className="w-6 h-6 text-orange-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Menu Items Grid */}
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-gray-900">Menu Items</h2>
        
        {filteredItems.length === 0 ? (
          <Card className="border-gray-200">
            <CardContent className="p-12 text-center">
              <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center mx-auto mb-4">
                <UtensilsCrossed className="w-8 h-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {searchTerm || selectedCategory !== 'all' ? 'No items found' : 'No menu items yet'}
              </h3>
              <p className="text-gray-600 mb-6">
                {searchTerm || selectedCategory !== 'all'
                  ? 'Try adjusting your search or filter terms' 
                  : 'Add menu items to build your restaurant menu'
                }
              </p>
              {!searchTerm && selectedCategory === 'all' && (
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
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
            {filteredItems.map((item) => {
              const isLoading = actionLoading === item.id;
              const profitMargin = calculateProfitMargin(item.price, item.cost_price);
              const isLowStock = item.track_inventory && item.current_stock <= item.low_stock_threshold;
              
              return (
                <Card key={item.id} className="border-gray-200 hover:border-orange-200 hover:shadow-md transition-all duration-200">
                  <CardContent className="p-6">
                    <div className="space-y-4">
                      {/* Item Info */}
                      <div className="space-y-3">
                        <div className="flex items-start justify-between">
                          <h3 className="font-semibold text-gray-900 text-lg truncate pr-2">
                            {item.name}
                          </h3>
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => updateSortOrder(item.id, item.sort_order - 1)}
                              disabled={isLoading}
                              className="p-1 h-6 w-6"
                            >
                              <ArrowUp className="w-3 h-3" />
                            </Button>
                            
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => updateSortOrder(item.id, item.sort_order + 1)}
                              disabled={isLoading}
                              className="p-1 h-6 w-6"
                            >
                              <ArrowDown className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                        
                        {item.description && (
                          <p className="text-sm text-gray-600 line-clamp-2">
                            {item.description}
                          </p>
                        )}
                        
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="text-xs bg-orange-50 text-orange-700 border-orange-200">
                            {getCategoryName(item.category_id)}
                          </Badge>
                          
                          <Badge 
                            variant="outline"
                            className={cn(
                              "text-xs font-medium",
                              item.is_active 
                                ? "bg-green-50 text-green-700 border-green-200"
                                : "bg-red-50 text-red-700 border-red-200"
                            )}
                          >
                            {item.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                          
                          {item.track_inventory && (
                            <Badge 
                              variant="outline"
                              className={cn(
                                "text-xs font-medium",
                                isLowStock
                                  ? "bg-red-50 text-red-700 border-red-200"
                                  : "bg-blue-50 text-blue-700 border-blue-200"
                              )}
                            >
                              Stock: {item.current_stock}
                            </Badge>
                          )}
                        </div>
                        
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-600">Price:</span>
                            <span className="font-semibold text-lg text-gray-900">R{item.price}</span>
                          </div>
                          
                          {item.cost_price && (
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-gray-600">Cost:</span>
                              <span className="text-gray-900">R{item.cost_price}</span>
                            </div>
                          )}
                          
                          {profitMargin && (
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-gray-600">Margin:</span>
                              <span className={cn(
                                "font-medium",
                                parseFloat(profitMargin) > 50 ? "text-green-600" : 
                                parseFloat(profitMargin) > 30 ? "text-orange-600" : "text-red-600"
                              )}>
                                {profitMargin}%
                              </span>
                            </div>
                          )}
                          
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-gray-600">Prep time:</span>
                            <span className="text-gray-900">{item.preparation_time} min</span>
                          </div>
                        </div>
                        
                        <p className="text-xs text-gray-500">
                          Created {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                        </p>
                      </div>

                      {/* Action Buttons */}
                      <div className="space-y-2 pt-4 border-t border-gray-100">
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEditModal(item)}
                            disabled={isLoading}
                            className="text-xs hover:bg-blue-50 border-blue-200 text-blue-700"
                          >
                            <Edit className="w-3 h-3 mr-1" />
                            Edit
                          </Button>
                          
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => toggleItemStatus(item.id, item.is_active)}
                            disabled={isLoading}
                            className={cn(
                              "text-xs",
                              item.is_active
                                ? "hover:bg-red-50 border-red-200 text-red-700"
                                : "hover:bg-green-50 border-green-200 text-green-700"
                            )}
                          >
                            {item.is_active ? (
                              <>
                                <EyeOff className="w-3 h-3 mr-1" />
                                Hide
                              </>
                            ) : (
                              <>
                                <Eye className="w-3 h-3 mr-1" />
                                Show
                              </>
                            )}
                          </Button>
                        </div>

                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => deleteItem(item.id, item.name)}
                          disabled={isLoading}
                          className="w-full text-xs text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                        >
                          <Trash2 className="w-3 h-3 mr-1" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

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
    </div>
  );
};

export default Menu; 