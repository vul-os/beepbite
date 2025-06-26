import React from 'react';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { 
  Building2, 
  UserPlus, 
  Clock, 
  Check, 
  X,
  ChefHat
} from 'lucide-react';
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from 'date-fns';

const AcceptInviteDialog = ({ 
  invites = [], 
  isOpen, 
  onClose, 
  onAccept, 
  onReject,
  isLoading = false 
}) => {
  if (!invites || invites.length === 0) return null;

  const handleAccept = async (inviteId) => {
    try {
      await onAccept(inviteId);
    } catch (error) {
      console.error('Failed to accept invite:', error);
    }
  };

  const handleReject = async (inviteId) => {
    try {
      await onReject(inviteId);
    } catch (error) {
      console.error('Failed to reject invite:', error);
    }
  };

  const getRoleColor = (role) => {
    switch (role) {
      case 'owner':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'manager':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'staff':
        return 'bg-green-100 text-green-800 border-green-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <UserPlus className="w-6 h-6 text-orange-500" />
            Bistro Invitations
          </DialogTitle>
          <DialogDescription>
            You have {invites.length} pending invitation{invites.length > 1 ? 's' : ''} to join bistro{invites.length > 1 ? 's' : ''}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-6">
          {invites.map((invite) => (
            <div
              key={invite.invite_id}
              className="border border-gray-200 rounded-lg p-4 hover:border-orange-200 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 flex-1">
                  <div className="w-12 h-12 rounded-lg bg-orange-500 flex items-center justify-center flex-shrink-0">
                    <ChefHat className="w-6 h-6 text-white" />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-semibold text-gray-900 truncate">
                        {invite.bistro_name}
                      </h3>
                      <Badge 
                        variant="outline" 
                        className={cn("text-xs", getRoleColor(invite.role))}
                      >
                        {invite.role}
                      </Badge>
                    </div>
                    
                    <p className="text-sm text-gray-600 mb-2">
                      Invited by <span className="font-medium">{invite.invited_by_name}</span>
                    </p>
                    
                    <div className="flex items-center gap-1 text-xs text-gray-500">
                      <Clock className="w-3 h-3" />
                      {formatDistanceToNow(new Date(invite.created_at), { addSuffix: true })}
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 flex-shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleReject(invite.invite_id)}
                    disabled={isLoading}
                    className="hover:bg-red-50 hover:border-red-200 hover:text-red-700"
                  >
                    <X className="w-4 h-4 mr-1" />
                    Decline
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handleAccept(invite.invite_id)}
                    disabled={isLoading}
                    className="bg-orange-500 hover:bg-orange-600 text-white"
                  >
                    <Check className="w-4 h-4 mr-1" />
                    Accept
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-3 mt-6 pt-6 border-t border-gray-200">
          <Button variant="outline" onClick={onClose}>
            Review Later
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AcceptInviteDialog; 