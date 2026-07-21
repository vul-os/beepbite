import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader, PageContainer } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Reveal, Stagger, StaggerItem } from "@/components/ui/motion";
import { Folder, Search, Plus, Edit, Trash2, Eye, EyeOff, ChevronRight, ChevronDown, FolderOpen, Tag, AlertCircle, CheckCircle, Clock, Save, X, MoreHorizontal, FolderPlus, Settings, ArrowUp, ArrowDown, LayoutGrid } from 'lucide-react';
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
      <PageContainer>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted mb-5">
            <AlertCircle className="w-8 h-8 text-muted-foreground" />
          </span>
          <h2 className="font-display text-xl font-semibold text-foreground mb-2">No Location Selected</h2>
          <p className="text-muted-foreground">Please select a location to manage categories.</p>
        </div>
      </PageContainer>
    );
  }

  if (loading) {
    return (
      <PageContainer>
        <div className="flex items-start gap-3">
          <Skeleton className="h-11 w-11 rounded-2xl" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-8 w-36" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      </PageContainer>
    );
  }

  const CategoryForm = ({ isEdit = false }) => (
    <div className="space-y-6 mt-6">
      <div className="space-y-2">
        <label className="text-sm font-semibold text-foreground block">
          Category Name <span className="text-primary">*</span>
        </label>
        <Input
          placeholder="Enter category name"
          value={formData.name}
          onChange={(e) => handleInputChange('name', e.target.value)}
          className="w-full h-11 text-base rounded-xl"
          required
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-semibold text-foreground block">
          Description
        </label>
        <Textarea
          placeholder="Enter category description…"
          value={formData.description}
          onChange={(e) => handleInputChange('description', e.target.value)}
          rows={4}
          className="w-full text-base rounded-xl resize-none"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <label className="text-sm font-semibold text-foreground block">
            Parent Category
          </label>
          <Select value={formData.parent_id || 'none'} onValueChange={(value) => handleInputChange('parent_id', value)}>
            <SelectTrigger className="h-11 text-base rounded-xl">
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
                      <Folder className="w-4 h-4 text-primary" />
                      {cat.name}
                    </div>
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold text-foreground block">
            Sort Order
          </label>
          <Input
            type="number"
            placeholder="0"
            value={formData.sort_order}
            onChange={(e) => handleInputChange('sort_order', e.target.value)}
            className="w-full h-11 text-base rounded-xl"
          />
        </div>
      </div>

      <div className="flex items-center gap-4 p-4 bg-primary/5 rounded-xl border border-primary/10">
        <input
          type="checkbox"
          id="is_active"
          checked={formData.is_active}
          onChange={(e) => handleInputChange('is_active', e.target.checked)}
          className="w-5 h-5 text-primary border-border rounded focus:ring-primary"
        />
        <label htmlFor="is_active" className="text-base font-medium text-foreground">
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
        <Card
          variant="interactive"
          className={cn(
            "group",
            !category.is_active && "opacity-60"
          )}
        >
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                {/* Expand/Collapse Button */}
                {hasSubcategories && !isSubcategory && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleExpanded(category.id)}
                    className="p-2 h-8 w-8 rounded-xl hover:bg-primary/10 hover:text-primary transition-all duration-200 flex-shrink-0 mt-0.5"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </Button>
                )}

                {/* Category icon chip */}
                <span className={cn(
                  "mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ring-1",
                  isSubcategory
                    ? "bg-primary/10 text-primary ring-primary/15"
                    : "bg-primary text-primary-foreground ring-primary/30"
                )}>
                  {isSubcategory ? (
                    <Tag className="w-4 h-4" />
                  ) : hasSubcategories ? (
                    <FolderOpen className="w-4 h-4" />
                  ) : (
                    <Folder className="w-4 h-4" />
                  )}
                </span>

                <div className="flex-1 min-w-0">
                  {isInlineEditing ? (
                    <div className="space-y-3">
                      <Input
                        value={editingInline.name}
                        onChange={(e) => setEditingInline(prev => ({ ...prev, name: e.target.value }))}
                        className="text-base font-medium rounded-xl"
                      />
                      <Textarea
                        value={editingInline.description}
                        onChange={(e) => setEditingInline(prev => ({ ...prev, description: e.target.value }))}
                        className="text-sm rounded-xl resize-none"
                        rows={2}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={saveInlineEdit}
                          className="rounded-xl px-4"
                        >
                          <Save className="w-3.5 h-3.5 mr-2" />
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={cancelInlineEdit}
                          className="rounded-xl px-4"
                        >
                          <X className="w-3.5 h-3.5 mr-2" />
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <h3 className="font-display text-base font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                          {category.name}
                        </h3>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-xs font-medium",
                            category.is_active
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-muted text-muted-foreground border-border"
                          )}
                        >
                          {category.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                        {hasSubcategories && (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            <FolderPlus className="w-3 h-3 mr-1" />
                            {subcategories.length} sub
                          </Badge>
                        )}
                      </div>

                      {category.description && (
                        <p className="text-sm text-muted-foreground mb-2.5 line-clamp-1">
                          {category.description}
                        </p>
                      )}

                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDistanceToNow(new Date(category.created_at), { addSuffix: true })}
                        </span>
                        <span className="flex items-center gap-1">
                          <Settings className="w-3 h-3" />
                          Order: {category.sort_order}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              {!isInlineEditing && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => updateSortOrder(category.id, category.sort_order - 1)}
                    disabled={isLoading}
                    className="p-2 h-8 w-8 rounded-xl hover:bg-primary/10 hover:text-primary"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </Button>

                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => updateSortOrder(category.id, category.sort_order + 1)}
                    disabled={isLoading}
                    className="p-2 h-8 w-8 rounded-xl hover:bg-primary/10 hover:text-primary"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 rounded-xl hover:bg-primary/10 group/menu"
                      >
                        <MoreHorizontal className="w-4 h-4 text-muted-foreground group-hover/menu:text-primary" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem
                        onClick={() => handleInlineEdit(category)}
                        className="flex items-center gap-2"
                      >
                        <Edit className="w-4 h-4" />
                        Quick Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => openEditModal(category)}
                        className="flex items-center gap-2"
                      >
                        <Settings className="w-4 h-4" />
                        Full Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => toggleCategoryStatus(category.id, category.is_active)}
                        className="flex items-center gap-2"
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
                        className="flex items-center gap-2 text-destructive hover:text-destructive"
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
          <div className="space-y-3 pl-4 border-l-2 border-primary/20">
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
    <PageContainer>
      {/* Page Header */}
      <Reveal>
        <PageHeader
          eyebrow="Menu"
          title="Categories"
          icon={LayoutGrid}
          description={`Organize your menu items into categories for ${activeLocation?.name}`}
          actions={
            <Button
              onClick={() => {
                resetForm();
                setIsAddModalOpen(true);
              }}
              className="gap-2"
            >
              <Plus className="w-4 h-4" />
              New Category
            </Button>
          }
        />
      </Reveal>

      {/* Stat Cards */}
      <Stagger className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StaggerItem>
          <StatCard
            label="Total Categories"
            value={categories.length}
            icon={Folder}
            hint="across this location"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Main Categories"
            value={mainCategories.length}
            icon={FolderOpen}
            hint="top-level groups"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Subcategories"
            value={categories.filter(cat => cat.parent_id).length}
            icon={Tag}
            hint="nested categories"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Active"
            value={categories.filter(cat => cat.is_active).length}
            icon={CheckCircle}
            hint="visible on menu"
          />
        </StaggerItem>
      </Stagger>

      {/* Search + list header */}
      <Reveal delay={0.1}>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="relative flex-1 w-full sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4 pointer-events-none" />
            <Input
              placeholder="Search categories…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 rounded-xl h-10 w-full"
            />
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Settings className="w-3.5 h-3.5" />
            <span>Use arrows to reorder</span>
          </div>
        </div>
      </Reveal>

      {/* Categories List */}
      {filteredMainCategories.length === 0 ? (
        <Reveal delay={0.15}>
          <Card variant="elevated">
            <CardContent className="p-12 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 mx-auto mb-6">
                <Folder className="w-8 h-8 text-primary" />
              </span>
              <h3 className="font-display text-xl font-semibold text-foreground mb-2">
                {searchTerm ? 'No categories found' : 'No categories yet'}
              </h3>
              <p className="text-muted-foreground mb-8 max-w-xs mx-auto">
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
                  className="gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Create First Category
                </Button>
              )}
            </CardContent>
          </Card>
        </Reveal>
      ) : (
        <Stagger className="space-y-3">
          {filteredMainCategories.map((category) => (
            <StaggerItem key={category.id}>
              <CategoryCard category={category} />
            </StaggerItem>
          ))}
        </Stagger>
      )}

      {/* Mobile FAB */}
      <Button
        onClick={() => {
          resetForm();
          setIsAddModalOpen(true);
        }}
        className="fixed bottom-8 right-8 w-14 h-14 rounded-full shadow-xl hover:shadow-2xl transition-all duration-300 z-40 flex items-center justify-center sm:hidden"
        size="icon"
      >
        <Plus className="w-6 h-6" />
      </Button>

      {/* Add Category Dialog */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent className="max-w-2xl rounded-2xl p-0 overflow-hidden">
          <div className="px-6 py-5 border-b border-border">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3 text-xl font-semibold">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Plus className="w-4 h-4" />
                </span>
                Add New Category
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                Create a new category for organizing menu items in {activeLocation?.name}.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="p-6">
            <CategoryForm />
          </div>

          <div className="px-6 py-4 bg-muted/40 border-t border-border flex gap-3 justify-end">
            <Button
              variant="outline"
              onClick={() => setIsAddModalOpen(false)}
              className="rounded-xl"
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              onClick={addCategory}
              disabled={saving}
              className="rounded-xl gap-2"
            >
              {saving ? (
                <Clock className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              Add Category
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Category Dialog */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="max-w-2xl rounded-2xl p-0 overflow-hidden">
          <div className="px-6 py-5 border-b border-border">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3 text-xl font-semibold">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Edit className="w-4 h-4" />
                </span>
                Edit Category
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                Update category information for "{editingCategory?.name}".
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="p-6">
            <CategoryForm isEdit={true} />
          </div>

          <div className="px-6 py-4 bg-muted/40 border-t border-border flex gap-3 justify-end">
            <Button
              variant="outline"
              onClick={() => setIsEditModalOpen(false)}
              className="rounded-xl"
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              onClick={editCategory}
              disabled={saving}
              className="rounded-xl gap-2"
            >
              {saving ? (
                <Clock className="w-4 h-4 animate-spin" />
              ) : (
                <Edit className="w-4 h-4" />
              )}
              Update Category
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
};

export default Categories;
