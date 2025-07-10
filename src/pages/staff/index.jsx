import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { 
  Users, 
  Search, 
  UserPlus,
  Edit,
  Trash2,
  Shield,
  Crown,
  User,
  ChefHat,
  CreditCard,
  Clock,
  Mail,
  Phone,
  Calendar,
  MapPin,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle,
  XCircle,
  Building2
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/services/supabase-client';
import { cn } from "@/lib/utils";
import { formatDistanceToNow, format } from 'date-fns';

const Staff = () => {
  const { activeLocation, activeOrganization } = useAuth();
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState(null);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [formData, setFormData] = useState({
    employee_id: '',
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    password: '',
    role: 'cashier',
    hire_date: '',
    notes: '',
    is_active: true
  });

  useEffect(() => {
    if (activeLocation) {
      fetchStaff();
    } else {
      setStaff([]);
      setLoading(false);
    }
  }, [activeLocation]);

  const fetchStaff = async () => {
    if (!activeLocation) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('staff')
        .select('*')
        .eq('location_id', activeLocation.id)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      setStaff(data || []);
    } catch (error) {
      console.error('Error fetching staff:', error);
    } finally {
      setLoading(false);
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
      employee_id: '',
      first_name: '',
      last_name: '',
      email: '',
      phone: '',
      password: '',
      role: 'cashier',
      hire_date: '',
      notes: '',
      is_active: true
    });
  };

  const addStaff = async () => {
    if (!activeLocation || !formData.first_name || !formData.last_name || !formData.email || !formData.password) {
      alert('Please fill in all required fields');
      return;
    }
    
    setSaving(true);
    try {
      // In a real app, you'd hash the password on the backend
      const { data, error } = await supabase
        .from('staff')
        .insert({
          location_id: activeLocation.id,
          employee_id: formData.employee_id || null,
          first_name: formData.first_name.trim(),
          last_name: formData.last_name.trim(),
          email: formData.email.trim().toLowerCase(),
          phone: formData.phone.trim() || null,
          password_hash: formData.password, // In production, this should be hashed
          role: formData.role,
          hire_date: formData.hire_date || null,
          notes: formData.notes.trim() || null,
          is_active: formData.is_active
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          if (error.message.includes('email')) {
            throw new Error('This email is already in use');
          } else if (error.message.includes('employee_id')) {
            throw new Error('This employee ID is already in use');
          }
        }
        throw error;
      }

      setIsAddModalOpen(false);
      resetForm();
      fetchStaff();
      alert('Staff member added successfully!');
    } catch (error) {
      console.error('Error adding staff:', error);
      alert(error.message || 'Failed to add staff member');
    } finally {
      setSaving(false);
    }
  };

  const editStaff = async () => {
    if (!editingStaff || !formData.first_name || !formData.last_name || !formData.email) {
      alert('Please fill in all required fields');
      return;
    }
    
    setSaving(true);
    try {
      const updateData = {
        employee_id: formData.employee_id || null,
        first_name: formData.first_name.trim(),
        last_name: formData.last_name.trim(),
        email: formData.email.trim().toLowerCase(),
        phone: formData.phone.trim() || null,
        role: formData.role,
        hire_date: formData.hire_date || null,
        notes: formData.notes.trim() || null,
        is_active: formData.is_active,
        updated_at: new Date().toISOString()
      };

      // Only update password if provided
      if (formData.password) {
        updateData.password_hash = formData.password; // In production, hash this
      }

      const { error } = await supabase
        .from('staff')
        .update(updateData)
        .eq('id', editingStaff.id);

      if (error) {
        if (error.code === '23505') {
          if (error.message.includes('email')) {
            throw new Error('This email is already in use');
          } else if (error.message.includes('employee_id')) {
            throw new Error('This employee ID is already in use');
          }
        }
        throw error;
      }

      setIsEditModalOpen(false);
      setEditingStaff(null);
      resetForm();
      fetchStaff();
      alert('Staff member updated successfully!');
    } catch (error) {
      console.error('Error updating staff:', error);
      alert(error.message || 'Failed to update staff member');
    } finally {
      setSaving(false);
    }
  };

  const deleteStaff = async (staffId, staffName) => {
    if (!confirm(`Are you sure you want to delete ${staffName}? This action cannot be undone.`)) return;
    
    setActionLoading(staffId);
    try {
      const { error } = await supabase
        .from('staff')
        .delete()
        .eq('id', staffId);
      
      if (error) throw error;
      fetchStaff();
      alert('Staff member deleted successfully');
    } catch (error) {
      console.error('Error deleting staff:', error);
      alert('Failed to delete staff member');
    } finally {
      setActionLoading('');
    }
  };

  const toggleStaffStatus = async (staffId, currentStatus) => {
    setActionLoading(staffId);
    try {
      const { error } = await supabase
        .from('staff')
        .update({ 
          is_active: !currentStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', staffId);
      
      if (error) throw error;
      fetchStaff();
    } catch (error) {
      console.error('Error updating staff status:', error);
      alert('Failed to update staff status');
    } finally {
      setActionLoading('');
    }
  };

  const openEditModal = (staffMember) => {
    setEditingStaff(staffMember);
    setFormData({
      employee_id: staffMember.employee_id || '',
      first_name: staffMember.first_name || '',
      last_name: staffMember.last_name || '',
      email: staffMember.email || '',
      phone: staffMember.phone || '',
      password: '', // Don't pre-fill password
      role: staffMember.role || 'cashier',
      hire_date: staffMember.hire_date || '',
      notes: staffMember.notes || '',
      is_active: staffMember.is_active ?? true
    });
    setIsEditModalOpen(true);
  };

  const getRoleIcon = (role) => {
    switch (role) {
      case 'owner':
        return <Crown className="w-4 h-4" />;
      case 'admin':
        return <Shield className="w-4 h-4" />;
      case 'manager':
        return <ChefHat className="w-4 h-4" />;
      case 'cashier':
        return <CreditCard className="w-4 h-4" />;
      case 'kitchen':
        return <User className="w-4 h-4" />;
      default:
        return <User className="w-4 h-4" />;
    }
  };

  const getRoleColor = (role) => {
    switch (role) {
      case 'owner':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'admin':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'manager':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'cashier':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'kitchen':
        return 'bg-gray-100 text-gray-800 border-gray-200';
      default:
        return 'bg-gray-100 text-gray-600 border-gray-200';
    }
  };

  const getInitials = (firstName, lastName) => {
    return `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase();
  };

  const filteredStaff = staff.filter(member => {
    const fullName = `${member.first_name} ${member.last_name}`.toLowerCase();
    const email = member.email?.toLowerCase() || '';
    const employeeId = member.employee_id?.toLowerCase() || '';
    const search = searchTerm.toLowerCase();
    
    return fullName.includes(search) || 
           email.includes(search) || 
           employeeId.includes(search);
  });

  if (!activeLocation) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <AlertCircle className="w-16 h-16 text-gray-400 mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">No Location Selected</h2>
        <p className="text-gray-600">Please select a location to manage staff members.</p>
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

  const StaffForm = ({ isEdit = false }) => (
    <div className="space-y-4 mt-4 max-h-96 overflow-y-auto">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-2">
            First Name <span className="text-red-500">*</span>
          </label>
          <Input
            placeholder="Enter first name"
            value={formData.first_name}
            onChange={(e) => handleInputChange('first_name', e.target.value)}
            className="w-full"
            required
          />
        </div>
        
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-2">
            Last Name <span className="text-red-500">*</span>
          </label>
          <Input
            placeholder="Enter last name"
            value={formData.last_name}
            onChange={(e) => handleInputChange('last_name', e.target.value)}
            className="w-full"
            required
          />
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-2">
            Email <span className="text-red-500">*</span>
          </label>
          <Input
            type="email"
            placeholder="Enter email address"
            value={formData.email}
            onChange={(e) => handleInputChange('email', e.target.value)}
            className="w-full"
            required
          />
        </div>
        
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-2">
            Phone
          </label>
          <Input
            type="tel"
            placeholder="Enter phone number"
            value={formData.phone}
            onChange={(e) => handleInputChange('phone', e.target.value)}
            className="w-full"
          />
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-2">
            Employee ID
          </label>
          <Input
            placeholder="Enter employee ID"
            value={formData.employee_id}
            onChange={(e) => handleInputChange('employee_id', e.target.value)}
            className="w-full"
          />
        </div>
        
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-2">
            Role <span className="text-red-500">*</span>
          </label>
          <Select value={formData.role} onValueChange={(value) => handleInputChange('role', value)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cashier">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-4 h-4" />
                  Cashier
                </div>
              </SelectItem>
              <SelectItem value="kitchen">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Kitchen Staff
                </div>
              </SelectItem>
              <SelectItem value="manager">
                <div className="flex items-center gap-2">
                  <ChefHat className="w-4 h-4" />
                  Manager
                </div>
              </SelectItem>
              <SelectItem value="admin">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  Admin
                </div>
              </SelectItem>
              <SelectItem value="owner">
                <div className="flex items-center gap-2">
                  <Crown className="w-4 h-4" />
                  Owner
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-2">
            Password {isEdit ? '' : <span className="text-red-500">*</span>}
          </label>
          <Input
            type="password"
            placeholder={isEdit ? "Leave blank to keep current password" : "Enter password"}
            value={formData.password}
            onChange={(e) => handleInputChange('password', e.target.value)}
            className="w-full"
            required={!isEdit}
          />
        </div>
        
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-2">
            Hire Date
          </label>
          <Input
            type="date"
            value={formData.hire_date}
            onChange={(e) => handleInputChange('hire_date', e.target.value)}
            className="w-full"
          />
        </div>
      </div>
      
      <div>
        <label className="text-sm font-medium text-gray-700 block mb-2">
          Notes
        </label>
        <Textarea
          placeholder="Enter any additional notes..."
          value={formData.notes}
          onChange={(e) => handleInputChange('notes', e.target.value)}
          rows={3}
          className="w-full"
        />
      </div>
      
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id="is_active"
          checked={formData.is_active}
          onChange={(e) => handleInputChange('is_active', e.target.checked)}
          className="w-4 h-4 text-orange-600 border-gray-300 rounded focus:ring-orange-500"
        />
        <label htmlFor="is_active" className="text-sm font-medium text-gray-700">
          Active Employee
        </label>
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
              <Users className="w-8 h-8 text-orange-500" />
              Staff Management
            </h1>
            <p className="text-gray-600 mt-1">
              Manage staff members for {activeLocation?.name}
            </p>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative max-w-2xl">
          <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <Input
            placeholder="Search staff by name, email, or employee ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-12 h-12 text-base font-medium border-gray-200 focus:border-orange-300 focus:ring-orange-200"
          />
        </div>
      </div>

      {/* FAB - Add Staff Button */}
      <Button
        onClick={() => {
          resetForm();
          setIsAddModalOpen(true);
        }}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full beepbite-gradient text-white shadow-xl hover:shadow-2xl transition-all duration-300 z-40 flex items-center justify-center sm:hidden"
        size="lg"
      >
        <UserPlus className="w-6 h-6" />
      </Button>

      {/* Desktop Add Button */}
      <div className="hidden sm:flex justify-end">
        <Button 
          onClick={() => {
            resetForm();
            setIsAddModalOpen(true);
          }}
          className="beepbite-gradient text-white shadow-lg hover:shadow-xl transition-all duration-200"
        >
          <UserPlus className="w-4 h-4 mr-2" />
          Add Staff Member
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-gray-200 hover:border-orange-200 transition-colors">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-3xl font-bold text-gray-900">{staff.length}</p>
                <p className="text-sm text-gray-600 mt-1">Total Staff</p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center">
                <Users className="w-6 h-6 text-gray-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-gray-200 hover:border-green-200 transition-colors">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-3xl font-bold text-green-600">
                  {staff.filter(s => s.is_active).length}
                </p>
                <p className="text-sm text-gray-600 mt-1">Active</p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-green-100 flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-gray-200 hover:border-red-200 transition-colors">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-3xl font-bold text-red-600">
                  {staff.filter(s => !s.is_active).length}
                </p>
                <p className="text-sm text-gray-600 mt-1">Inactive</p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-red-100 flex items-center justify-center">
                <XCircle className="w-6 h-6 text-red-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-gray-200 hover:border-orange-200 transition-colors">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-semibold text-gray-900 truncate">{activeLocation?.name}</p>
                <p className="text-sm text-gray-600 mt-1">Current Location</p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-orange-100 flex items-center justify-center">
                <MapPin className="w-6 h-6 text-orange-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Staff Grid */}
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-gray-900">Staff Members</h2>
        
        {filteredStaff.length === 0 ? (
          <Card className="border-gray-200">
            <CardContent className="p-12 text-center">
              <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center mx-auto mb-4">
                <Users className="w-8 h-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {searchTerm ? 'No staff found' : 'No staff members yet'}
              </h3>
              <p className="text-gray-600 mb-6">
                {searchTerm 
                  ? 'Try adjusting your search terms' 
                  : 'Add staff members to manage your team'
                }
              </p>
              {!searchTerm && (
                <Button 
                  onClick={() => {
                    resetForm();
                    setIsAddModalOpen(true);
                  }}
                  className="bg-orange-500 hover:bg-orange-600 text-white"
                >
                  <UserPlus className="w-4 h-4 mr-2" />
                  Add First Staff Member
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
            {filteredStaff.map((staffMember) => {
              const isLoading = actionLoading === staffMember.id;
              
              return (
                <Card key={staffMember.id} className="border-gray-200 hover:border-orange-200 hover:shadow-md transition-all duration-200">
                  <CardContent className="p-6">
                    <div className="space-y-4">
                      {/* Staff Info */}
                      <div className="flex items-start gap-4">
                        <Avatar className="h-14 w-14 border-2 border-gray-100">
                          <AvatarFallback className="bg-gray-100 text-gray-700 font-semibold text-lg">
                            {getInitials(staffMember.first_name, staffMember.last_name)}
                          </AvatarFallback>
                        </Avatar>
                        
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-gray-900 text-lg truncate mb-1">
                            {staffMember.first_name} {staffMember.last_name}
                          </h3>
                          <p className="text-sm text-gray-600 truncate mb-2">
                            {staffMember.email}
                          </p>
                          
                          {staffMember.employee_id && (
                            <p className="text-xs text-gray-500 mb-2">
                              ID: {staffMember.employee_id}
                            </p>
                          )}
                          
                          <div className="flex items-center gap-2 mb-2">
                            <Badge 
                              variant="outline" 
                              className={cn("text-xs font-medium", getRoleColor(staffMember.role))}
                            >
                              <span className="flex items-center gap-1.5">
                                {getRoleIcon(staffMember.role)}
                                {staffMember.role}
                              </span>
                            </Badge>
                            
                            <Badge 
                              variant="outline"
                              className={cn(
                                "text-xs font-medium",
                                staffMember.is_active 
                                  ? "bg-green-50 text-green-700 border-green-200"
                                  : "bg-red-50 text-red-700 border-red-200"
                              )}
                            >
                              {staffMember.is_active ? 'Active' : 'Inactive'}
                            </Badge>
                          </div>
                          
                          {staffMember.hire_date && (
                            <p className="text-xs text-gray-500 mb-2">
                              Hired: {format(new Date(staffMember.hire_date), 'MMM dd, yyyy')}
                            </p>
                          )}
                          
                          <p className="text-xs text-gray-500">
                            Added {formatDistanceToNow(new Date(staffMember.created_at), { addSuffix: true })}
                          </p>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="space-y-2 pt-4 border-t border-gray-100">
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEditModal(staffMember)}
                            disabled={isLoading}
                            className="text-xs hover:bg-blue-50 border-blue-200 text-blue-700"
                          >
                            <Edit className="w-3 h-3 mr-1" />
                            Edit
                          </Button>
                          
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => toggleStaffStatus(staffMember.id, staffMember.is_active)}
                            disabled={isLoading}
                            className={cn(
                              "text-xs",
                              staffMember.is_active
                                ? "hover:bg-red-50 border-red-200 text-red-700"
                                : "hover:bg-green-50 border-green-200 text-green-700"
                            )}
                          >
                            {staffMember.is_active ? (
                              <>
                                <EyeOff className="w-3 h-3 mr-1" />
                                Deactivate
                              </>
                            ) : (
                              <>
                                <Eye className="w-3 h-3 mr-1" />
                                Activate
                              </>
                            )}
                          </Button>
                        </div>

                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => deleteStaff(staffMember.id, `${staffMember.first_name} ${staffMember.last_name}`)}
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

      {/* Add Staff Dialog */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-orange-500" />
              Add New Staff Member
            </DialogTitle>
            <DialogDescription>
              Add a new staff member to {activeLocation?.name}.
            </DialogDescription>
          </DialogHeader>
          
          <StaffForm />
          
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
              onClick={addStaff}
              disabled={saving}
              className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
            >
              {saving ? (
                <Clock className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <UserPlus className="w-4 h-4 mr-2" />
              )}
              Add Staff Member
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Staff Dialog */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit className="w-5 h-5 text-blue-500" />
              Edit Staff Member
            </DialogTitle>
            <DialogDescription>
              Update information for {editingStaff?.first_name} {editingStaff?.last_name}.
            </DialogDescription>
          </DialogHeader>
          
          <StaffForm isEdit={true} />
          
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
              onClick={editStaff}
              disabled={saving}
              className="flex-1 bg-blue-500 hover:bg-blue-600 text-white"
            >
              {saving ? (
                <Clock className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Edit className="w-4 h-4 mr-2" />
              )}
              Update Staff Member
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Staff; 