import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { 
  Folder, 
  Search, 
  Plus,
  Edit,
  Trash2,
  Eye,
  EyeOff,
  ChevronRight,
  ChevronDown,
  FolderOpen,
  Tag,
  AlertCircle,
  CheckCircle,
  XCircle,
  MapPin,
  Clock,
  Save,
  X,
  MoreHorizontal,
  FolderPlus,
  Settings,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/services/supabase-client';
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from 'date-fns';

const Categories = () => {
  const { activeLocation } = useAuth();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [expandedCategories, setExpandedCategories] = useState(new Set());
  const [editingInline, setEditingInline] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    parent_id: 'none',
    sort_order: 0,
    is_active: true
  });

  useEffect(() => {
    if (activeLocation) {
      fetchCategories();
    } else {
      setCategories([]);
      setLoading(false);
    }
  }, [activeLocation]);

  const fetchCategories = async () => {
    if (!activeLocation) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .eq('location_id', activeLocation.id)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      
      if (error) throw error;
      setCategories(data || []);
    } catch (error) {
      console.error('Error fetching categories:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: field === 'parent_id' && value === '' ? 'none' : value
    }));
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      parent_id: 'none',
      sort_order: 0,
      is_active: true
    });
  };

  const addCategory = async () => {
    if (!activeLocation || !formData.name.trim()) {
      alert('Please fill in all required fields');
      return;
    }
    
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('categories')
        .insert({
          location_id: activeLocation.id,
          name: formData.name.trim(),
          description: formData.description.trim() || null,
          parent_id: formData.parent_id === 'none' ? null : formData.parent_id || null,
          sort_order: parseInt(formData.sort_order) || 0,
          is_active: formData.is_active
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          throw new Error('A category with this name already exists');
        }
        throw error;
      }

      setIsAddModalOpen(false);
      resetForm();
      fetchCategories();
    } catch (error) {
      console.error('Error adding category:', error);
      alert(error.message || 'Failed to add category');
    } finally {
      setSaving(false);
    }
  };

  const updateCategory = async (categoryId, updates) => {
    try {
      const { error } = await supabase
        .from('categories')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', categoryId);

      if (error) throw error;
      await fetchCategories();
    } catch (error) {
      console.error('Error updating category:', error);
      throw error;
    }
  };

  const editCategory = async () => {
    if (!editingCategory || !formData.name.trim()) {
      alert('Please fill in all required fields');
      return;
    }
    
    setSaving(true);
    try {
      await updateCategory(editingCategory.id, {
        name: formData.name.trim(),
        description: formData.description.trim() || null,
        parent_id: formData.parent_id === 'none' ? null : formData.parent_id || null,
        sort_order: parseInt(formData.sort_order) || 0,
        is_active: formData.is_active
      });

      setIsEditModalOpen(false);
      setEditingCategory(null);
      resetForm();
    } catch (error) {
      console.error('Error updating category:', error);
      alert(error.message || 'Failed to update category');
    } finally {
      setSaving(false);
    }
  };

  const deleteCategory = async (categoryId, categoryName) => {
    const hasSubcategories = categories.some(cat => cat.parent_id === categoryId);
    
    if (hasSubcategories) {
      alert('Cannot delete category with subcategories. Please delete or move subcategories first.');
      return;
    }

    if (!confirm(`Are you sure you want to delete "${categoryName}"? This action cannot be undone.`)) return;
    
    setActionLoading(categoryId);
    try {
      const { error } = await supabase
        .from('categories')
        .delete()
        .eq('id', categoryId);
      
      if (error) throw error;
      fetchCategories();
    } catch (error) {
      console.error('Error deleting category:', error);
      alert('Failed to delete category. It may have items associated with it.');
    } finally {
      setActionLoading('');
    }
  };

  const toggleCategoryStatus = async (categoryId, currentStatus) => {
    setActionLoading(categoryId);
    try {
      await updateCategory(categoryId, { is_active: !currentStatus });
    } catch (error) {
      console.error('Error updating category status:', error);
      alert('Failed to update category status');
    } finally {
      setActionLoading('');
    }
  };

  const updateSortOrder = async (categoryId, newSortOrder) => {
    setActionLoading(categoryId);
    try {
      await updateCategory(categoryId, { sort_order: newSortOrder });
    } catch (error) {
      console.error('Error updating sort order:', error);
      alert('Failed to update sort order');
    } finally {
      setActionLoading('');
    }
  };

  const openEditModal = (category) => {
    setEditingCategory(category);
    setFormData({
      name: category.name || '',
      description: category.description || '',
      parent_id: category.parent_id || 'none',
      sort_order: category.sort_order || 0,
      is_active: category.is_active ?? true
    });
    setIsEditModalOpen(true);
  };

  const toggleExpanded = (categoryId) => {
    setExpandedCategories(prev => {
      const newExpanded = new Set(prev);
      if (newExpanded.has(categoryId)) {
        newExpanded.delete(categoryId);
      } else {
        newExpanded.add(categoryId);
      }
      return newExpanded;
    });
  };

  const handleInlineEdit = (category) => {
    setEditingInline({
      id: category.id,
      name: category.name,
      description: category.description || ''
    });
  };

  const saveInlineEdit = async () => {
    if (!editingInline) return;
    
    try {
      await updateCategory(editingInline.id, {
        name: editingInline.name,
        description: editingInline.description || null
      });
      setEditingInline(null);
    } catch (error) {
      console.error('Error saving inline edit:', error);
      alert('Failed to save changes');
    }
  };

  const cancelInlineEdit = () => {
    setEditingInline(null);
  };

  // Organize categories into hierarchy
  const mainCategories = categories.filter(cat => !cat.parent_id);
  const getSubcategories = (parentId) => categories.filter(cat => cat.parent_id === parentId);

  const filteredMainCategories = mainCategories.filter(category => {
    const name = category.name?.toLowerCase() || '';
    const description = category.description?.toLowerCase() || '';
    const search = searchTerm.toLowerCase();
    
    return name.includes(search) || description.includes(search);
  });

  if (!activeLocation) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <AlertCircle className="w-16 h-16 text-gray-400 mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">No Location Selected</h2>
        <p className="text-gray-600">Please select a location to manage categories.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-12 bg-gray-200 rounded-xl animate-pulse"></div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-32 bg-gray-200 rounded-xl animate-pulse"></div>
          ))}
        </div>
      </div>
    );
  }

  const CategoryForm = ({ isEdit = false }) => (
    <div className="space-y-6 mt-6">
      <div className="space-y-2">
        <label className="text-sm font-semibold text-gray-700 block">
          Category Name <span className="text-orange-500">*</span>
        </label>
        <Input
          placeholder="Enter category name"
          value={formData.name}
          onChange={(e) => handleInputChange('name', e.target.value)}
          className="w-full h-12 text-base border-gray-200 focus:border-orange-500 focus:ring-orange-200 rounded-xl"
          required
        />
      </div>
      
      <div className="space-y-2">
        <label className="text-sm font-semibold text-gray-700 block">
          Description
        </label>
        <Textarea
          placeholder="Enter category description..."
          value={formData.description}
          onChange={(e) => handleInputChange('description', e.target.value)}
          rows={4}
          className="w-full text-base border-gray-200 focus:border-orange-500 focus:ring-orange-200 rounded-xl resize-none"
        />
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <label className="text-sm font-semibold text-gray-700 block">
            Parent Category
          </label>
          <Select value={formData.parent_id || 'none'} onValueChange={(value) => handleInputChange('parent_id', value)}>
            <SelectTrigger className="h-12 text-base border-gray-200 focus:border-orange-500 focus:ring-orange-200 rounded-xl">
              <SelectValue placeholder="Select parent category (optional)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None (Main Category)</SelectItem>
              {mainCategories
                .filter(cat => !isEdit || cat.id !== editingCategory?.id)
                .filter(cat => cat.id && cat.id.trim() !== '') // Filter out empty/null IDs
                .map(cat => (
                  <SelectItem key={cat.id} value={cat.id}>
                    <div className="flex items-center gap-2">
                      <Folder className="w-4 h-4 text-orange-500" />
                      {cat.name}
                    </div>
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        
        <div className="space-y-2">
          <label className="text-sm font-semibold text-gray-700 block">
            Sort Order
          </label>
          <Input
            type="number"
            placeholder="0"
            value={formData.sort_order}
            onChange={(e) => handleInputChange('sort_order', e.target.value)}
            className="w-full h-12 text-base border-gray-200 focus:border-orange-500 focus:ring-orange-200 rounded-xl"
          />
        </div>
      </div>
      
      <div className="flex items-center gap-4 p-4 bg-orange-50 rounded-xl">
        <input
          type="checkbox"
          id="is_active"
          checked={formData.is_active}
          onChange={(e) => handleInputChange('is_active', e.target.checked)}
          className="w-5 h-5 text-orange-600 border-gray-300 rounded focus:ring-orange-500"
        />
        <label htmlFor="is_active" className="text-base font-medium text-gray-700">
          Active Category
        </label>
      </div>
    </div>
  );

  const CategoryCard = ({ category, isSubcategory = false }) => {
    const subcategories = getSubcategories(category.id);
    const hasSubcategories = subcategories.length > 0;
    const isExpanded = expandedCategories.has(category.id);
    const isLoading = actionLoading === category.id;
    const isInlineEditing = editingInline?.id === category.id;

    return (
      <div className={cn("space-y-3", isSubcategory && "ml-6")}>
        <Card className="group border border-gray-100 hover:border-orange-100 shadow-sm hover:shadow-md transition-all duration-300 rounded-2xl overflow-hidden">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4 flex-1">
                {/* Expand/Collapse Button */}
                {hasSubcategories && !isSubcategory && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleExpanded(category.id)}
                    className="p-2 h-9 w-9 rounded-full hover:bg-orange-50 hover:text-orange-500 transition-all duration-200"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </Button>
                )}
                
                <div className="flex items-start gap-4 flex-1 min-w-0">
                  <div className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center",
                    isSubcategory 
                      ? "bg-orange-50" 
                      : "bg-gradient-to-br from-orange-500 to-orange-600"
                  )}>
                    {isSubcategory ? (
                      <Tag className="w-5 h-5 text-orange-500" />
                    ) : hasSubcategories ? (
                      <FolderOpen className="w-5 h-5 text-white" />
                    ) : (
                      <Folder className="w-5 h-5 text-white" />
                    )}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    {isInlineEditing ? (
                      <div className="space-y-3">
                        <Input
                          value={editingInline.name}
                          onChange={(e) => setEditingInline(prev => ({ ...prev, name: e.target.value }))}
                          className="text-base font-medium border-gray-200 focus:border-orange-500 focus:ring-orange-200 rounded-full"
                        />
                        <Textarea
                          value={editingInline.description}
                          onChange={(e) => setEditingInline(prev => ({ ...prev, description: e.target.value }))}
                          className="text-sm border-gray-200 focus:border-orange-500 focus:ring-orange-200 rounded-xl resize-none"
                          rows={2}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={saveInlineEdit}
                            className="bg-gradient-to-br from-orange-500 to-orange-600 text-white hover:shadow-md rounded-full px-4"
                          >
                            <Save className="w-4 h-4 mr-2" />
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={cancelInlineEdit}
                            className="border-gray-200 hover:bg-gray-50 rounded-full px-4"
                          >
                            <X className="w-4 h-4 mr-2" />
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-3 mb-1.5">
                          <h3 className="font-medium text-gray-900 text-base truncate group-hover:text-orange-600 transition-colors">
                            {category.name}
                          </h3>
                          <Badge 
                            variant="outline"
                            className={cn(
                              "text-xs font-medium px-2 py-0.5 rounded-full",
                              category.is_active 
                                ? "bg-orange-50 text-orange-700 border-orange-200"
                                : "bg-gray-100 text-gray-700 border-gray-200"
                            )}
                          >
                            {category.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                        
                        {category.description && (
                          <p className="text-sm text-gray-500 mb-3 line-clamp-2">
                            {category.description}
                          </p>
                        )}
                        
                        <div className="flex items-center gap-3 text-xs text-gray-500">
                          <div className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5" />
                            {formatDistanceToNow(new Date(category.created_at), { addSuffix: true })}
                          </div>
                          
                          <div className="flex items-center gap-1.5">
                            <Settings className="w-3.5 h-3.5" />
                            Order: {category.sort_order}
                          </div>
                          
                          {hasSubcategories && (
                            <div className="flex items-center gap-1.5">
                              <FolderPlus className="w-3.5 h-3.5" />
                              {subcategories.length} subcategories
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
              
              {/* Action Buttons */}
              {!isInlineEditing && (
                <div className="flex items-center gap-1 ml-4">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => updateSortOrder(category.id, category.sort_order - 1)}
                    disabled={isLoading}
                    className="p-2 h-8 w-8 rounded-full hover:bg-orange-50 hover:text-orange-500"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </Button>
                  
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => updateSortOrder(category.id, category.sort_order + 1)}
                    disabled={isLoading}
                    className="p-2 h-8 w-8 rounded-full hover:bg-orange-50 hover:text-orange-500"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </Button>
                  
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 rounded-full hover:bg-orange-50 group/menu"
                      >
                        <MoreHorizontal className="w-4 h-4 text-gray-400 group-hover/menu:text-orange-500" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem
                        onClick={() => handleInlineEdit(category)}
                        className="flex items-center gap-2 text-orange-600 hover:bg-orange-50"
                      >
                        <Edit className="w-4 h-4" />
                        Quick Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => openEditModal(category)}
                        className="flex items-center gap-2 text-orange-600 hover:bg-orange-50"
                      >
                        <Settings className="w-4 h-4" />
                        Full Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => toggleCategoryStatus(category.id, category.is_active)}
                        className={cn(
                          "flex items-center gap-2",
                          category.is_active
                            ? "text-gray-600 hover:bg-gray-50"
                            : "text-orange-600 hover:bg-orange-50"
                        )}
                      >
                        {category.is_active ? (
                          <>
                            <EyeOff className="w-4 h-4" />
                            Deactivate
                          </>
                        ) : (
                          <>
                            <Eye className="w-4 h-4" />
                            Activate
                          </>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => deleteCategory(category.id, category.name)}
                        className="flex items-center gap-2 text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        
        {/* Subcategories */}
        {hasSubcategories && isExpanded && (
          <div className="space-y-3 pl-4 border-l-2 border-orange-100">
            {subcategories.map(subcategory => (
              <CategoryCard 
                key={subcategory.id} 
                category={subcategory} 
                isSubcategory={true} 
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">
      {/* Header Section */}
      <div className="relative">
        <div className="flex flex-col gap-8">
          {/* Title and Description */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-3 bg-orange-50/50 px-4 py-2 rounded-full">
                <Folder className="w-5 h-5 text-orange-500" />
                <span className="text-sm font-medium text-orange-700">Menu Categories</span>
              </div>
              <h1 className="text-4xl font-bold text-gray-900">
                Categories
              </h1>
              <p className="text-lg text-gray-500">
                Organize your menu items for {activeLocation?.name}
              </p>
            </div>
            
            {/* Desktop Add Button */}
            <div className="hidden sm:block">
              <Button 
                onClick={() => {
                  resetForm();
                  setIsAddModalOpen(true);
                }}
                className="bg-gradient-to-br from-orange-500 to-orange-600 text-white shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-300 rounded-full px-8 h-12 font-medium"
              >
                <Plus className="w-5 h-5 mr-2" />
                New Category
              </Button>
            </div>
          </div>

          {/* Search Bar */}
          <div className="relative max-w-2xl">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <Search className="w-5 h-5 text-gray-400" />
            </div>
            <Input
              placeholder="Search categories..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-12 h-12 text-base font-medium border-gray-200 focus:border-orange-500 focus:ring-orange-200 rounded-full shadow-sm w-full bg-white/50 backdrop-blur-sm"
            />
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="border border-gray-100 hover:border-orange-100 shadow-sm hover:shadow-md transition-all duration-300 rounded-2xl overflow-hidden">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-orange-50 flex items-center justify-center">
                <Folder className="w-6 h-6 text-orange-500" />
              </div>
              <div>
                <p className="text-3xl font-bold text-gray-900">{categories.length}</p>
                <p className="text-sm text-gray-500 font-medium">Total Categories</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="border border-gray-100 hover:border-orange-100 shadow-sm hover:shadow-md transition-all duration-300 rounded-2xl overflow-hidden">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-orange-50 flex items-center justify-center">
                <FolderOpen className="w-6 h-6 text-orange-500" />
              </div>
              <div>
                <p className="text-3xl font-bold text-orange-500">{mainCategories.length}</p>
                <p className="text-sm text-gray-500 font-medium">Main Categories</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="border border-gray-100 hover:border-orange-100 shadow-sm hover:shadow-md transition-all duration-300 rounded-2xl overflow-hidden">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-orange-50 flex items-center justify-center">
                <Tag className="w-6 h-6 text-orange-500" />
              </div>
              <div>
                <p className="text-3xl font-bold text-orange-500">
                  {categories.filter(cat => cat.parent_id).length}
                </p>
                <p className="text-sm text-gray-500 font-medium">Subcategories</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="border border-gray-100 hover:border-orange-100 shadow-sm hover:shadow-md transition-all duration-300 rounded-2xl overflow-hidden">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-orange-50 flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-orange-500" />
              </div>
              <div>
                <p className="text-3xl font-bold text-orange-500">
                  {categories.filter(cat => cat.is_active).length}
                </p>
                <p className="text-sm text-gray-500 font-medium">Active</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Categories List */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">All Categories</h2>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Settings className="w-4 h-4" />
            <span>Use arrows to reorder</span>
          </div>
        </div>
        
        {filteredMainCategories.length === 0 ? (
          <Card className="border border-gray-100 rounded-2xl overflow-hidden">
            <CardContent className="p-12 text-center">
              <div className="w-16 h-16 rounded-full bg-orange-50 flex items-center justify-center mx-auto mb-6">
                <Folder className="w-8 h-8 text-orange-500" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                {searchTerm ? 'No categories found' : 'No categories yet'}
              </h3>
              <p className="text-gray-500 mb-8">
                {searchTerm 
                  ? 'Try adjusting your search terms' 
                  : 'Create categories to organize your menu items'
                }
              </p>
              {!searchTerm && (
                <Button 
                  onClick={() => {
                    resetForm();
                    setIsAddModalOpen(true);
                  }}
                  className="bg-gradient-to-br from-orange-500 to-orange-600 text-white shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-300 rounded-full px-8 py-3 font-medium"
                >
                  <Plus className="w-5 h-5 mr-2" />
                  Create First Category
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredMainCategories.map((category) => (
              <CategoryCard key={category.id} category={category} />
            ))}
          </div>
        )}
      </div>

      {/* Mobile FAB */}
      <Button
        onClick={() => {
          resetForm();
          setIsAddModalOpen(true);
        }}
        className="fixed bottom-8 right-8 w-14 h-14 rounded-full bg-gradient-to-br from-orange-500 to-orange-600 text-white shadow-xl hover:shadow-2xl hover:scale-110 transition-all duration-300 z-40 flex items-center justify-center sm:hidden"
        size="icon"
      >
        <Plus className="w-6 h-6" />
      </Button>

      {/* Add Category Dialog */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent className="max-w-2xl rounded-2xl p-0 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3 text-xl font-semibold">
                <div className="w-8 h-8 rounded-full bg-orange-50 flex items-center justify-center">
                  <Plus className="w-5 h-5 text-orange-500" />
                </div>
                Add New Category
              </DialogTitle>
              <DialogDescription className="text-sm text-gray-500">
                Create a new category for organizing menu items in {activeLocation?.name}.
              </DialogDescription>
            </DialogHeader>
          </div>
          
          <div className="p-6">
            <CategoryForm />
          </div>
          
          <div className="px-6 py-4 bg-gray-50 flex gap-3 justify-end">
            <Button 
              variant="outline" 
              onClick={() => setIsAddModalOpen(false)}
              className="h-10 px-4 font-medium rounded-full border border-gray-200 hover:border-gray-300 hover:bg-white"
              disabled={saving}
            >
              Cancel
            </Button>
            <Button 
              onClick={addCategory}
              disabled={saving}
              className="h-10 px-4 font-medium bg-gradient-to-br from-orange-500 to-orange-600 text-white shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-300 rounded-full"
            >
              {saving ? (
                <Clock className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Plus className="w-4 h-4 mr-2" />
              )}
              Add Category
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Category Dialog */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="max-w-2xl rounded-2xl p-0 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3 text-xl font-semibold">
                <div className="w-8 h-8 rounded-full bg-orange-50 flex items-center justify-center">
                  <Edit className="w-5 h-5 text-orange-500" />
                </div>
                Edit Category
              </DialogTitle>
              <DialogDescription className="text-sm text-gray-500">
                Update category information for "{editingCategory?.name}".
              </DialogDescription>
            </DialogHeader>
          </div>
          
          <div className="p-6">
            <CategoryForm isEdit={true} />
          </div>
          
          <div className="px-6 py-4 bg-gray-50 flex gap-3 justify-end">
            <Button 
              variant="outline" 
              onClick={() => setIsEditModalOpen(false)}
              className="h-10 px-4 font-medium rounded-full border border-gray-200 hover:border-gray-300 hover:bg-white"
              disabled={saving}
            >
              Cancel
            </Button>
            <Button 
              onClick={editCategory}
              disabled={saving}
              className="h-10 px-4 font-medium bg-gradient-to-br from-orange-500 to-orange-600 text-white shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-300 rounded-full"
            >
              {saving ? (
                <Clock className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Edit className="w-4 h-4 mr-2" />
              )}
              Update Category
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Categories; 