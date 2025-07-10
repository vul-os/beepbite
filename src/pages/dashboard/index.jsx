import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { 
  Plus, 
  Search, 
  Hash
} from 'lucide-react';
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
import AcceptInviteDialog from '@/components/modals/accept-invite-dialog';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/services/supabase-client';
import BiteCard from './bite-card';
import StatusFilters from './status-filters';
import InviteBanner from './invite-banner';

const Dashboard = () => {
  const { user, pendingInvites, acceptInvite, rejectInvite, activeOrganization, activeLocation } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('current');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [currentBistro, setCurrentBistro] = useState(null);
  const [confirmCompleteDialog, setConfirmCompleteDialog] = useState({ isOpen: false, orderId: null, orderNumber: '' });
  const [currentTime, setCurrentTime] = useState(new Date());

  // Custom function to format time with seconds always visible
  const formatTimeWithSeconds = (date) => {
    const diffInSeconds = Math.floor((currentTime - new Date(date)) / 1000);
    
    const days = Math.floor(diffInSeconds / 86400);
    const hours = Math.floor((diffInSeconds % 86400) / 3600);
    const minutes = Math.floor((diffInSeconds % 3600) / 60);
    const seconds = diffInSeconds % 60;
    
    const parts = [];
    
    if (days > 0) {
      parts.push(`${days} day${days !== 1 ? 's' : ''}`);
    }
    if (hours > 0) {
      parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
    }
    if (minutes > 0) {
      parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
    }
    if (seconds > 0 || parts.length === 0) {
      parts.push(`${seconds} second${seconds !== 1 ? 's' : ''}`);
    }
    
    return `${parts.join(' ')} ago`;
  };

  // Live timer for updating timestamps every 2 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 2000); // Update every 2 seconds

    return () => clearInterval(timer);
  }, []);

  // Show invite dialog automatically when there are pending invites
  useEffect(() => {
    if (pendingInvites && pendingInvites.length > 0 && !isInviteDialogOpen) {
      setIsInviteDialogOpen(true);
    } else if (pendingInvites && pendingInvites.length === 0 && isInviteDialogOpen) {
      setIsInviteDialogOpen(false);
    }
  }, [pendingInvites, isInviteDialogOpen]);

  const handleAcceptInvite = async (inviteId) => {
    setInviteLoading(true);
    try {
      await acceptInvite(inviteId);
      // Dialog will close automatically when pendingInvites updates
    } catch (error) {
      console.error('Failed to accept invite:', error);
    } finally {
      setInviteLoading(false);
    }
  };

  const handleRejectInvite = async (inviteId) => {
    setInviteLoading(true);
    try {
      await rejectInvite(inviteId);
      // Dialog will close automatically when pendingInvites updates
    } catch (error) {
      console.error('Failed to reject invite:', error);
    } finally {
      setInviteLoading(false);
    }
  };

  const handleCloseInviteDialog = () => {
    setIsInviteDialogOpen(false);
  };

  useEffect(() => {
    if (activeOrganization) {
      setCurrentBistro(activeOrganization);
    }
  }, [activeOrganization]);

  useEffect(() => {
    if (activeLocation) {
      fetchOrders();
    }
  }, [activeLocation]);

  const fetchOrders = async () => {
    if (!activeLocation) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          customers (
            whatsapp_number,
            first_name,
            last_name
          ),
          order_details (
            ready_at,
            estimated_prep_time,
            notes
          )
        `)
        .eq('location_id', activeLocation.id)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      setOrders(data || []);
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateOrderStatus = async (orderId, newStatus) => {
    try {
      // Update local state immediately for better UX
      setOrders(prev => prev.map(order => 
        order.id === orderId 
          ? { 
              ...order, 
              status: newStatus,
              order_details: newStatus === 'ready' 
                ? { ...order.order_details, ready_at: new Date().toISOString() }
                : order.order_details
            }
          : order
      ));

      const updateData = { 
        status: newStatus,
        updated_at: new Date().toISOString()
      };

      // Update orders table
      const { error: orderError } = await supabase
        .from('orders')
        .update(updateData)
        .eq('id', orderId);
      
      if (orderError) throw orderError;

      // Update order_details table for ready status
      if (newStatus === 'ready') {
        const { error: detailsError } = await supabase
          .from('order_details')
          .update({ ready_at: new Date().toISOString() })
          .eq('order_id', orderId);
        
        if (detailsError) {
          console.warn('Could not update order_details ready_at:', detailsError);
        }
      }
    } catch (error) {
      console.error('Error updating order status:', error);
      // Revert optimistic update on error
      fetchOrders();
    }
  };

  const handleCompleteOrder = (orderId, orderNumber) => {
    setConfirmCompleteDialog({ isOpen: true, orderId, orderNumber });
  };

  const confirmCompleteOrder = () => {
    updateOrderStatus(confirmCompleteDialog.orderId, 'completed');
    setConfirmCompleteDialog({ isOpen: false, orderId: null, orderNumber: '' });
  };

  const cancelCompleteOrder = () => {
    setConfirmCompleteDialog({ isOpen: false, orderId: null, orderNumber: '' });
  };

  const filteredOrders = orders.filter(order => {
    const customerWhatsapp = order.customers?.whatsapp_number || '';
    const matchesSearch = order.order_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         customerWhatsapp.includes(searchTerm);
    
    // If searching, show all matching results regardless of status filter
    if (searchTerm.trim()) {
      return matchesSearch;
    }
    
    // Otherwise apply status filter
    let matchesStatus = false;
    switch (statusFilter) {
      case 'current':
        matchesStatus = ['pending', 'confirmed', 'preparing', 'ready'].includes(order.status);
        break;
      case 'all':
        matchesStatus = true;
        break;
      default:
        matchesStatus = order.status === statusFilter;
    }
    
    return matchesStatus;
  });

  const statusCounts = {
    current: orders.filter(o => ['pending', 'confirmed', 'preparing', 'ready'].includes(o.status)).length,
    all: orders.length,
    pending: orders.filter(o => o.status === 'pending').length,
    preparing: orders.filter(o => o.status === 'preparing').length,
    ready: orders.filter(o => o.status === 'ready').length,
    completed: orders.filter(o => o.status === 'completed').length,
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
      {/* Pending Invites Banner */}
      <InviteBanner 
        pendingInvites={pendingInvites}
        onOpenInviteDialog={() => setIsInviteDialogOpen(true)}
      />

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
          Create Order
        </Button>
      </div>

      {/* Mobile FAB - Only visible on mobile */}
      <Button
        onClick={() => setIsCreateModalOpen(true)}
        className="sm:hidden fixed bottom-6 right-6 w-16 h-16 rounded-full beepbite-gradient text-white shadow-xl hover:shadow-2xl transition-all duration-300 z-40 flex items-center justify-center"
        size="lg"
      >
        <Plus className="w-8 h-8" />
      </Button>

      {/* Status Filter Buttons */}
      <StatusFilters 
        statusFilter={statusFilter}
        onFilterChange={setStatusFilter}
        statusCounts={statusCounts}
      />

      {/* Orders Grid */}
      <div className="space-y-4">
        {filteredOrders.length === 0 ? (
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
                        ? 'Create your first order to get started'
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
                  Create First Order
                </Button>
              )}
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredOrders.map((order) => (
              <BiteCard
                key={order.id}
                bite={order}
                currentTime={currentTime}
                onStatusUpdate={updateOrderStatus}
                onCompleteOrder={handleCompleteOrder}
                formatTimeWithSeconds={formatTimeWithSeconds}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create Order Modal */}
      <CreateBiteModal 
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onOrderCreated={fetchOrders}
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

      {/* Accept Invite Dialog */}
      <AcceptInviteDialog
        invites={pendingInvites || []}
        isOpen={isInviteDialogOpen}
        onAccept={handleAcceptInvite}
        onReject={handleRejectInvite}
        isLoading={inviteLoading}
        onClose={handleCloseInviteDialog}
      />
    </div>
  );
};

export default Dashboard; 