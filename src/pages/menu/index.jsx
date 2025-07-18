import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
  DollarSign,
  LayoutGrid,
  List,
  AlertTriangle,
  SlidersHorizontal,
  ArrowUpDown,
  Info,
  Copy
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
  const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'list'
  const [activeTab, setActiveTab] = useState('all'); // 'all', 'active', 'hidden', 'tracked'
  const [sortField, setSortField] = useState('name'); // 'name', 'price', 'category'
  const [sortDirection, setSortDirection] = useState('asc'); // 'asc', 'desc'
  const [showFilters, setShowFilters] = useState(false);
  const [priceRange, setPriceRange] = useState({ min: '', max: '' });
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);
  const [quickFilters, setQuickFilters] = useState([]);
  const [sortBy, setSortBy] = useState({ field: 'name', direction: 'asc' });
  const [showQuickFilters, setShowQuickFilters] = useState(true);

  const QUICK_FILTER_OPTIONS = [
    { id: 'low_stock', label: 'Low Stock', icon: AlertTriangle },
    { id: 'active', label: 'Active', icon: CheckCircle },
    { id: 'hidden', label: 'Hidden', icon: EyeOff },
    { id: 'tracked', label: 'Tracked', icon: Package },
    { id: 'budget', label: 'Budget', icon: DollarSign },
    { id: 'premium', label: 'Premium', icon: Sparkles }
  ];

  const SORT_OPTIONS = [
    { value: 'name_asc', label: 'Name (A-Z)', field: 'name', direction: 'asc' },
    { value: 'name_desc', label: 'Name (Z-A)', field: 'name', direction: 'desc' },
    { value: 'price_asc', label: 'Price (Low to High)', field: 'price', direction: 'asc' },
    { value: 'price_desc', label: 'Price (High to Low)', field: 'price', direction: 'desc' },
    { value: 'stock_asc', label: 'Stock (Low to High)', field: 'current_stock', direction: 'asc' },
    { value: 'stock_desc', label: 'Stock (High to Low)', field: 'current_stock', direction: 'desc' },
    { value: 'updated_desc', label: 'Recently Updated', field: 'updated_at', direction: 'desc' }
  ];

  // Animation variants
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { 
      opacity: 1,
      transition: { 
        staggerChildren: 0.1 
      }
    }
  };

  const itemVariants = {
    hidden: { 
      opacity: 0, 
      y: 20 
    },
    visible: { 
      opacity: 1, 
      y: 0,
      transition: {
        type: "spring",
        stiffness: 100
      }
    }
  };

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

  // Update the sortItems function
  const sortItems = (items) => {
    return [...items].sort((a, b) => {
      const { field, direction } = sortBy;
      const multiplier = direction === 'asc' ? 1 : -1;
      
      switch (field) {
        case 'name':
          return multiplier * a.name.localeCompare(b.name);
        
        case 'price':
          return multiplier * (a.price - b.price);
        
        case 'current_stock':
          const stockA = a.track_inventory ? a.current_stock : Infinity;
          const stockB = b.track_inventory ? b.current_stock : Infinity;
          return multiplier * (stockA - stockB);
        
        case 'updated_at':
          return multiplier * (new Date(a.updated_at) - new Date(b.updated_at));
        
        default:
          return 0;
      }
    });
  };

  // Filter items
  const getFilteredItems = () => {
    return filteredItems.filter(item => {
      // Tab filters
      if (activeTab === 'active' && !item.is_active) return false;
      if (activeTab === 'hidden' && item.is_active) return false;
      if (activeTab === 'tracked' && !item.track_inventory) return false;

      // Quick filters
      if (quickFilters.includes('low_stock') && 
          (!item.track_inventory || item.current_stock > item.low_stock_threshold)) return false;
      if (quickFilters.includes('active') && !item.is_active) return false;
      if (quickFilters.includes('hidden') && item.is_active) return false;
      if (quickFilters.includes('tracked') && !item.track_inventory) return false;
      if (quickFilters.includes('budget') && item.price > 20) return false;
      if (quickFilters.includes('premium') && item.price <= 50) return false;

      // Price range filter
      if (priceRange.min && item.price < parseFloat(priceRange.min)) return false;
      if (priceRange.max && item.price > parseFloat(priceRange.max)) return false;

      // Selected categories filter
      if (selectedCategories.length > 0 && !selectedCategories.includes(item.category_id)) return false;

      return true;
    });
  };

  const ItemCard = ({ item, viewMode }) => {
    const stockLevel = item.track_inventory 
      ? (item.current_stock / item.low_stock_threshold) * 100 
      : null;
    
    const getStockColor = (level) => {
      if (level <= 25) return 'bg-red-500';
      if (level <= 50) return 'bg-yellow-500';
      return 'bg-green-500';
    };

    const getPriceRange = (price) => {
      if (price <= 20) return { color: 'bg-green-100 text-green-700', label: 'Budget' };
      if (price <= 50) return { color: 'bg-blue-100 text-blue-700', label: 'Standard' };
      return { color: 'bg-purple-100 text-purple-700', label: 'Premium' };
    };

    return (
      <Card 
        className={cn(
          "group border-gray-100 hover:border-orange-200 transition-all duration-300 hover:shadow-lg",
          viewMode === 'list' && "overflow-hidden"
        )}
      >
        <CardContent className={cn(
          "p-3 sm:p-6",
          viewMode === 'list' && "flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-6"
        )}>
          <div className={cn(
            "space-y-3 sm:space-y-4 w-full",
            viewMode === 'list' && "flex-1 flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-6"
          )}>
            {/* Status Badges */}
            <div className={cn(
              "flex items-center justify-between flex-wrap gap-2",
              viewMode === 'list' && "w-full sm:w-48"
            )}>
              <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
                <Badge 
                  className={cn(
                    "px-1.5 sm:px-2 py-0.5 text-xs font-medium",
                    item.is_active 
                      ? "bg-orange-100 text-orange-700" 
                      : "bg-gray-100 text-gray-700"
                  )}
                >
                  {item.is_active ? "Active" : "Hidden"}
                </Badge>
                <Badge 
                  className={cn(
                    "px-1.5 sm:px-2 py-0.5 text-xs font-medium",
                    getPriceRange(item.price).color
                  )}
                >
                  {getPriceRange(item.price).label}
                </Badge>
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                {item.track_inventory && (
                  <Badge className="px-1.5 sm:px-2 py-0.5 text-xs font-medium bg-orange-100 text-orange-700">
                    Tracked
                  </Badge>
                )}
                <Badge className="px-1.5 sm:px-2 py-0.5 text-xs font-medium bg-orange-100 text-orange-700">
                  {getCategoryName(item.category_id)}
                </Badge>
              </div>
            </div>
            
            {/* Item Details */}
            <div className={cn(
              "w-full",
              viewMode === 'list' && "flex-1"
            )}>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-semibold text-gray-900 group-hover:text-orange-600 transition-colors line-clamp-1">
                  {item.name}
                </h3>
                {item.track_inventory && item.current_stock <= item.low_stock_threshold && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <AlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                      </TooltipTrigger>
                      <TooltipContent>
                        Low stock: {item.current_stock} items remaining
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
              <p className="text-xs sm:text-sm text-gray-600 mt-1 line-clamp-2">
                {item.description || "No description provided"}
              </p>
              
              {/* Stock Level Indicator */}
              {item.track_inventory && (
                <div className="mt-2">
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                    <span>Stock Level</span>
                    <span>{item.current_stock} items</span>
                  </div>
                  <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div 
                      className={cn(
                        "h-full transition-all duration-500",
                        getStockColor(stockLevel)
                      )}
                      style={{ width: `${Math.min(stockLevel, 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Price & Stats */}
            <div className={cn(
              "flex items-center justify-between pt-2 border-t border-gray-100",
              viewMode === 'list' && "w-full sm:w-64 border-t sm:border-t-0 pt-2 sm:pt-0"
            )}>
              <div className="flex items-center gap-2 sm:gap-3">
                <div>
                  <p className="text-xs sm:text-sm font-medium text-gray-600">Price</p>
                  <p className="text-base sm:text-lg font-semibold text-orange-600">
                    R{item.price}
                  </p>
                </div>
                {item.cost_price && (
                  <div>
                    <p className="text-xs sm:text-sm font-medium text-gray-600">Margin</p>
                    <p className="text-base sm:text-lg font-semibold text-orange-600">
                      {calculateProfitMargin(item.price, item.cost_price)}%
                    </p>
                  </div>
                )}
              </div>
              <div className="text-right">
                <p className="text-xs sm:text-sm font-medium text-gray-600">Prep Time</p>
                <p className="text-base sm:text-lg font-semibold text-gray-900">
                  {item.preparation_time} min
                </p>
              </div>
            </div>

            {/* Quick Actions */}
            <div className={cn(
              "grid grid-cols-3 gap-1 sm:gap-2 pt-2 sm:pt-4 border-t border-gray-100",
              viewMode === 'list' && "w-full sm:w-48 pt-2 sm:pt-0 border-t sm:border-t-0"
            )}>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openEditModal(item)}
                disabled={actionLoading === item.id}
                className="text-xs hover:bg-orange-50 border-orange-200 text-gray-700 hover:text-gray-900 px-1 sm:px-2"
              >
                <Edit className="w-3 h-3 mr-1" />
                <span className="hidden xs:inline">Edit</span>
              </Button>
              
              <Button
                size="sm"
                variant="outline"
                onClick={() => toggleItemStatus(item.id, item.is_active)}
                disabled={actionLoading === item.id}
                className="text-xs hover:bg-orange-50 border-orange-200 text-gray-700 px-1 sm:px-2"
              >
                {item.is_active ? (
                  <>
                    <EyeOff className="w-3 h-3 mr-1" />
                    <span className="hidden xs:inline">Hide</span>
                  </>
                ) : (
                  <>
                    <Eye className="w-3 h-3 mr-1" />
                    <span className="hidden xs:inline">Show</span>
                  </>
                )}
              </Button>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const newItem = { ...item };
                        delete newItem.id;
                        setFormData(newItem);
                        setIsAddModalOpen(true);
                      }}
                      className="text-xs hover:bg-orange-50 border-orange-200 text-gray-700 px-1 sm:px-2"
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Duplicate Item</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <Button
                size="sm"
                variant="outline"
                onClick={() => deleteItem(item.id, item.name)}
                disabled={actionLoading === item.id}
                className="col-span-3 text-xs text-gray-700 hover:text-red-600 hover:bg-red-50 border-orange-200"
              >
                <Trash2 className="w-3 h-3 mr-1" />
                <span className="hidden xs:inline">Delete</span>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

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
      {/* Header with Quick Stats */}
      <motion.div 
        className="space-y-4 w-full max-w-full overflow-x-hidden px-2 sm:px-0"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 w-full">
          <div className="flex items-center justify-between w-full sm:w-auto">
            <div className="max-w-[70%] sm:max-w-none">
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2 break-words">
                <UtensilsCrossed className="w-6 h-6 sm:w-8 sm:h-8 text-orange-500 flex-shrink-0" />
                <span className="truncate">Menu Items</span>
              </h1>
              <p className="text-sm sm:text-base text-gray-600 mt-1 truncate">
                Manage your menu items for {activeLocation?.name}
              </p>
            </div>
            
            {/* AI Menu Creator - Mobile & Tablet */}
            {items.length > 0 && (
              <div className="block sm:hidden flex-shrink-0 ml-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={() => navigate('/menu/ai-menu-creator')}
                        variant="outline"
                        size="sm"
                        className="border-orange-200 text-gray-700 hover:bg-orange-50 whitespace-nowrap h-8"
                      >
                        <Sparkles className="w-4 h-4" />
                        <span className="ml-2 hidden xs:inline">AI</span>
                        <Badge className="ml-1 bg-orange-100 text-gray-900 text-[10px] px-1">Beta</Badge>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="bg-gray-900 text-white">
                      <p className="flex items-center gap-2">
                        <Zap className="w-4 h-4" />
                        Create menu suggestions with AI
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            )}
          </div>

          {/* Desktop Actions */}
          <div className="hidden sm:flex items-center gap-2 flex-wrap justify-end">
            {/* AI Menu Creator - Desktop */}
            {items.length > 0 && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={() => navigate('/menu/ai-menu-creator')}
                      variant="outline"
                      size="sm"
                      className="border-orange-200 text-gray-700 hover:bg-orange-50"
                    >
                      <Sparkles className="w-4 h-4 mr-2" />
                      AI Menu Creator
                      <Badge className="ml-2 bg-orange-100 text-gray-900 text-xs">Beta</Badge>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="bg-gray-900 text-white">
                    <p className="flex items-center gap-2">
                      <Zap className="w-4 h-4" />
                      Create menu suggestions with AI
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAdvancedSearch(!showAdvancedSearch)}
              className="border-gray-200"
            >
              <SlidersHorizontal className="w-4 h-4 mr-2" />
              Advanced Search
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
              className="border-gray-200"
            >
              {viewMode === 'grid' ? (
                <List className="w-4 h-4 mr-2" />
              ) : (
                <LayoutGrid className="w-4 h-4 mr-2" />
              )}
              {viewMode === 'grid' ? 'List View' : 'Grid View'}
            </Button>
            <Button 
              onClick={() => {
                resetForm();
                setIsAddModalOpen(true);
              }}
              className="bg-gradient-to-r from-orange-400 to-orange-500 hover:from-orange-500 hover:to-orange-600 text-gray-900 font-medium shadow-md hover:shadow-lg transition-all duration-300"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Menu Item
            </Button>
          </div>
        </div>

        {/* Mobile Actions */}
        <div className="flex sm:hidden items-center gap-2 w-full">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAdvancedSearch(!showAdvancedSearch)}
            className="flex-1 border-gray-200"
          >
            <SlidersHorizontal className="w-4 h-4 mr-2" />
            Advanced Search
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
            className="flex-1 border-gray-200"
          >
            {viewMode === 'grid' ? (
              <List className="w-4 h-4 mr-2" />
            ) : (
              <LayoutGrid className="w-4 h-4 mr-2" />
            )}
            {viewMode === 'grid' ? 'List' : 'Grid'}
          </Button>
        </div>

        {/* Stats Cards as Tabs */}
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
          <motion.div whileHover={{ scale: 1.02 }} transition={{ type: "spring", stiffness: 300 }}>
            <Card 
              className={cn(
                "border-orange-100 hover:border-orange-200 transition-all duration-300 bg-gradient-to-br from-orange-50/50 to-transparent cursor-pointer",
                activeTab === 'all' && "border-orange-500 shadow-lg"
              )}
              onClick={() => setActiveTab('all')}
            >
              <CardContent className="p-3 sm:p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-lg sm:text-3xl font-bold text-orange-600">{items.length}</p>
                    <p className="text-xs sm:text-sm font-medium text-orange-900/70 mt-1">Total Items</p>
                  </div>
                  <div className="w-8 h-8 sm:w-12 sm:h-12 rounded-lg bg-orange-100 flex items-center justify-center">
                    <UtensilsCrossed className="w-4 h-4 sm:w-6 sm:h-6 text-orange-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
          
          <motion.div whileHover={{ scale: 1.02 }} transition={{ type: "spring", stiffness: 300 }}>
            <Card 
              className={cn(
                "border-orange-100 hover:border-orange-200 transition-all duration-300 bg-gradient-to-br from-orange-50/50 to-transparent cursor-pointer",
                activeTab === 'active' && "border-orange-500 shadow-lg"
              )}
              onClick={() => setActiveTab('active')}
            >
              <CardContent className="p-3 sm:p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-lg sm:text-3xl font-bold text-orange-600">
                      {items.filter(item => item.is_active).length}
                    </p>
                    <p className="text-xs sm:text-sm font-medium text-orange-900/70 mt-1">Active Items</p>
                  </div>
                  <div className="w-8 h-8 sm:w-12 sm:h-12 rounded-lg bg-orange-100 flex items-center justify-center">
                    <CheckCircle className="w-4 h-4 sm:w-6 sm:h-6 text-orange-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
          
          <motion.div whileHover={{ scale: 1.02 }} transition={{ type: "spring", stiffness: 300 }}>
            <Card 
              className={cn(
                "border-orange-100 hover:border-orange-200 transition-all duration-300 bg-gradient-to-br from-orange-50/50 to-transparent cursor-pointer",
                activeTab === 'tracked' && "border-orange-500 shadow-lg"
              )}
              onClick={() => setActiveTab('tracked')}
            >
              <CardContent className="p-3 sm:p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-lg sm:text-3xl font-bold text-orange-600">
                      {items.filter(item => item.track_inventory).length}
                    </p>
                    <p className="text-xs sm:text-sm font-medium text-orange-900/70 mt-1">Tracked Items</p>
                  </div>
                  <div className="w-8 h-8 sm:w-12 sm:h-12 rounded-lg bg-orange-100 flex items-center justify-center">
                    <Package className="w-4 h-4 sm:w-6 sm:h-6 text-orange-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
          
          <motion.div whileHover={{ scale: 1.02 }} transition={{ type: "spring", stiffness: 300 }}>
            <Card 
              className={cn(
                "border-orange-100 hover:border-orange-200 transition-all duration-300 bg-gradient-to-br from-orange-50/50 to-transparent cursor-pointer",
                activeTab === 'hidden' && "border-orange-500 shadow-lg"
              )}
              onClick={() => setActiveTab('hidden')}
            >
              <CardContent className="p-3 sm:p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-lg sm:text-3xl font-bold text-orange-600">
                      {items.filter(item => !item.is_active).length}
                    </p>
                    <p className="text-xs sm:text-sm font-medium text-orange-900/70 mt-1">Hidden Items</p>
                  </div>
                  <div className="w-8 h-8 sm:w-12 sm:h-12 rounded-lg bg-orange-100 flex items-center justify-center">
                    <EyeOff className="w-4 h-4 sm:w-6 sm:h-6 text-orange-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* Search Bar */}
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 w-full">
          <div className="relative flex-1 max-w-full sm:max-w-2xl">
            <Search className="absolute left-2 sm:left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 sm:w-5 h-4 sm:h-5" />
            <Input
              placeholder="Search menu items..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 sm:pl-12 h-10 sm:h-12 text-sm sm:text-base font-medium border-gray-200 focus:border-orange-300 focus:ring-orange-200 w-full"
            />
          </div>
        </div>

        {/* Quick Filters */}
        <AnimatePresence>
          {showQuickFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden w-full"
            >
              <div className="flex flex-wrap gap-1 sm:gap-2 mb-4">
                {QUICK_FILTER_OPTIONS.map(filter => {
                  const Icon = filter.icon;
                  const isActive = quickFilters.includes(filter.id);
                  
                  return (
                    <Button
                      key={filter.id}
                      size="sm"
                      variant={isActive ? "default" : "outline"}
                      onClick={() => {
                        setQuickFilters(prev => 
                          prev.includes(filter.id)
                            ? prev.filter(f => f !== filter.id)
                            : [...prev, filter.id]
                        );
                      }}
                      className={cn(
                        "border-gray-200 text-xs sm:text-sm whitespace-nowrap",
                        isActive && "bg-orange-100 text-gray-900 border-orange-200 hover:bg-orange-200"
                      )}
                    >
                      <Icon className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
                      <span className="hidden xs:inline">{filter.label}</span>
                      <span className="xs:hidden">{filter.label.split(' ')[0]}</span>
                      {isActive && (
                        <Badge variant="secondary" className="ml-1 sm:ml-2 bg-orange-200 text-gray-900 text-xs">
                          {getFilteredItems().filter(item => {
                            if (filter.id === 'low_stock') 
                              return item.track_inventory && item.current_stock <= item.low_stock_threshold;
                            if (filter.id === 'active') return item.is_active;
                            if (filter.id === 'hidden') return !item.is_active;
                            if (filter.id === 'tracked') return item.track_inventory;
                            if (filter.id === 'budget') return item.price <= 20;
                            if (filter.id === 'premium') return item.price > 50;
                            return false;
                          }).length}
                        </Badge>
                      )}
                    </Button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Enhanced Sort Options */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <Select
            value={`${sortBy.field}_${sortBy.direction}`}
            onValueChange={(value) => {
              const option = SORT_OPTIONS.find(opt => opt.value === value);
              if (option) {
                setSortBy({ field: option.field, direction: option.direction });
              }
            }}
          >
            <SelectTrigger className="w-[160px] sm:w-[200px]">
              <SelectValue placeholder="Sort by..." />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <Button
            variant="outline"
            size="icon"
            onClick={() => setShowQuickFilters(!showQuickFilters)}
            className={cn(
              "border-gray-200",
              showQuickFilters && "bg-orange-100 text-orange-700 border-orange-200"
            )}
          >
            <Filter className="w-4 h-4" />
          </Button>
        </div>

        {/* Advanced Search Panel */}
        <AnimatePresence>
          {showAdvancedSearch && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden w-full"
            >
              <Card className="border-orange-100 bg-orange-50/30">
                <CardContent className="p-3 sm:p-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                    <div>
                      <label className="text-xs sm:text-sm font-medium text-gray-700 mb-1 block">
                        Price Range
                      </label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          placeholder="Min"
                          value={priceRange.min}
                          onChange={(e) => setPriceRange(prev => ({ ...prev, min: e.target.value }))}
                          className="w-full text-sm"
                        />
                        <span className="text-gray-500">-</span>
                        <Input
                          type="number"
                          placeholder="Max"
                          value={priceRange.max}
                          onChange={(e) => setPriceRange(prev => ({ ...prev, max: e.target.value }))}
                          className="w-full text-sm"
                        />
                      </div>
                    </div>
                    
                    <div>
                      <label className="text-xs sm:text-sm font-medium text-gray-700 mb-1 block">
                        Categories
                      </label>
                      <Select 
                        value={selectedCategories}
                        onValueChange={setSelectedCategories}
                        className="w-full"
                      >
                        <SelectTrigger className="text-sm">
                          <SelectValue placeholder="Select categories..." />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map(cat => (
                            <SelectItem key={cat.id} value={cat.id} className="text-sm">
                              {cat.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Menu Items Grid/List */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className={cn(
          "w-full px-2 sm:px-0",
          viewMode === 'grid' 
            ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-4"
            : "space-y-2 sm:space-y-4"
        )}
      >
        <AnimatePresence mode="wait">
          {sortItems(getFilteredItems()).map((item) => (
            <motion.div
              key={item.id}
              variants={itemVariants}
              layout
              initial="hidden"
              animate="visible"
              exit="hidden"
            >
              <ItemCard item={item} viewMode={viewMode} />
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>

      {/* Empty State */}
      {getFilteredItems().length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="px-2 sm:px-0"
        >
          <Card className="border-orange-100 bg-orange-50/30">
            <CardContent className="p-6 sm:p-12 text-center">
              <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-lg bg-orange-100 flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-6 h-6 sm:w-8 sm:h-8 text-orange-600" />
              </div>
              <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-2">
                {searchTerm || selectedCategory !== 'all' 
                  ? 'No items found' 
                  : 'No menu items yet'}
              </h3>
              <p className="text-sm sm:text-base text-gray-600 mb-6">
                {searchTerm || selectedCategory !== 'all'
                  ? 'Try adjusting your search or filter terms' 
                  : 'Add menu items to build your restaurant menu'}
              </p>
              <Button
                onClick={() => {
                  resetForm();
                  setIsAddModalOpen(true);
                }}
                className="bg-gradient-to-r from-orange-400 to-orange-500 hover:from-orange-500 hover:to-orange-600 text-gray-900 font-medium shadow-md hover:shadow-lg transition-all duration-300"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add First Menu Item
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Mobile Add Button */}
      <Button
        onClick={() => {
          resetForm();
          setIsAddModalOpen(true);
        }}
        className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-gradient-to-r from-orange-400 to-orange-500 hover:from-orange-500 hover:to-orange-600 text-gray-900 shadow-xl hover:shadow-2xl transition-all duration-300 z-40 flex items-center justify-center sm:hidden"
        size="lg"
      >
        <Plus className="w-5 h-5 sm:w-6 sm:h-6" />
      </Button>

      {/* Dialogs */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-3xl mx-2 sm:mx-4">
          {/* ... existing dialog content ... */}
        </DialogContent>
      </Dialog>

      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-3xl mx-2 sm:mx-4">
          {/* ... existing dialog content ... */}
        </DialogContent>
      </Dialog>

      {/* Add Item Dialog */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-3xl mx-2 sm:mx-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-orange-600">
              <Plus className="w-5 h-5" />
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
              className="flex-1 border-gray-200 hover:bg-gray-50"
              disabled={saving}
            >
              Cancel
            </Button>
            <Button 
              onClick={addItem}
              disabled={saving}
              className="flex-1 bg-gradient-to-r from-orange-400 to-orange-500 hover:from-orange-500 hover:to-orange-600 text-gray-900 font-medium shadow-md hover:shadow-lg transition-all duration-300"
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
        <DialogContent className="max-w-[95vw] sm:max-w-3xl mx-2 sm:mx-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-orange-600">
              <Edit className="w-5 h-5" />
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
              className="flex-1 border-gray-200 hover:bg-gray-50"
              disabled={saving}
            >
              Cancel
            </Button>
            <Button 
              onClick={editItem}
              disabled={saving}
              className="flex-1 bg-gradient-to-r from-orange-400 to-orange-500 hover:from-orange-500 hover:to-orange-600 text-gray-900 font-medium shadow-md hover:shadow-lg transition-all duration-300"
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