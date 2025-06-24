import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from '@/context/auth-context';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Mail, Lock, AlertCircle, Utensils, Bell } from 'lucide-react';
import Logo from '@/components/ui/logo';

const SignInPage = () => {
  const navigate = useNavigate();
  const { signIn, signInWithGoogle } = useAuth();
  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });

  const validateForm = () => {
    const newErrors = {};
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }
    
    if (!formData.password) {
      newErrors.password = 'Password is required';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: undefined
      }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (validateForm()) {
      setIsLoading(true);
      try {
        await signIn(formData.email, formData.password);
        // Navigation will be handled by auth context
      } catch (error) {
        setErrors(prev => ({
          ...prev,
          submit: error.message
        }));
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      setIsLoading(true);
      await signInWithGoogle();
    } catch (error) {
      setErrors(prev => ({
        ...prev,
        submit: error.message
      }));
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-slate-100 px-3 sm:px-4 py-6 sm:py-8 relative overflow-hidden">
      {/* Background decorations - more subtle */}
      <div className="absolute inset-0 bg-grid-pattern opacity-3"></div>
      <div className="absolute top-10 left-10 w-16 sm:w-20 h-16 sm:h-20 bg-primary/5 rounded-full opacity-50"></div>
      <div className="absolute bottom-10 right-10 w-12 sm:w-16 h-12 sm:h-16 bg-primary/5 rounded-full opacity-50"></div>
      <div className="absolute top-1/2 left-20 w-10 sm:w-12 h-10 sm:h-12 bg-primary/10 rounded-full opacity-30"></div>
      
      <div className="w-full max-w-sm sm:max-w-lg space-y-4 sm:space-y-6 relative z-10">
        {/* Logo/Brand */}
        <div className="flex justify-center mb-3 sm:mb-4">
          <Logo />
        </div>

        <Card className="border border-gray-200 shadow-xl bg-white/95 backdrop-blur-sm">
          <CardHeader className="space-y-1.5 sm:space-y-2 pb-4 sm:pb-6 text-center">
            <CardTitle className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900">
              Welcome Back
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm text-gray-600">
              Sign in to manage your restaurant orders
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4 sm:px-6 pb-4 sm:pb-6">
            {errors.submit && (
              <Alert variant="destructive" className="mb-4 border-l-4 border-red-500 bg-red-50/80">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-xs sm:text-sm">{errors.submit}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-3 sm:space-y-4">
              <Button 
                variant="outline" 
                className="w-full flex items-center justify-center gap-2 sm:gap-3 h-10 sm:h-11 border-gray-300 bg-white hover:bg-gray-50 transition-all duration-200 shadow-sm text-sm sm:text-base"
                onClick={handleGoogleSignIn}
                disabled={isLoading}
              >
                <div className="w-4 sm:w-5 h-4 sm:h-5 bg-white rounded flex items-center justify-center">
                  <img 
                    src="/google.png" 
                    alt="Google" 
                    className="w-3.5 sm:w-4 h-3.5 sm:h-4"
                  />
                </div>
                <span className="font-medium">Continue with Google</span>
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-gray-300" />
                </div>
                <div className="relative flex justify-center text-xs sm:text-sm">
                  <span className="px-2 sm:px-3 bg-white text-gray-500 font-medium">OR</span>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs sm:text-sm font-medium text-gray-700">Email address</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3 h-3.5 sm:h-4 w-3.5 sm:w-4 text-gray-400" />
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      className={`pl-9 sm:pl-10 h-9 sm:h-10 bg-white border-gray-300 focus:border-primary focus:ring-1 focus:ring-primary transition-all duration-200 text-sm sm:text-base ${errors.email ? "border-red-400" : ""}`}
                      value={formData.email}
                      onChange={handleInputChange}
                      required
                      disabled={isLoading}
                      placeholder="your.email@restaurant.com"
                    />
                  </div>
                  {errors.email && (
                    <p className="text-xs text-red-500">{errors.email}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password" className="text-xs sm:text-sm font-medium text-gray-700">Password</Label>
                    <Button 
                      variant="link" 
                      type="button"
                      className="text-xs text-primary hover:text-primary/80 p-0 h-auto font-medium underline"
                      onClick={() => navigate('/forgot-password')}
                      disabled={isLoading}
                    >
                      Forgot password?
                    </Button>
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-3 h-3.5 sm:h-4 w-3.5 sm:w-4 text-gray-400" />
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      className={`pl-9 sm:pl-10 h-9 sm:h-10 bg-white border-gray-300 focus:border-primary focus:ring-1 focus:ring-primary transition-all duration-200 text-sm sm:text-base ${errors.password ? "border-red-400" : ""}`}
                      value={formData.password}
                      onChange={handleInputChange}
                      required
                      disabled={isLoading}
                      placeholder="Enter your password"
                    />
                  </div>
                  {errors.password && (
                    <p className="text-xs text-red-500">{errors.password}</p>
                  )}
                </div>

                <Button 
                  type="submit" 
                  className="w-full h-10 sm:h-11 bg-primary hover:bg-primary/90 text-white font-medium shadow-lg hover:shadow-xl transition-all duration-300 text-sm sm:text-base"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <div className="flex items-center space-x-2">
                      <div className="w-3.5 sm:w-4 h-3.5 sm:h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Signing in...</span>
                    </div>
                  ) : (
                    <div className="flex items-center space-x-2">
                      <Utensils className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
                      <span>Access Dashboard</span>
                    </div>
                  )}
                </Button>
              </form>

              <div className="text-center pt-2">
                <span className="text-xs sm:text-sm text-gray-600">Don't have an account?{' '}</span>
                <Button
                  variant="link"
                  type="button"
                  className="text-primary hover:text-primary/80 p-0 h-auto font-medium text-xs sm:text-sm underline"
                  onClick={() => navigate('/signup')}
                  disabled={isLoading}
                >
                  Create your restaurant account
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Features preview - more compact */}
        <div className="text-center space-y-2 sm:space-y-3">
          <div className="flex items-center justify-center space-x-4 sm:space-x-6 text-xs sm:text-sm text-gray-600">
            <div className="flex items-center space-x-1.5 sm:space-x-2">
              <Bell className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-primary" />
              <span>Instant Notifications</span>
            </div>
            <div className="flex items-center space-x-1.5 sm:space-x-2">
              <Utensils className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-primary" />
              <span>Order Management</span>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            © {new Date().getFullYear()} BeepBite. Streamlining restaurant operations worldwide.
          </p>
        </div>
      </div>
    </div>
  );
};

export default SignInPage;