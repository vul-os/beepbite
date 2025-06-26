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
    <div className="h-screen flex flex-col justify-center bg-gradient-to-br from-slate-50 via-white to-slate-100 px-4 py-4 relative overflow-hidden">
      {/* Background decorations - more subtle and mobile optimized */}
      <div className="absolute inset-0 bg-grid-pattern opacity-3"></div>
      <div className="absolute top-10 left-10 w-12 sm:w-20 h-12 sm:h-20 bg-primary/5 rounded-full opacity-50"></div>
      <div className="absolute bottom-10 right-10 w-10 sm:w-16 h-10 sm:h-16 bg-primary/5 rounded-full opacity-50"></div>
      <div className="absolute top-1/2 left-20 w-8 sm:w-12 h-8 sm:h-12 bg-primary/10 rounded-full opacity-30"></div>
      
      <div className="w-full max-w-sm mx-auto space-y-4 relative z-10">
        {/* Mobile-optimized Logo */}
        <div className="flex justify-center mb-2">
          <div className="text-center">
            <div className="flex justify-center items-center mb-2">
              <div className="w-12 sm:w-16 h-12 sm:h-16 beepbite-gradient rounded-xl sm:rounded-2xl flex items-center justify-center shadow-lg border-2 sm:border-4 border-white">
                <img 
                  src="/icon.svg" 
                  alt="BeepBite" 
                  className="w-6 sm:w-10 h-6 sm:h-10 filter brightness-0 invert"
                />
                <div className="absolute -top-0.5 sm:-top-1 -right-0.5 sm:-right-1 w-3 sm:w-4 h-3 sm:h-4 bg-red-500 rounded-full animate-pulse shadow-lg"></div>
              </div>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              <span className="beepbite-gradient-text">Beep</span>
              <span className="text-gray-900">Bite</span>
            </h1>
            <p className="text-xs sm:text-sm text-gray-600 font-medium">Restaurant Management</p>
          </div>
        </div>

        <Card className="border border-gray-200 shadow-xl bg-white/95 backdrop-blur-sm">
          <CardHeader className="space-y-1 pb-4 text-center px-4 pt-4">
            <CardTitle className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900">
              Welcome Back
            </CardTitle>
            <CardDescription className="text-sm text-gray-600">
              Sign in to manage your restaurant orders
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {errors.submit && (
              <Alert variant="destructive" className="mb-4 border-l-4 border-red-500 bg-red-50/80">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">{errors.submit}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-4">
              <Button 
                variant="outline" 
                className="w-full flex items-center justify-center gap-2 h-11 border-gray-300 bg-white hover:bg-gray-50 transition-all duration-200 shadow-sm text-sm font-medium"
                onClick={handleGoogleSignIn}
                disabled={isLoading}
              >
                <div className="w-4 h-4 bg-white rounded flex items-center justify-center">
                  <img 
                    src="/google.png" 
                    alt="Google" 
                    className="w-4 h-4"
                  />
                </div>
                <span>Continue with Google</span>
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-gray-300" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-3 bg-white text-gray-500 font-medium">OR</span>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-sm font-medium text-gray-700">Email address</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3.5 h-4 w-4 text-gray-400" />
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      className={`pl-10 h-11 bg-white border-gray-300 focus:border-primary focus:ring-1 focus:ring-primary transition-all duration-200 text-base ${errors.email ? "border-red-400" : ""}`}
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
                    <Label htmlFor="password" className="text-sm font-medium text-gray-700">Password</Label>
                    <Button 
                      variant="link" 
                      type="button"
                      className="text-xs text-primary hover:text-primary/80 p-0 h-auto font-medium underline"
                      onClick={() => navigate('/forgot-password')}
                      disabled={isLoading}
                    >
                      Forgot?
                    </Button>
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-3.5 h-4 w-4 text-gray-400" />
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      className={`pl-10 h-11 bg-white border-gray-300 focus:border-primary focus:ring-1 focus:ring-primary transition-all duration-200 text-base ${errors.password ? "border-red-400" : ""}`}
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
                  className="w-full h-11 bg-primary hover:bg-primary/90 text-white font-medium shadow-lg hover:shadow-xl transition-all duration-300 text-base"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <div className="flex items-center space-x-2">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Signing in...</span>
                    </div>
                  ) : (
                    <div className="flex items-center space-x-2">
                      <Utensils className="w-4 h-4" />
                      <span>Access Dashboard</span>
                    </div>
                  )}
                </Button>
              </form>

              <div className="text-center pt-2">
                <span className="text-sm text-gray-600">Don't have an account?{' '}</span>
                <Button
                  variant="link"
                  type="button"
                  className="text-primary hover:text-primary/80 p-0 h-auto font-medium text-sm underline"
                  onClick={() => navigate('/signup')}
                  disabled={isLoading}
                >
                  Create account
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Mobile-optimized footer */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center space-x-4 text-xs text-gray-600">
            <div className="flex items-center space-x-1.5">
              <Bell className="w-3 h-3 text-primary" />
              <span>Instant Alerts</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <Utensils className="w-3 h-3 text-primary" />
              <span>Order Management</span>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            © {new Date().getFullYear()} BeepBite
          </p>
        </div>
      </div>
    </div>
  );
};

export default SignInPage;