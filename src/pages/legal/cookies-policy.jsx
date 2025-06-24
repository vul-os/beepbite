import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

const CookiesPolicy = () => {
  const lastUpdated = "January 15, 2024";

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold mb-4">Cookie Policy</h1>
            <p className="text-lg text-muted-foreground">
              Last updated: {lastUpdated}
            </p>
          </div>

          <Card>
            <CardContent className="p-8 space-y-8">
              
              {/* Introduction */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">1. Introduction</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  This Cookie Policy explains how BeepBite ("we," "our," or "us") uses cookies and similar tracking technologies on our website, web applications, and services (collectively, the "Service"). This policy should be read alongside our Privacy Policy and Terms of Service.
                </p>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  By continuing to use our Service, you agree to the use of cookies as described in this policy. If you do not agree with our use of cookies, you should adjust your browser settings or discontinue use of our Service.
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  We may update this Cookie Policy from time to time to reflect changes in technology, legislation, or our practices. Please review this policy periodically for any updates.
                </p>
              </section>

              <Separator />

              {/* What Are Cookies */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">2. What Are Cookies?</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  Cookies are small text files that are stored on your device (computer, tablet, or mobile phone) when you visit a website. They are widely used to make websites work more efficiently and to provide information to website owners.
                </p>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  Cookies contain information that is transferred to your device's hard drive. They help us recognize your device and store some information about your preferences or past actions on our Service.
                </p>
                
                <h3 className="text-xl font-medium mb-3">Types of Cookies We Use</h3>
                <div className="space-y-4">
                  <div className="border-l-4 border-blue-500 pl-4">
                    <h4 className="font-medium flex items-center gap-2">
                      Session Cookies 
                      <Badge variant="secondary" className="text-xs">Temporary</Badge>
                    </h4>
                    <p className="text-muted-foreground text-sm">These are temporary cookies that are erased when you close your browser. They help maintain your session while you navigate through our Service.</p>
                  </div>
                  <div className="border-l-4 border-green-500 pl-4">
                    <h4 className="font-medium flex items-center gap-2">
                      Persistent Cookies 
                      <Badge variant="secondary" className="text-xs">Stored</Badge>
                    </h4>
                    <p className="text-muted-foreground text-sm">These cookies remain on your device for a set period or until you delete them. They remember your preferences across multiple visits.</p>
                  </div>
                  <div className="border-l-4 border-orange-500 pl-4">
                    <h4 className="font-medium flex items-center gap-2">
                      First-Party Cookies 
                      <Badge variant="secondary" className="text-xs">BeepBite</Badge>
                    </h4>
                    <p className="text-muted-foreground text-sm">These are set directly by our Service and can only be read by us.</p>
                  </div>
                  <div className="border-l-4 border-purple-500 pl-4">
                    <h4 className="font-medium flex items-center gap-2">
                      Third-Party Cookies 
                      <Badge variant="secondary" className="text-xs">External</Badge>
                    </h4>
                    <p className="text-muted-foreground text-sm">These are set by external services that we use, such as analytics providers or payment processors.</p>
                  </div>
                </div>
              </section>

              <Separator />

              {/* How We Use Cookies */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">3. How We Use Cookies</h2>
                <p className="text-muted-foreground leading-relaxed mb-6">
                  We use cookies for various purposes to enhance your experience and improve our Service. Below are the main categories of cookies we use:
                </p>

                <div className="space-y-6">
                  {/* Essential Cookies */}
                  <div className="bg-blue-50 p-6 rounded-lg">
                    <h3 className="text-xl font-medium mb-3 flex items-center gap-2">
                      <Badge className="bg-blue-600">Essential</Badge>
                      Strictly Necessary Cookies
                    </h3>
                    <p className="text-muted-foreground leading-relaxed mb-4">
                      These cookies are essential for the basic functionality of our Service. They enable core features like security, network management, and accessibility.
                    </p>
                    <div className="space-y-2">
                      <h4 className="font-medium">Examples:</h4>
                      <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-4">
                        <li>Authentication cookies to keep you logged in</li>
                        <li>Security cookies to protect against fraud</li>
                        <li>Load balancing cookies for service stability</li>
                        <li>Preference cookies for language and accessibility settings</li>
                      </ul>
                    </div>
                    <p className="text-sm text-muted-foreground mt-4 italic">
                      These cookies cannot be disabled as they are necessary for the Service to function.
                    </p>
                  </div>

                  {/* Performance Cookies */}
                  <div className="bg-green-50 p-6 rounded-lg">
                    <h3 className="text-xl font-medium mb-3 flex items-center gap-2">
                      <Badge className="bg-green-600">Performance</Badge>
                      Analytics and Performance Cookies
                    </h3>
                    <p className="text-muted-foreground leading-relaxed mb-4">
                      These cookies help us understand how users interact with our Service by collecting anonymous information about usage patterns.
                    </p>
                    <div className="space-y-2">
                      <h4 className="font-medium">What we track:</h4>
                      <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-4">
                        <li>Pages visited and time spent on each page</li>
                        <li>How users navigate through the Service</li>
                        <li>Error messages and performance issues</li>
                        <li>Popular features and content</li>
                        <li>Device and browser information</li>
                      </ul>
                    </div>
                    <div className="bg-white p-3 rounded mt-4">
                      <h4 className="font-medium mb-2">Third-party services:</h4>
                      <ul className="text-sm text-muted-foreground space-y-1">
                        <li>• Google Analytics - Website usage analytics</li>
                        <li>• Supabase Analytics - Database performance monitoring</li>
                        <li>• Vercel Analytics - Application performance tracking</li>
                      </ul>
                    </div>
                  </div>

                  {/* Functional Cookies */}
                  <div className="bg-orange-50 p-6 rounded-lg">
                    <h3 className="text-xl font-medium mb-3 flex items-center gap-2">
                      <Badge className="bg-orange-600">Functional</Badge>
                      Functionality Cookies
                    </h3>
                    <p className="text-muted-foreground leading-relaxed mb-4">
                      These cookies enable enhanced functionality and personalization, such as remembering your preferences and settings.
                    </p>
                    <div className="space-y-2">
                      <h4 className="font-medium">Features enabled:</h4>
                      <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-4">
                        <li>Remembering your login credentials</li>
                        <li>Storing your dashboard layout preferences</li>
                        <li>Saving your notification settings</li>
                        <li>Maintaining your theme and language choices</li>
                        <li>Remembering form data to prevent loss</li>
                      </ul>
                    </div>
                  </div>

                  {/* Targeting Cookies */}
                  <div className="bg-purple-50 p-6 rounded-lg">
                    <h3 className="text-xl font-medium mb-3 flex items-center gap-2">
                      <Badge className="bg-purple-600">Marketing</Badge>
                      Targeting and Advertising Cookies
                    </h3>
                    <p className="text-muted-foreground leading-relaxed mb-4">
                      These cookies are used to deliver relevant advertisements and marketing content. They may track your browsing activity across different websites.
                    </p>
                    <div className="space-y-2">
                      <h4 className="font-medium">Marketing activities:</h4>
                      <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-4">
                        <li>Showing relevant ads on third-party websites</li>
                        <li>Measuring the effectiveness of advertising campaigns</li>
                        <li>Personalizing marketing content</li>
                        <li>Retargeting website visitors</li>
                      </ul>
                    </div>
                    <div className="bg-white p-3 rounded mt-4">
                      <h4 className="font-medium mb-2">Advertising partners:</h4>
                      <ul className="text-sm text-muted-foreground space-y-1">
                        <li>• Google Ads - Search and display advertising</li>
                        <li>• Facebook Pixel - Social media advertising</li>
                        <li>• LinkedIn Insight Tag - Professional network advertising</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </section>

              <Separator />

              {/* Specific Cookies */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">4. Specific Cookies We Use</h2>
                <p className="text-muted-foreground leading-relaxed mb-6">
                  Below is a detailed list of the specific cookies used by our Service:
                </p>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse border border-gray-300">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="border border-gray-300 px-4 py-2 text-left">Cookie Name</th>
                        <th className="border border-gray-300 px-4 py-2 text-left">Purpose</th>
                        <th className="border border-gray-300 px-4 py-2 text-left">Type</th>
                        <th className="border border-gray-300 px-4 py-2 text-left">Duration</th>
                      </tr>
                    </thead>
                    <tbody className="text-sm">
                      <tr>
                        <td className="border border-gray-300 px-4 py-2 font-mono">session_token</td>
                        <td className="border border-gray-300 px-4 py-2">Maintains user login session</td>
                        <td className="border border-gray-300 px-4 py-2"><Badge className="bg-blue-600 text-xs">Essential</Badge></td>
                        <td className="border border-gray-300 px-4 py-2">Session</td>
                      </tr>
                      <tr>
                        <td className="border border-gray-300 px-4 py-2 font-mono">csrf_token</td>
                        <td className="border border-gray-300 px-4 py-2">Prevents cross-site request forgery</td>
                        <td className="border border-gray-300 px-4 py-2"><Badge className="bg-blue-600 text-xs">Essential</Badge></td>
                        <td className="border border-gray-300 px-4 py-2">Session</td>
                      </tr>
                      <tr>
                        <td className="border border-gray-300 px-4 py-2 font-mono">user_preferences</td>
                        <td className="border border-gray-300 px-4 py-2">Stores theme, language, and UI settings</td>
                        <td className="border border-gray-300 px-4 py-2"><Badge className="bg-orange-600 text-xs">Functional</Badge></td>
                        <td className="border border-gray-300 px-4 py-2">1 year</td>
                      </tr>
                      <tr>
                        <td className="border border-gray-300 px-4 py-2 font-mono">_ga</td>
                        <td className="border border-gray-300 px-4 py-2">Google Analytics - distinguishes users</td>
                        <td className="border border-gray-300 px-4 py-2"><Badge className="bg-green-600 text-xs">Performance</Badge></td>
                        <td className="border border-gray-300 px-4 py-2">2 years</td>
                      </tr>
                      <tr>
                        <td className="border border-gray-300 px-4 py-2 font-mono">_gid</td>
                        <td className="border border-gray-300 px-4 py-2">Google Analytics - distinguishes users</td>
                        <td className="border border-gray-300 px-4 py-2"><Badge className="bg-green-600 text-xs">Performance</Badge></td>
                        <td className="border border-gray-300 px-4 py-2">24 hours</td>
                      </tr>
                      <tr>
                        <td className="border border-gray-300 px-4 py-2 font-mono">_fbp</td>
                        <td className="border border-gray-300 px-4 py-2">Facebook Pixel - advertising tracking</td>
                        <td className="border border-gray-300 px-4 py-2"><Badge className="bg-purple-600 text-xs">Marketing</Badge></td>
                        <td className="border border-gray-300 px-4 py-2">3 months</td>
                      </tr>
                      <tr>
                        <td className="border border-gray-300 px-4 py-2 font-mono">remember_token</td>
                        <td className="border border-gray-300 px-4 py-2">Remembers login for returning users</td>
                        <td className="border border-gray-300 px-4 py-2"><Badge className="bg-orange-600 text-xs">Functional</Badge></td>
                        <td className="border border-gray-300 px-4 py-2">30 days</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              <Separator />

              {/* Local Storage */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">5. Local Storage and Similar Technologies</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  In addition to cookies, we may use other storage technologies such as:
                </p>

                <div className="space-y-4">
                  <div className="border-l-4 border-blue-500 pl-4">
                    <h4 className="font-medium">Local Storage</h4>
                    <p className="text-muted-foreground text-sm">Stores data locally on your device for faster access and offline functionality. This includes cached application data and user preferences.</p>
                  </div>
                  <div className="border-l-4 border-green-500 pl-4">
                    <h4 className="font-medium">Session Storage</h4>
                    <p className="text-muted-foreground text-sm">Temporarily stores data for the duration of your browser session, such as form data and navigation state.</p>
                  </div>
                  <div className="border-l-4 border-orange-500 pl-4">
                    <h4 className="font-medium">IndexedDB</h4>
                    <p className="text-muted-foreground text-sm">A more sophisticated storage system for complex data, used for offline functionality and performance optimization.</p>
                  </div>
                  <div className="border-l-4 border-purple-500 pl-4">
                    <h4 className="font-medium">Web Beacons</h4>
                    <p className="text-muted-foreground text-sm">Small transparent images used to track user behavior and email engagement in our communications.</p>
                  </div>
                </div>
              </section>

              <Separator />

              {/* Cookie Management */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">6. Managing Your Cookie Preferences</h2>
                
                <h3 className="text-xl font-medium mb-3">6.1 Cookie Consent Banner</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  When you first visit our Service, you will see a cookie consent banner that allows you to accept or customize your cookie preferences. You can change these preferences at any time by clicking the "Cookie Settings" link in our footer.
                </p>

                <h3 className="text-xl font-medium mb-3">6.2 Browser Settings</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  You can control cookies through your browser settings. Most browsers allow you to:
                </p>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4 mb-6">
                  <li>View cookies stored on your device</li>
                  <li>Delete cookies individually or all at once</li>
                  <li>Block cookies from specific websites</li>
                  <li>Block all cookies (may affect website functionality)</li>
                  <li>Set preferences for third-party cookies</li>
                </ul>

                <div className="bg-gray-50 p-4 rounded-lg">
                  <h4 className="font-medium mb-3">Browser-Specific Instructions:</h4>
                  <div className="grid md:grid-cols-2 gap-4 text-sm">
                    <div>
                      <p><strong>Chrome:</strong> Settings → Privacy and Security → Cookies and other site data</p>
                      <p><strong>Firefox:</strong> Options → Privacy & Security → Cookies and Site Data</p>
                    </div>
                    <div>
                      <p><strong>Safari:</strong> Preferences → Privacy → Manage Website Data</p>
                      <p><strong>Edge:</strong> Settings → Cookies and site permissions → Cookies and site data</p>
                    </div>
                  </div>
                </div>

                <h3 className="text-xl font-medium mb-3 mt-6">6.3 Third-Party Opt-Outs</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  You can opt out of certain third-party cookies and tracking:
                </p>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li><strong>Google Analytics:</strong> <a href="https://tools.google.com/dlpage/gaoptout" className="text-blue-600 hover:underline">Google Analytics Opt-out Browser Add-on</a></li>
                  <li><strong>Facebook:</strong> <a href="https://www.facebook.com/settings?tab=ads" className="text-blue-600 hover:underline">Facebook Ad Preferences</a></li>
                  <li><strong>General Opt-out:</strong> <a href="http://optout.aboutads.info/" className="text-blue-600 hover:underline">Digital Advertising Alliance Opt-out</a></li>
                </ul>

                <h3 className="text-xl font-medium mb-3 mt-6">6.4 Mobile Device Controls</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  Mobile devices have built-in controls for tracking and advertising:
                </p>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li><strong>iOS:</strong> Settings → Privacy & Security → Tracking → Allow Apps to Request to Track</li>
                  <li><strong>Android:</strong> Settings → Privacy → Ads → Reset advertising ID</li>
                </ul>
              </section>

              <Separator />

              {/* Impact of Disabling */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">7. Impact of Disabling Cookies</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  If you choose to disable or block cookies, some parts of our Service may not function properly. Here's what you might experience:
                </p>

                <div className="space-y-4">
                  <div className="bg-red-50 p-4 rounded-lg">
                    <h4 className="font-medium text-red-800 mb-2">Essential Cookies Disabled:</h4>
                    <ul className="text-red-700 text-sm space-y-1">
                      <li>• Inability to log in or maintain login sessions</li>
                      <li>• Loss of security protections</li>
                      <li>• Inability to access protected areas of the Service</li>
                      <li>• Form submissions may fail</li>
                    </ul>
                  </div>
                  <div className="bg-yellow-50 p-4 rounded-lg">
                    <h4 className="font-medium text-yellow-800 mb-2">Functional Cookies Disabled:</h4>
                    <ul className="text-yellow-700 text-sm space-y-1">
                      <li>• Loss of saved preferences and settings</li>
                      <li>• Need to re-enter information repeatedly</li>
                      <li>• Reduced personalization</li>
                      <li>• Default language and theme settings</li>
                    </ul>
                  </div>
                  <div className="bg-blue-50 p-4 rounded-lg">
                    <h4 className="font-medium text-blue-800 mb-2">Performance Cookies Disabled:</h4>
                    <ul className="text-blue-700 text-sm space-y-1">
                      <li>• Reduced ability to improve Service performance</li>
                      <li>• Difficulty identifying and fixing issues</li>
                      <li>• Less targeted feature development</li>
                    </ul>
                  </div>
                </div>
              </section>

              <Separator />

              {/* Updates and Changes */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">8. Updates to This Policy</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  We may update this Cookie Policy from time to time to reflect:
                </p>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4 mb-4">
                  <li>Changes in cookie technologies or our use of cookies</li>
                  <li>Updates to legal requirements or regulations</li>
                  <li>Changes to our Service or business practices</li>
                  <li>Feedback from users or regulatory authorities</li>
                </ul>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  When we make significant changes, we will notify you by:
                </p>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li>Updating the "Last updated" date at the top of this policy</li>
                  <li>Displaying a notice on our Service</li>
                  <li>Sending an email notification to registered users</li>
                  <li>Requesting renewed consent where required by law</li>
                </ul>
              </section>

              <Separator />

              {/* Contact Information */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">9. Contact Us</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  If you have any questions about this Cookie Policy or our use of cookies, please contact us:
                </p>
                <div className="bg-gray-50 p-4 rounded-lg space-y-2">
                  <p><strong>Email:</strong> privacy@beepbite.com</p>
                  <p><strong>Subject Line:</strong> Cookie Policy Inquiry</p>
                  <p><strong>Mailing Address:</strong></p>
                  <p>BeepBite Inc.<br />
                     Privacy & Compliance Team<br />
                     123 Tech Street, Suite 100<br />
                     San Francisco, CA 94105<br />
                     United States</p>
                  <p><strong>Phone:</strong> +1 (555) 123-4567</p>
                </div>
                <p className="text-muted-foreground leading-relaxed mt-4">
                  We will respond to cookie-related inquiries within 30 days or as required by applicable law.
                </p>
              </section>

              <Separator />

              {/* Additional Resources */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">10. Additional Resources</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  For more information about cookies and online privacy, you may find these resources helpful:
                </p>
                <ul className="space-y-2 text-muted-foreground">
                  <li>• <a href="https://www.allaboutcookies.org/" className="text-blue-600 hover:underline">All About Cookies</a> - Independent information about cookies</li>
                  <li>• <a href="https://ico.org.uk/for-the-public/online/cookies/" className="text-blue-600 hover:underline">ICO Cookie Guidance</a> - UK Information Commissioner's Office</li>
                  <li>• <a href="https://www.youronlinechoices.com/" className="text-blue-600 hover:underline">Your Online Choices</a> - European advertising opt-out</li>
                  <li>• <a href="https://www.ftc.gov/tips-advice/business-center/privacy-and-security/privacy-policy" className="text-blue-600 hover:underline">FTC Privacy Guidance</a> - US Federal Trade Commission</li>
                </ul>
              </section>

            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default CookiesPolicy; 