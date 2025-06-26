import React from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  Hash,
  Phone,
  Clock,
  CheckCircle,
  AlertCircle,
  Bell,
  ChefHat,
  MessageSquare,
  Eye
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

const BiteCard = ({ 
  bite, 
  currentTime, 
  onStatusUpdate, 
  onCompleteOrder, 
  formatTimeWithSeconds 
}) => {
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

  return (
    <Card className="hover:shadow-lg transition-all duration-200 border-l-4 border-l-orange-500 min-h-fit">
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
              if (bite.status === 'pending') onStatusUpdate(bite.id, 'preparing');
              else if (bite.status === 'preparing') onStatusUpdate(bite.id, 'ready');
              else if (bite.status === 'ready') onStatusUpdate(bite.id, 'completed');
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
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span key={currentTime.getTime()}>
                {formatTimeWithSeconds(bite.created_at)}
              </span>
            </div>
          </div>
          {bite.order_ready_at && (
            <div className="text-sm text-green-600 font-medium">
              <span key={currentTime.getTime()}>
                Ready {formatTimeWithSeconds(bite.order_ready_at)}
              </span>
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
              onClick={() => onStatusUpdate(bite.id, 'pending')}
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
              onClick={() => onStatusUpdate(bite.id, 'preparing')}
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
              onClick={() => onStatusUpdate(bite.id, 'ready')}
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
              onClick={() => bite.status !== 'completed' && onCompleteOrder(bite.id, bite.order_number)}
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
              onClick={() => onCompleteOrder(bite.id, bite.order_number)}
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
                // Send notification functionality will be implemented here
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
                // View details functionality will be implemented here
              }}
            >
              <Eye className="w-4 h-4 mr-2" />
              Details
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default BiteCard; 