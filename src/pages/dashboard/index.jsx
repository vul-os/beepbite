import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { 
  Plus, 
  Search, 
  Bell, 
  Clock, 
  CheckCircle, 
  AlertCircle,
  MoreHorizontal,
  Phone,
  Hash,
  Play,
  Check,
  MessageSquare,
  Eye,
  ArrowRight,
  ChefHat,
  Utensils
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import CreateBiteModal from '@/components/modals/create-bite-modal';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/services/supabase-client';
import { formatDistanceToNow } from 'date-fns';

const Dashboard = () => {
  const { user } = useAuth();
  const [bites, setBites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('current');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [currentBistro, setCurrentBistro] = useState(null);
  const [confirmCompleteDialog, setConfirmCompleteDialog] = useState({ isOpen: false, biteId: null, orderNumber: '' });

  useEffect(() => {
    fetchCurrentBistro();
  }, [user]);

  useEffect(() => {
    if (currentBistro) {
      fetchBites();
    }
  }, [currentBistro]);

  const fetchCurrentBistro = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('bistro_members')
        .select(`
          bistro_id,
          role,
          bistros (
            id,
            name,
            description
          )
        `)
        .eq('profile_id', user.id)
        .single();

      if (error) throw error;
      setCurrentBistro(data.bistros);
    } catch (error) {
      console.error('Error fetching bistro:', error);
    }
  };

  const fetchBites = async () => {
    if (!currentBistro) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('bites')
        .select('*')
        .eq('bistro_id', currentBistro.id)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      setBites(data || []);
    } catch (error) {
      console.error('Error fetching bites:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateBiteStatus = async (biteId, newStatus) => {
    try {
      // Update local state immediately for better UX
      setBites(prev => prev.map(bite => 
        bite.id === biteId 
          ? { 
              ...bite, 
              status: newStatus,
              order_ready_at: newStatus === 'ready' ? new Date().toISOString() : bite.order_ready_at
            }
          : bite
      ));

      const updateData = { 
        status: newStatus,
        updated_at: new Date().toISOString()
      };

      if (newStatus === 'ready') {
        updateData.order_ready_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from('bites')
        .update(updateData)
        .eq('id', biteId);
      
      if (error) throw error;
    } catch (error) {
      console.error('Error updating bite status:', error);
      // Revert optimistic update on error
      fetchBites();
    }
  };

  const handleCompleteOrder = (biteId, orderNumber) => {
    setConfirmCompleteDialog({ isOpen: true, biteId, orderNumber });
  };

  const confirmCompleteOrder = () => {
    updateBiteStatus(confirmCompleteDialog.biteId, 'completed');
    setConfirmCompleteDialog({ isOpen: false, biteId: null, orderNumber: '' });
  };

  const cancelCompleteOrder = () => {
    setConfirmCompleteDialog({ isOpen: false, biteId: null, orderNumber: '' });
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-4 h-4" />;
      case 'preparing':
        return <AlertCircle className="w-4 h-4" />;
      case 'ready':
        return <Bell className="w-4 h-4" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4" />;
      default:
        return <Clock className="w-4 h-4" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'preparing':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'ready':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'completed':
        return 'bg-gray-100 text-gray-800 border-gray-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const filteredBites = bites.filter(bite => {
    const matchesSearch = bite.order_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         bite.whatsapp_number.includes(searchTerm);
    
    // If searching, show all matching results regardless of status filter
    if (searchTerm.trim()) {
      return matchesSearch;
    }
    
    // Otherwise apply status filter
    let matchesStatus = false;
    switch (statusFilter) {
      case 'current':
        matchesStatus = ['pending', 'preparing', 'ready'].includes(bite.status);
        break;
      case 'all':
        matchesStatus = true;
        break;
      default:
        matchesStatus = bite.status === statusFilter;
    }
    
    return matchesStatus;
  });

  const statusCounts = {
    current: bites.filter(b => ['pending', 'preparing', 'ready'].includes(b.status)).length,
    all: bites.length,
    pending: bites.filter(b => b.status === 'pending').length,
    preparing: bites.filter(b => b.status === 'preparing').length,
    ready: bites.filter(b => b.status === 'ready').length,
    completed: bites.filter(b => b.status === 'completed').length,
  };

  if (loading) {
    return (
      <div className="container mx-auto p-4">
        <div className="space-y-4">
          <div className="h-12 bg-gray-200 rounded w-full animate-pulse"></div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
            {[...Array(12)].map((_, i) => (
              <div key={i} className="h-40 bg-gray-200 rounded animate-pulse"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      {/* Search and Create Button */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <Input
            placeholder="Search by order number or phone..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-12 h-14 text-lg font-medium"
          />
        </div>
        {/* Desktop Create Button - Hidden on mobile */}
        <Button 
          onClick={() => setIsCreateModalOpen(true)}
          size="lg"
          className="hidden sm:flex beepbite-gradient text-white shadow-lg hover:shadow-xl transition-all duration-300 h-14 px-6"
        >
          <Plus className="w-5 h-5 mr-2" />
          Create
        </Button>
      </div>

      {/* Mobile FAB - Only visible on mobile */}
      <Button
        onClick={() => setIsCreateModalOpen(true)}
        className="sm:hidden fixed bottom-6 right-6 w-16 h-16 rounded-full beepbite-gradient text-white shadow-xl hover:shadow-2xl transition-all duration-300 z-50 flex items-center justify-center"
        size="lg"
      >
        <Plus className="w-8 h-8" />
      </Button>

      {/* Status Filter Buttons */}
      <div className="flex flex-wrap gap-2">
        {[
          { key: 'current', label: 'Current', count: statusCounts.current, color: 'bg-orange-100 text-orange-800' },
          { key: 'all', label: 'All', count: statusCounts.all, color: 'bg-gray-100 text-gray-800' },
          { key: 'pending', label: 'Pending', count: statusCounts.pending, color: 'bg-yellow-100 text-yellow-800' },
          { key: 'preparing', label: 'Preparing', count: statusCounts.preparing, color: 'bg-blue-100 text-blue-800' },
          { key: 'ready', label: 'Ready', count: statusCounts.ready, color: 'bg-green-100 text-green-800' },
          { key: 'completed', label: 'Completed', count: statusCounts.completed, color: 'bg-gray-100 text-gray-800' },
        ].map((status) => (
          <Button
            key={status.key}
            variant={statusFilter === status.key ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter(status.key)}
            className={`whitespace-nowrap h-10 px-4 ${
              statusFilter === status.key 
                ? 'beepbite-gradient text-white' 
                : 'hover:bg-gray-50'
            }`}
          >
            <span className="font-medium">{status.label}</span>
            <Badge variant="secondary" className="ml-2 text-xs">
              {status.count}
            </Badge>
          </Button>
        ))}
      </div>

      {/* Orders Grid */}
      <div className="space-y-4">
        {filteredBites.length === 0 ? (
          <Card className="p-8 text-center">
            <div className="space-y-4">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto">
                <Hash className="w-8 h-8 text-gray-400" />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-medium text-gray-900">
                  {searchTerm ? 'No orders found' : 'No orders in this view'}
                </h3>
                <p className="text-base text-gray-500">
                  {searchTerm 
                    ? 'Try adjusting your search terms' 
                    : statusFilter === 'current'
                      ? 'No active orders at the moment'
                      : statusFilter === 'all'
                        ? 'Create your first bite to get started'
                        : `No ${statusFilter} orders found`
                  }
                </p>
              </div>
              {!searchTerm && statusFilter === 'current' && (
                <Button 
                  onClick={() => setIsCreateModalOpen(true)}
                  className="beepbite-gradient text-white"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Create First Bite
                </Button>
              )}
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredBites.map((bite) => (
              <Card key={bite.id} className="hover:shadow-lg transition-all duration-200 border-l-4 border-l-orange-500 min-h-fit">
                <CardHeader className="pb-3 px-4 pt-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
                        <Hash className="w-4 h-4 text-orange-600 shrink-0" />
                        <span className="truncate">{bite.order_number}</span>
                      </CardTitle>
                    </div>
                    
                    {/* Status Button */}
                    <Button
                      size="default"
                      className={`w-full h-10 text-sm ${getStatusColor(bite.status)} border hover:shadow-sm transition-all duration-200`}
                      variant="outline"
                      onClick={() => {
                        if (bite.status === 'pending') updateBiteStatus(bite.id, 'preparing');
                        else if (bite.status === 'preparing') updateBiteStatus(bite.id, 'ready');
                        else if (bite.status === 'ready') updateBiteStatus(bite.id, 'completed');
                      }}
                    >
                      <span className="flex items-center gap-2 justify-center">
                        {getStatusIcon(bite.status)}
                        <span className="capitalize font-medium">{bite.status}</span>
                      </span>
                    </Button>
                  </div>
                </CardHeader>
                
                <CardContent className="space-y-4 px-4 pb-4">
                  <div className="space-y-2">
                    <div className="flex items-center text-sm text-gray-600">
                      <Phone className="w-4 h-4 mr-2 text-gray-400 shrink-0" />
                      <span className="truncate">{bite.whatsapp_number}</span>
                    </div>
                    <div className="text-sm text-gray-500">
                      {formatDistanceToNow(new Date(bite.created_at), { addSuffix: true })}
                    </div>
                    {bite.order_ready_at && (
                      <div className="text-sm text-green-600 font-medium">
                        Ready {formatDistanceToNow(new Date(bite.order_ready_at), { addSuffix: true })}
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="space-y-3">
                    {/* Status Change Buttons */}
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        size="default"
                        variant={bite.status === 'pending' ? "default" : "outline"}
                        onClick={() => updateBiteStatus(bite.id, 'pending')}
                        className={`h-10 text-sm transition-all duration-200 ${
                          bite.status === 'pending' 
                            ? 'bg-yellow-600 hover:bg-yellow-700 text-white' 
                            : 'hover:bg-yellow-50 hover:border-yellow-200 hover:text-yellow-700'
                        }`}
                      >
                        <Clock className="w-4 h-4 mr-2" />
                        Pending
                      </Button>
                      
                      <Button
                        size="default"
                        variant={bite.status === 'preparing' ? "default" : "outline"}
                        onClick={() => updateBiteStatus(bite.id, 'preparing')}
                        className={`h-10 text-sm transition-all duration-200 ${
                          bite.status === 'preparing' 
                            ? 'bg-blue-600 hover:bg-blue-700 text-white' 
                            : 'hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700'
                        }`}
                      >
                        <ChefHat className="w-4 h-4 mr-2" />
                        Preparing
                      </Button>
                      
                      <Button
                        size="default"
                        variant={bite.status === 'ready' ? "default" : "outline"}
                        onClick={() => updateBiteStatus(bite.id, 'ready')}
                        className={`h-10 text-sm transition-all duration-200 ${
                          bite.status === 'ready' 
                            ? 'bg-green-600 hover:bg-green-700 text-white' 
                            : 'hover:bg-green-50 hover:border-green-200 hover:text-green-700'
                        }`}
                      >
                        <Bell className="w-4 h-4 mr-2" />
                        Ready
                      </Button>
                      
                      <Button
                        size="default"
                        variant={bite.status === 'completed' ? "default" : "outline"}
                        onClick={() => bite.status !== 'completed' && handleCompleteOrder(bite.id, bite.order_number)}
                        disabled={bite.status === 'completed'}
                        className={`h-10 text-sm transition-all duration-200 ${
                          bite.status === 'completed' 
                            ? 'bg-gray-600 text-white cursor-not-allowed' 
                            : 'hover:bg-gray-50 hover:border-gray-200 hover:text-gray-700'
                        }`}
                      >
                        <CheckCircle className="w-4 h-4 mr-2" />
                        Done
                      </Button>
                    </div>

                    {/* Big Complete Button - Only show for ready orders */}
                    {bite.status === 'ready' && (
                      <Button
                        size="lg"
                        onClick={() => handleCompleteOrder(bite.id, bite.order_number)}
                        className="w-full h-12 bg-orange-600 hover:bg-orange-700 text-white font-bold text-base shadow-lg hover:shadow-xl transition-all duration-300"
                      >
                        <CheckCircle className="w-5 h-5 mr-2" />
                        COMPLETE ORDER
                      </Button>
                    )}

                    {/* Secondary Actions */}
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="default"
                        className="flex-1 h-10 text-sm hover:bg-orange-50 hover:border-orange-200"
                        onClick={() => {
                          console.log('Send notification for order:', bite.order_number);
                        }}
                      >
                        <MessageSquare className="w-4 h-4 mr-2" />
                        Notify
                      </Button>
                      
                      <Button
                        variant="outline"
                        size="default"
                        className="flex-1 h-10 text-sm hover:bg-blue-50 hover:border-blue-200"
                        onClick={() => {
                          console.log('View details for order:', bite.order_number);
                        }}
                      >
                        <Eye className="w-4 h-4 mr-2" />
                        Details
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create Bite Modal */}
      <CreateBiteModal 
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onBiteCreated={fetchBites}
      />

      {/* Complete Order Confirmation Dialog */}
      <AlertDialog open={confirmCompleteDialog.isOpen} onOpenChange={cancelCompleteOrder}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Complete Order?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to mark order <strong>#{confirmCompleteDialog.orderNumber}</strong> as completed? 
              This action will finalize the order.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelCompleteOrder}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmCompleteOrder}
              className="bg-orange-600 hover:bg-orange-700"
            >
              Yes, Complete Order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Dashboard; 