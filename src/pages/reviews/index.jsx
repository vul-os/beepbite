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
import { useAuth } from '@/context/auth-context';
import reviewsService from '@/services/reviews';

const Reviews = () => {
  const { user, activeBistro } = useAuth();
  const [reviews, setReviews] = useState([]);
  const [reviewsData, setReviewsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [timeRange, setTimeRange] = useState('30d');
  const [searchTerm, setSearchTerm] = useState('');
  const [ratingFilter, setRatingFilter] = useState('all');
  const [isReplyModalOpen, setIsReplyModalOpen] = useState(false);
  const [selectedReview, setSelectedReview] = useState(null);
  const [replyText, setReplyText] = useState('');

  useEffect(() => {
    if (activeBistro) {
      fetchReviews();
    }
  }, [activeBistro, timeRange]);

  const fetchReviews = async () => {
    if (!activeBistro?.id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      console.log('Fetching reviews data for bistro:', activeBistro.id, 'period:', timeRange);
      const data = await reviewsService.getReviewsData(timeRange, 100, activeBistro.id);
      console.log('Reviews data received:', data);
      
      setReviewsData(data);
      setReviews(data.reviews || []);
    } catch (error) {
      console.error('Error fetching reviews:', error);
      setError(error.message);
      
      // Fallback to empty state
      setReviewsData({
        reviews: [],
        summary: {
          totalReviews: 0,
          averageRating: 0,
          anonymousReviews: 0,
          publicReviews: 0,
          reviewsWithComments: 0
        },
        ratingStats: {
          average: 0,
          distribution: []
        },
        trends: []
      });
      setReviews([]);
    } finally {
      setLoading(false);
    }
  };

  const handleReply = async (reviewId) => {
    try {
      // TODO: Implement actual reply functionality
      // This could involve:
      // 1. Storing the reply in a new table (review_replies)
      // 2. Sending the reply via WhatsApp
      // 3. Updating the UI to show the reply
      
      console.log('Replying to review:', reviewId, 'with text:', replyText);
      
      // For now, just update local state
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
    // Convert 10-point scale to 5-star display
    const starRating = Math.round(rating / 2);
    return [...Array(5)].map((_, i) => (
      <Star 
        key={i} 
        className={`w-4 h-4 ${
          i < starRating 
            ? 'text-yellow-400 fill-current' 
            : 'text-gray-300'
        }`} 
      />
    ));
  };

  const getRatingColor = (rating) => {
    if (rating >= 8) return 'text-green-600 bg-green-50 border-green-200';
    if (rating >= 6) return 'text-yellow-600 bg-yellow-50 border-yellow-200';
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

  // Use data from service or fallback to calculated stats
  const ratingStats = reviewsData?.ratingStats || {
    average: reviews.length > 0 ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1) : '0.0',
    distribution: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(rating => ({
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

  // Show message when no bistro is selected
  if (!activeBistro) {
    return (
      <div className="space-y-4 sm:space-y-6">
        <div className="flex flex-col space-y-3 sm:space-y-4">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Customer Reviews</h1>
          <p className="text-sm sm:text-base text-gray-600">Manage and respond to customer feedback</p>
        </div>
        
        <Card className="p-8 sm:p-12 text-center">
          <div className="space-y-4">
            <div className="w-12 h-12 sm:w-16 sm:h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto">
              <MessageCircle className="w-6 h-6 sm:w-8 sm:h-8 text-orange-600" />
            </div>
            <div className="space-y-2">
              <h3 className="text-base sm:text-lg font-medium text-gray-900">No Restaurant Selected</h3>
              <p className="text-sm sm:text-base text-gray-500">
                Please select a restaurant from the dropdown in the top navigation to view reviews.
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col space-y-3 sm:space-y-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1 sm:space-y-2">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Customer Reviews</h1>
          <p className="text-sm sm:text-base text-gray-600">Manage and respond to customer feedback</p>
          {error && (
            <div className="text-sm text-amber-600 bg-amber-50 px-3 py-2 rounded-md">
              ⚠️ Using limited data: {error}
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-3">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1d">Last 24 hours</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 3 months</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
          
          <Select value={ratingFilter} onValueChange={setRatingFilter}>
            <SelectTrigger className="w-full sm:w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Ratings</SelectItem>
              <SelectItem value="10">10/10 Excellent</SelectItem>
              <SelectItem value="9">9/10 Great</SelectItem>
              <SelectItem value="8">8/10 Good</SelectItem>
              <SelectItem value="7">7/10 Average</SelectItem>
              <SelectItem value="6">6/10 Fair</SelectItem>
              <SelectItem value="5">5/10 Poor</SelectItem>
              <SelectItem value="4">4/10 Bad</SelectItem>
              <SelectItem value="3">3/10 Terrible</SelectItem>
              <SelectItem value="2">2/10 Awful</SelectItem>
              <SelectItem value="1">1/10 Worst</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Rating Overview */}
        <div className="space-y-4 sm:space-y-6 lg:order-1 order-2">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <Star className="w-4 sm:w-5 h-4 sm:h-5 text-yellow-500" />
                Rating Overview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center mb-4 sm:mb-6">
                <div className="text-3xl sm:text-4xl font-bold text-gray-900 mb-2">
                  {ratingStats.average}
                </div>
                <div className="flex justify-center mb-2">
                  {getStarDisplay(Math.round(parseFloat(ratingStats.average)))}
                </div>
                <p className="text-xs sm:text-sm text-gray-600">
                  Based on {reviews.length} reviews
                </p>
              </div>
              
              <div className="space-y-2 sm:space-y-3">
                {ratingStats.distribution.map((stat) => (
                  <div key={stat.rating} className="flex items-center gap-2 sm:gap-3">
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="text-xs sm:text-sm font-medium w-6 text-center">{stat.rating}</span>
                    </div>
                    <div className="flex-1 bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-yellow-400 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${stat.percentage}%` }}
                      ></div>
                    </div>
                    <span className="text-xs sm:text-sm text-gray-600 min-w-0">
                      {stat.count}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Quick Stats */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <TrendingUp className="w-4 sm:w-5 h-4 sm:h-5" />
                Quick Stats
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 sm:space-y-4">
              <div className="flex justify-between">
                <span className="text-xs sm:text-sm text-gray-600">Total Reviews</span>
                <span className="font-semibold text-sm sm:text-base">{reviews.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs sm:text-sm text-gray-600">Replied</span>
                <span className="font-semibold text-sm sm:text-base">
                  {reviews.filter(r => r.has_reply).length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs sm:text-sm text-gray-600">Pending</span>
                <span className="font-semibold text-sm sm:text-base">
                  {reviews.filter(r => !r.has_reply).length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs sm:text-sm text-gray-600">10/10 Rate</span>
                <span className="font-semibold text-sm sm:text-base text-green-600">
                  {ratingStats.distribution[0].percentage}%
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Reviews List */}
        <div className="lg:col-span-2 space-y-4 sm:space-y-6 lg:order-2 order-1">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="Search reviews by customer name, order number..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 text-sm sm:text-base"
            />
          </div>

          {/* Reviews */}
          <div className="space-y-3 sm:space-y-4">
            {filteredReviews.length === 0 ? (
              <Card className="p-8 sm:p-12 text-center">
                <div className="space-y-4">
                  <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto">
                    <MessageCircle className="w-6 h-6 sm:w-8 sm:h-8 text-gray-400" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-base sm:text-lg font-medium text-gray-900">No reviews found</h3>
                    <p className="text-sm sm:text-base text-gray-500">
                      {searchTerm ? 'Try adjusting your search terms' : 'Customer reviews will appear here'}
                    </p>
                  </div>
                </div>
              </Card>
            ) : (
              filteredReviews.map((review) => (
                <Card key={review.id} className="hover:shadow-md transition-shadow duration-200">
                  <CardContent className="p-4 sm:p-6">
                    <div className="space-y-3 sm:space-y-4">
                      {/* Header */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 sm:gap-4 min-w-0 flex-1">
                          <div className="w-10 h-10 sm:w-12 sm:h-12 bg-orange-100 rounded-full flex items-center justify-center shrink-0">
                            <span className="text-orange-600 font-semibold text-sm sm:text-base">
                              {review.customer_name?.charAt(0) || 'C'}
                            </span>
                          </div>
                          
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 sm:gap-3 mb-1">
                              <h3 className="font-semibold text-gray-900 text-sm sm:text-base truncate">
                                {review.customer_name}
                              </h3>
                              {review.verified && (
                                <Badge variant="secondary" className="text-xs shrink-0">
                                  Verified
                                </Badge>
                              )}
                            </div>
                            
                            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 text-xs sm:text-sm text-gray-500">
                              <span className="truncate">Order #{review.order_number}</span>
                              <span className="shrink-0">
                                {formatDistanceToNow(new Date(review.created_at), { addSuffix: true })}
                              </span>
                            </div>
                          </div>
                        </div>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="shrink-0">
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
                        <Badge className={`${getRatingColor(review.rating)} border text-xs`}>
                          {review.rating} / 10
                        </Badge>
                      </div>

                      {/* Comment */}
                      <div className="text-gray-700 leading-relaxed text-sm sm:text-base">
                        {review.comment}
                      </div>

                      {/* Reply */}
                      {review.has_reply && (
                        <div className="bg-blue-50 border-l-4 border-blue-200 p-3 sm:p-4 rounded-r-lg">
                          <div className="flex items-center gap-2 mb-2">
                            <Reply className="w-3 sm:w-4 h-3 sm:h-4 text-blue-600" />
                            <span className="text-xs sm:text-sm font-medium text-blue-800">
                              Restaurant Response
                            </span>
                          </div>
                          <p className="text-blue-700 text-xs sm:text-sm">
                            {review.reply}
                          </p>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 pt-2">
                        {!review.has_reply && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openReplyModal(review)}
                            className="flex items-center gap-2 w-full sm:w-auto"
                          >
                            <Reply className="w-3 sm:w-4 h-3 sm:h-4" />
                            <span className="text-xs sm:text-sm">Reply</span>
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" className="flex items-center gap-2 w-full sm:w-auto">
                          <ThumbsUp className="w-3 sm:w-4 h-3 sm:h-4" />
                          <span className="text-xs sm:text-sm">Helpful</span>
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
        <DialogContent className="max-w-md mx-4 sm:mx-auto">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg">Reply to Review</DialogTitle>
          </DialogHeader>
          
          {selectedReview && (
            <div className="space-y-4">
              {/* Original Review */}
              <div className="p-3 sm:p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-medium text-sm sm:text-base">{selectedReview.customer_name}</span>
                  <div className="flex">
                    {getStarDisplay(selectedReview.rating)}
                  </div>
                </div>
                <p className="text-xs sm:text-sm text-gray-600">
                  "{selectedReview.comment}"
                </p>
              </div>

              {/* Reply Input */}
              <div className="space-y-2">
                <label className="text-xs sm:text-sm font-medium">Your Response</label>
                <Textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Write a thoughtful response to this review..."
                  rows={4}
                  className="resize-none text-sm"
                />
              </div>

              {/* Actions */}
              <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
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