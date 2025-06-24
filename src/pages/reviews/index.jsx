import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { 
  Star, 
  Search, 
  Filter, 
  MessageCircle, 
  ThumbsUp,
  Flag,
  Reply,
  MoreHorizontal,
  TrendingUp
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDistanceToNow } from 'date-fns';

const Reviews = () => {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [ratingFilter, setRatingFilter] = useState('all');
  const [isReplyModalOpen, setIsReplyModalOpen] = useState(false);
  const [selectedReview, setSelectedReview] = useState(null);
  const [replyText, setReplyText] = useState('');

  // Mock reviews data - replace with real API
  const mockReviews = [
    {
      id: '1',
      order_number: '2543',
      customer_name: 'Maria G.',
      rating: 5,
      comment: 'Amazing food and super fast service! Got my order notification immediately and the food was ready exactly when promised. Will definitely order again!',
      created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      has_reply: false,
      verified: true
    },
    {
      id: '2',
      order_number: '2544',
      customer_name: 'John D.',
      rating: 4,
      comment: 'Good food overall. The notification system works great, but the packaging could be improved. Food arrived hot though!',
      created_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
      has_reply: true,
      reply: 'Thank you for the feedback! We\'ve noted your comment about packaging and are working on improvements.',
      verified: true
    },
    {
      id: '3',
      order_number: '2545',
      customer_name: 'Sarah K.',
      rating: 5,
      comment: 'Perfect experience! Love how I got instant WhatsApp updates about my order status. Food was delicious too!',
      created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      has_reply: false,
      verified: true
    },
    {
      id: '4',
      order_number: '2540',
      customer_name: 'Ahmed H.',
      rating: 3,
      comment: 'Food was okay but took longer than expected. The notification came but the actual preparation time was longer.',
      created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      has_reply: false,
      verified: true
    },
    {
      id: '5',
      order_number: '2538',
      customer_name: 'Lisa M.',
      rating: 5,
      comment: 'Excellent service and communication! The BeepBite system made ordering so smooth. Highly recommend!',
      created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      has_reply: true,
      reply: 'Thank you so much Lisa! We\'re thrilled you enjoyed the experience.',
      verified: true
    }
  ];

  useEffect(() => {
    fetchReviews();
  }, []);

  const fetchReviews = async () => {
    setLoading(true);
    try {
      // TODO: Replace with actual API call
      // const { data, error } = await supabase
      //   .from('reviews')
      //   .select(`
      //     *,
      //     bites!inner(order_number, whatsapp_number)
      //   `)
      //   .order('created_at', { ascending: false });
      
      // if (error) throw error;
      
      // Simulate API delay
      setTimeout(() => {
        setReviews(mockReviews);
        setLoading(false);
      }, 500);
    } catch (error) {
      console.error('Error fetching reviews:', error);
      setLoading(false);
    }
  };

  const handleReply = async (reviewId) => {
    try {
      // TODO: Implement actual reply functionality
      console.log('Replying to review:', reviewId, 'with text:', replyText);
      
      // Update local state
      setReviews(prev => prev.map(review => 
        review.id === reviewId 
          ? { ...review, has_reply: true, reply: replyText }
          : review
      ));
      
      setIsReplyModalOpen(false);
      setReplyText('');
      setSelectedReview(null);
    } catch (error) {
      console.error('Error replying to review:', error);
    }
  };

  const openReplyModal = (review) => {
    setSelectedReview(review);
    setReplyText('');
    setIsReplyModalOpen(true);
  };

  const getStarDisplay = (rating) => {
    return [...Array(5)].map((_, i) => (
      <Star 
        key={i} 
        className={`w-4 h-4 ${
          i < rating 
            ? 'text-yellow-400 fill-current' 
            : 'text-gray-300'
        }`} 
      />
    ));
  };

  const getRatingColor = (rating) => {
    if (rating >= 4) return 'text-green-600 bg-green-50 border-green-200';
    if (rating >= 3) return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    return 'text-red-600 bg-red-50 border-red-200';
  };

  const filteredReviews = reviews.filter(review => {
    const matchesSearch = 
      review.customer_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      review.comment?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      review.order_number?.includes(searchTerm);
    
    const matchesRating = 
      ratingFilter === 'all' || 
      review.rating.toString() === ratingFilter;
    
    return matchesSearch && matchesRating;
  });

  const ratingStats = {
    average: reviews.length > 0 ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1) : '0.0',
    distribution: [5, 4, 3, 2, 1].map(rating => ({
      rating,
      count: reviews.filter(r => r.rating === rating).length,
      percentage: reviews.length > 0 ? (reviews.filter(r => r.rating === rating).length / reviews.length * 100).toFixed(0) : '0'
    }))
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="space-y-6">
          <div className="h-8 bg-gray-200 rounded w-48 animate-pulse"></div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="h-64 bg-gray-200 rounded animate-pulse"></div>
            <div className="lg:col-span-2 space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-32 bg-gray-200 rounded animate-pulse"></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Customer Reviews</h1>
          <p className="text-gray-600">Manage and respond to customer feedback</p>
        </div>
        
        <div className="flex items-center gap-3">
          <Select value={ratingFilter} onValueChange={setRatingFilter}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Ratings</SelectItem>
              <SelectItem value="5">5 Stars</SelectItem>
              <SelectItem value="4">4 Stars</SelectItem>
              <SelectItem value="3">3 Stars</SelectItem>
              <SelectItem value="2">2 Stars</SelectItem>
              <SelectItem value="1">1 Star</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Rating Overview */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Star className="w-5 h-5 text-yellow-500" />
                Rating Overview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center mb-6">
                <div className="text-4xl font-bold text-gray-900 mb-2">
                  {ratingStats.average}
                </div>
                <div className="flex justify-center mb-2">
                  {getStarDisplay(Math.round(parseFloat(ratingStats.average)))}
                </div>
                <p className="text-sm text-gray-600">
                  Based on {reviews.length} reviews
                </p>
              </div>
              
              <div className="space-y-3">
                {ratingStats.distribution.map((stat) => (
                  <div key={stat.rating} className="flex items-center gap-3">
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="text-sm font-medium">{stat.rating}</span>
                      <Star className="w-3 h-3 text-yellow-400 fill-current" />
                    </div>
                    <div className="flex-1 bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-yellow-400 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${stat.percentage}%` }}
                      ></div>
                    </div>
                    <span className="text-sm text-gray-600 min-w-0">
                      {stat.count}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Quick Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5" />
                Quick Stats
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Total Reviews</span>
                <span className="font-semibold">{reviews.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Replied</span>
                <span className="font-semibold">
                  {reviews.filter(r => r.has_reply).length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Pending</span>
                <span className="font-semibold">
                  {reviews.filter(r => !r.has_reply).length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">5-Star Rate</span>
                <span className="font-semibold text-green-600">
                  {ratingStats.distribution[0].percentage}%
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Reviews List */}
        <div className="lg:col-span-2 space-y-6">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="Search reviews by customer name, order number, or comment..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Reviews */}
          <div className="space-y-4">
            {filteredReviews.length === 0 ? (
              <Card className="p-12 text-center">
                <div className="space-y-4">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto">
                    <MessageCircle className="w-8 h-8 text-gray-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-medium text-gray-900">No reviews found</h3>
                    <p className="text-gray-500">
                      {searchTerm ? 'Try adjusting your search terms' : 'Customer reviews will appear here'}
                    </p>
                  </div>
                </div>
              </Card>
            ) : (
              filteredReviews.map((review) => (
                <Card key={review.id} className="hover:shadow-md transition-shadow duration-200">
                  <CardContent className="p-6">
                    <div className="space-y-4">
                      {/* Header */}
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-4">
                          <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center">
                            <span className="text-orange-600 font-semibold">
                              {review.customer_name?.charAt(0) || 'C'}
                            </span>
                          </div>
                          
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-1">
                              <h3 className="font-semibold text-gray-900">
                                {review.customer_name}
                              </h3>
                              {review.verified && (
                                <Badge variant="secondary" className="text-xs">
                                  Verified Order
                                </Badge>
                              )}
                            </div>
                            
                            <div className="flex items-center gap-4 text-sm text-gray-500">
                              <span>Order #{review.order_number}</span>
                              <span>
                                {formatDistanceToNow(new Date(review.created_at), { addSuffix: true })}
                              </span>
                            </div>
                          </div>
                        </div>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openReplyModal(review)}>
                              <Reply className="w-4 h-4 mr-2" />
                              Reply
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                              <Flag className="w-4 h-4 mr-2" />
                              Report
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      {/* Rating */}
                      <div className="flex items-center gap-2">
                        <div className="flex">
                          {getStarDisplay(review.rating)}
                        </div>
                        <Badge className={`${getRatingColor(review.rating)} border`}>
                          {review.rating} / 5
                        </Badge>
                      </div>

                      {/* Comment */}
                      <div className="text-gray-700 leading-relaxed">
                        {review.comment}
                      </div>

                      {/* Reply */}
                      {review.has_reply && (
                        <div className="bg-blue-50 border-l-4 border-blue-200 p-4 rounded-r-lg">
                          <div className="flex items-center gap-2 mb-2">
                            <Reply className="w-4 h-4 text-blue-600" />
                            <span className="text-sm font-medium text-blue-800">
                              Restaurant Response
                            </span>
                          </div>
                          <p className="text-blue-700 text-sm">
                            {review.reply}
                          </p>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex items-center gap-3 pt-2">
                        {!review.has_reply && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openReplyModal(review)}
                            className="flex items-center gap-2"
                          >
                            <Reply className="w-4 h-4" />
                            Reply
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" className="flex items-center gap-2">
                          <ThumbsUp className="w-4 h-4" />
                          Helpful
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Reply Modal */}
      <Dialog open={isReplyModalOpen} onOpenChange={setIsReplyModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reply to Review</DialogTitle>
          </DialogHeader>
          
          {selectedReview && (
            <div className="space-y-4">
              {/* Original Review */}
              <div className="p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-medium">{selectedReview.customer_name}</span>
                  <div className="flex">
                    {getStarDisplay(selectedReview.rating)}
                  </div>
                </div>
                <p className="text-sm text-gray-600">
                  "{selectedReview.comment}"
                </p>
              </div>

              {/* Reply Input */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Your Response</label>
                <Textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Write a thoughtful response to this review..."
                  rows={4}
                  className="resize-none"
                />
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => setIsReplyModalOpen(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => handleReply(selectedReview.id)}
                  disabled={!replyText.trim()}
                  className="flex-1 beepbite-gradient text-white"
                >
                  Send Reply
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Reviews; 