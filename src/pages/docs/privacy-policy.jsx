import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import DocsLayout from '@/components/layout/docs-layout';

const DocsPrivacyPolicy = () => {
  const lastUpdated = "January 15, 2024";

  return (
    <DocsLayout title="Privacy Policy" description="How we protect your data">
      <div className="max-w-4xl mx-auto">
        <Card className="border-2 border-orange-100">
          <CardContent className="p-8 space-y-8">
            
            {/* Header */}
            <div className="text-center">
              <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-orange-600 to-orange-500 bg-clip-text text-transparent">
                Privacy Policy
              </h1>
              <p className="text-lg text-muted-foreground">
                Last updated: {lastUpdated}
              </p>
            </div>

            <Separator className="bg-orange-100" />
            
            {/* Introduction */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">1. Introduction</h2>
              <p className="text-muted-foreground leading-relaxed">
                Welcome to BeepBite ("we," "our," or "us"). We are committed to protecting your privacy and ensuring the security of your personal information. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our restaurant WhatsApp notification service (the "Service").
              </p>
              <p className="text-muted-foreground leading-relaxed mt-4">
                By using our Service, you agree to the collection and use of information in accordance with this Privacy Policy. If you do not agree with the terms of this Privacy Policy, please do not use our Service.
              </p>
            </section>

            <Separator className="bg-orange-100" />

            {/* Information We Collect */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">2. Information We Collect</h2>
              
              <h3 className="text-xl font-medium mb-3">2.1 Restaurant Information</h3>
              <p className="text-muted-foreground leading-relaxed mb-4">
                When you sign up for BeepBite, we collect:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>Restaurant name, address, and contact information</li>
                <li>WhatsApp Business phone number</li>
                <li>Operating hours and business details</li>
                <li>Account credentials (email and encrypted passwords)</li>
                <li>Payment information (processed securely through third-party processors)</li>
              </ul>

              <h3 className="text-xl font-medium mb-3 mt-6">2.2 Order and Customer Data</h3>
              <p className="text-muted-foreground leading-relaxed mb-4">
                To send WhatsApp notifications, we temporarily process:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>Customer phone numbers (for notification delivery only)</li>
                <li>Order details (order numbers, ready times)</li>
                <li>Notification delivery status</li>
                <li>Customer feedback and reviews sent via WhatsApp</li>
              </ul>

              <h3 className="text-xl font-medium mb-3 mt-6">2.3 Usage Data</h3>
              <p className="text-muted-foreground leading-relaxed mb-4">
                We automatically collect:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>Service usage patterns and analytics</li>
                <li>Device and browser information</li>
                <li>IP addresses and location data</li>
                <li>Log data for troubleshooting and security</li>
              </ul>
            </section>

            <Separator className="bg-orange-100" />

            {/* How We Use Information */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">3. How We Use Your Information</h2>
              
              <h3 className="text-xl font-medium mb-3">3.1 Service Delivery</h3>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>Send WhatsApp notifications when orders are ready</li>
                <li>Manage your restaurant account and preferences</li>
                <li>Process payments and billing</li>
                <li>Provide customer support</li>
              </ul>

              <h3 className="text-xl font-medium mb-3 mt-6">3.2 Service Improvement</h3>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>Analyze usage patterns to improve notification delivery</li>
                <li>Develop new features for restaurant management</li>
                <li>Ensure system security and prevent fraud</li>
                <li>Comply with legal obligations</li>
              </ul>
            </section>

            <Separator className="bg-orange-100" />

            {/* WhatsApp Integration */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">4. WhatsApp Integration</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                BeepBite integrates with WhatsApp Business API to deliver notifications. Important points:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>We only send notifications about order readiness and reviews</li>
                <li>Customer phone numbers are processed solely for notification delivery</li>
                <li>We do not store WhatsApp conversation history</li>
                <li>Customers can opt out of notifications at any time</li>
                <li>WhatsApp's own privacy policy also applies to message delivery</li>
              </ul>
            </section>

            <Separator className="bg-orange-100" />

            {/* Data Security */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">5. Data Security</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                We implement industry-standard security measures:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>End-to-end encryption for sensitive data</li>
                <li>Secure cloud infrastructure with regular backups</li>
                <li>Limited access controls and staff training</li>
                <li>Regular security audits and monitoring</li>
                <li>Secure payment processing through certified providers</li>
              </ul>
            </section>

            <Separator className="bg-orange-100" />

            {/* Data Retention */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">6. Data Retention</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                We retain data only as long as necessary:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li><strong>Restaurant Account Data:</strong> While your account is active and 3 years after closure</li>
                <li><strong>Order Notifications:</strong> 30 days for delivery confirmation</li>
                <li><strong>Customer Reviews:</strong> Until you delete them or close your account</li>
                <li><strong>Payment Records:</strong> 7 years for tax and legal compliance</li>
                <li><strong>Usage Logs:</strong> 12 months for security and troubleshooting</li>
              </ul>
            </section>

            <Separator className="bg-orange-100" />

            {/* Your Rights */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">7. Your Rights</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                You have the right to:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>Access and download your data</li>
                <li>Correct inaccurate information</li>
                <li>Delete your account and associated data</li>
                <li>Opt out of marketing communications</li>
                <li>File a complaint with data protection authorities</li>
              </ul>
            </section>

            <Separator className="bg-orange-100" />

            {/* Contact */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">8. Contact Us</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                For privacy-related questions or to exercise your rights:
              </p>
              <div className="bg-orange-50 p-4 rounded-lg space-y-2">
                <p><strong>Email:</strong> privacy@beepbite.io</p>
                <p><strong>Mailing Address:</strong></p>
                <p>BeepBite Privacy Team<br />
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

export default DocsPrivacyPolicy; 