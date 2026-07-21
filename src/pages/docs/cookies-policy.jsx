import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import DocsLayout from '@/components/layout/docs-layout';

const DocsCookiesPolicy = () => {
  const lastUpdated = "January 15, 2024";

  return (
    <DocsLayout title="Cookie Policy" description="How we use cookies and tracking">
      <div className="max-w-4xl mx-auto">
        <Card className="border-2 border-orange-100">
          <CardContent className="p-8 space-y-8">
            
            {/* Header */}
            <div className="text-center">
              <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-orange-600 to-orange-500 bg-clip-text text-transparent">
                Cookie Policy
              </h1>
              <p className="text-lg text-muted-foreground">
                Last updated: {lastUpdated}
              </p>
            </div>

            <Separator className="bg-orange-100" />
            
            {/* Introduction */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">1. Introduction</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                This Cookie Policy explains how BeepBite ("we," "our," or "us") uses cookies and similar tracking technologies on our website and WhatsApp notification platform (the "Service"). This policy should be read alongside our Privacy Policy and Terms of Service.
              </p>
              <p className="text-muted-foreground leading-relaxed mb-4">
                By continuing to use our Service, you agree to the use of cookies as described in this policy. If you do not agree with our use of cookies, you should adjust your browser settings or discontinue use of our Service.
              </p>
            </section>

            <Separator className="bg-orange-100" />

            {/* What Are Cookies */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">2. What Are Cookies?</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Cookies are small text files stored on your device when you visit our website. They help us provide a better user experience and enable essential functionality for our WhatsApp notification service.
              </p>
              
              <h3 className="text-xl font-medium mb-3">Types of Cookies We Use</h3>
              <div className="space-y-4">
                <div className="border-l-4 border-orange-400 pl-4">
                  <h4 className="font-medium flex items-center gap-2">
                    Session Cookies 
                    <Badge variant="outline" className="text-xs border-orange-200 text-orange-700">Temporary</Badge>
                  </h4>
                  <p className="text-muted-foreground text-sm">Maintain your login session while using BeepBite's notification dashboard.</p>
                </div>
                <div className="border-l-4 border-orange-400 pl-4">
                  <h4 className="font-medium flex items-center gap-2">
                    Persistent Cookies 
                    <Badge variant="outline" className="text-xs border-orange-200 text-orange-700">Stored</Badge>
                  </h4>
                  <p className="text-muted-foreground text-sm">Remember your restaurant preferences and notification settings.</p>
                </div>
                <div className="border-l-4 border-orange-400 pl-4">
                  <h4 className="font-medium flex items-center gap-2">
                    First-Party Cookies 
                    <Badge variant="outline" className="text-xs border-orange-200 text-orange-700">BeepBite</Badge>
                  </h4>
                  <p className="text-muted-foreground text-sm">Set directly by BeepBite for core functionality.</p>
                </div>
                <div className="border-l-4 border-orange-400 pl-4">
                  <h4 className="font-medium flex items-center gap-2">
                    Third-Party Cookies 
                    <Badge variant="outline" className="text-xs border-orange-200 text-orange-700">External</Badge>
                  </h4>
                  <p className="text-muted-foreground text-sm">Set by analytics and payment processing services.</p>
                </div>
              </div>
            </section>

            <Separator className="bg-orange-100" />

            {/* How We Use Cookies */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">3. How We Use Cookies</h2>

              <div className="space-y-6">
                {/* Essential Cookies */}
                <div className="bg-orange-50 p-6 rounded-lg border border-orange-200">
                  <h3 className="text-xl font-medium mb-3 flex items-center gap-2">
                    <Badge className="bg-orange-600 text-white">Essential</Badge>
                    Strictly Necessary Cookies
                  </h3>
                  <p className="text-muted-foreground leading-relaxed mb-4">
                    These cookies are essential for BeepBite's WhatsApp notification service to function properly.
                  </p>
                  <div className="space-y-2">
                    <h4 className="font-medium">Essential functions:</h4>
                    <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-4">
                      <li>Restaurant account authentication and security</li>
                      <li>WhatsApp notification delivery tracking</li>
                      <li>Order management session maintenance</li>
                      <li>Payment processing security</li>
                    </ul>
                  </div>
                </div>

                {/* Performance Cookies */}
                <div className="bg-green-50 p-6 rounded-lg border border-green-200">
                  <h3 className="text-xl font-medium mb-3 flex items-center gap-2">
                    <Badge className="bg-green-600 text-white">Performance</Badge>
                    Analytics Cookies
                  </h3>
                  <p className="text-muted-foreground leading-relaxed mb-4">
                    Help us understand how restaurants use our notification service to improve delivery speed and reliability.
                  </p>
                  <div className="space-y-2">
                    <h4 className="font-medium">What we track:</h4>
                    <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-4">
                      <li>Notification delivery success rates</li>
                      <li>Dashboard usage patterns</li>
                      <li>WhatsApp integration performance</li>
                      <li>Error tracking and system stability</li>
                    </ul>
                  </div>
                </div>

                {/* Functional Cookies */}
                <div className="bg-blue-50 p-6 rounded-lg border border-blue-200">
                  <h3 className="text-xl font-medium mb-3 flex items-center gap-2">
                    <Badge className="bg-blue-600 text-white">Functional</Badge>
                    Functionality Cookies
                  </h3>
                  <p className="text-muted-foreground leading-relaxed mb-4">
                    Enable enhanced features and remember your restaurant's notification preferences.
                  </p>
                  <div className="space-y-2">
                    <h4 className="font-medium">Features enabled:</h4>
                    <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-4">
                      <li>Restaurant dashboard layout preferences</li>
                      <li>WhatsApp notification templates</li>
                      <li>Operating hours and business settings</li>
                      <li>Language and timezone preferences</li>
                    </ul>
                  </div>
                </div>
              </div>
            </section>

            <Separator className="bg-orange-100" />

            {/* Specific Cookies */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">4. Specific Cookies We Use</h2>
              
              <div className="overflow-x-auto">
                <table className="w-full border-collapse border border-orange-200 rounded-lg overflow-hidden">
                  <thead>
                    <tr className="bg-orange-100">
                      <th className="border border-orange-200 px-4 py-3 text-left font-semibold text-orange-800">Cookie Name</th>
                      <th className="border border-orange-200 px-4 py-3 text-left font-semibold text-orange-800">Purpose</th>
                      <th className="border border-orange-200 px-4 py-3 text-left font-semibold text-orange-800">Type</th>
                      <th className="border border-orange-200 px-4 py-3 text-left font-semibold text-orange-800">Duration</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm">
                    <tr className="bg-card">
                      <td className="border border-orange-200 px-4 py-3 font-mono">beepbite_session</td>
                      <td className="border border-orange-200 px-4 py-3">Maintains restaurant login session</td>
                      <td className="border border-orange-200 px-4 py-3"><Badge className="bg-orange-600 text-white text-xs">Essential</Badge></td>
                      <td className="border border-orange-200 px-4 py-3">Session</td>
                    </tr>
                    <tr className="bg-orange-25">
                      <td className="border border-orange-200 px-4 py-3 font-mono">whatsapp_auth</td>
                      <td className="border border-orange-200 px-4 py-3">WhatsApp Business API authentication</td>
                      <td className="border border-orange-200 px-4 py-3"><Badge className="bg-orange-600 text-white text-xs">Essential</Badge></td>
                      <td className="border border-orange-200 px-4 py-3">24 hours</td>
                    </tr>
                    <tr className="bg-card">
                      <td className="border border-orange-200 px-4 py-3 font-mono">restaurant_prefs</td>
                      <td className="border border-orange-200 px-4 py-3">Stores notification and display preferences</td>
                      <td className="border border-orange-200 px-4 py-3"><Badge className="bg-blue-600 text-white text-xs">Functional</Badge></td>
                      <td className="border border-orange-200 px-4 py-3">1 year</td>
                    </tr>
                    <tr className="bg-orange-25">
                      <td className="border border-orange-200 px-4 py-3 font-mono">_beep_analytics</td>
                      <td className="border border-orange-200 px-4 py-3">Tracks notification delivery performance</td>
                      <td className="border border-orange-200 px-4 py-3"><Badge className="bg-green-600 text-white text-xs">Performance</Badge></td>
                      <td className="border border-orange-200 px-4 py-3">30 days</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <Separator className="bg-orange-100" />

            {/* Managing Cookies */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">5. Managing Your Cookie Preferences</h2>
              
              <h3 className="text-xl font-medium mb-3">5.1 Cookie Consent</h3>
              <p className="text-muted-foreground leading-relaxed mb-4">
                When you first visit BeepBite, you can choose which cookies to accept. You can update these preferences at any time in your account settings.
              </p>

              <h3 className="text-xl font-medium mb-3">5.2 Browser Controls</h3>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Most browsers allow you to control cookies through their settings:
              </p>
              <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
                <h4 className="font-medium mb-3">Browser Instructions:</h4>
                <div className="grid md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <p><strong>Chrome:</strong> Settings → Privacy and Security → Cookies</p>
                    <p><strong>Firefox:</strong> Options → Privacy & Security → Cookies</p>
                  </div>
                  <div>
                    <p><strong>Safari:</strong> Preferences → Privacy → Manage Website Data</p>
                    <p><strong>Edge:</strong> Settings → Cookies and site permissions</p>
                  </div>
                </div>
              </div>

              <h3 className="text-xl font-medium mb-3 mt-6">5.3 Impact of Disabling Cookies</h3>
              <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                <h4 className="font-medium text-red-800 mb-2">Essential Cookies Disabled:</h4>
                <ul className="text-red-700 text-sm space-y-1">
                  <li>• Unable to log in to your restaurant dashboard</li>
                  <li>• WhatsApp notifications may not work properly</li>
                  <li>• Order management features unavailable</li>
                  <li>• Payment processing may fail</li>
                </ul>
              </div>
            </section>

            <Separator className="bg-orange-100" />

            {/* WhatsApp Integration */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">6. WhatsApp Business API</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Our WhatsApp notification service uses WhatsApp Business API, which has its own data handling practices:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>WhatsApp's own cookies and tracking may apply</li>
                <li>Message delivery data is processed by WhatsApp</li>
                <li>Customer phone numbers are handled according to WhatsApp's privacy policy</li>
                <li>We only access delivery status, not message content</li>
              </ul>
            </section>

            <Separator className="bg-orange-100" />

            {/* Updates */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">7. Policy Updates</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                We may update this Cookie Policy to reflect changes in our WhatsApp notification service or legal requirements. When we make significant changes, we will:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>Update the "Last updated" date</li>
                <li>Display a notice in your restaurant dashboard</li>
                <li>Send an email notification</li>
                <li>Request renewed consent where required</li>
              </ul>
            </section>

            <Separator className="bg-orange-100" />

            {/* Contact */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">8. Contact Us</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                For questions about this Cookie Policy or to manage your preferences:
              </p>
              <div className="bg-orange-50 p-4 rounded-lg space-y-2">
                <p><strong>Email:</strong> privacy@beepbite.io</p>
                <p><strong>Subject:</strong> Cookie Policy Inquiry</p>
                <p><strong>Mailing Address:</strong></p>
                <p>BeepBite Pty Ltd<br />
                   Privacy Team<br />
                   123 Innovation Drive<br />
                   Cape Town, 8001<br />
                   South Africa</p>
                <p><strong>Response Time:</strong> We will respond within 30 days</p>
              </div>
            </section>

          </CardContent>
        </Card>
      </div>
    </DocsLayout>
  );
};

export default DocsCookiesPolicy; 