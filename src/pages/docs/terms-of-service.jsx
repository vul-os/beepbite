import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import DocsLayout from '@/components/layout/docs-layout';

const DocsTermsOfService = () => {
  const lastUpdated = "January 15, 2024";

  return (
    <DocsLayout title="Terms of Service" description="Legal terms and conditions">
      <div className="max-w-4xl mx-auto">
        <Card className="border-2 border-orange-100">
          <CardContent className="p-8 space-y-8">
            
            {/* Header */}
            <div className="text-center">
              <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-orange-600 to-orange-500 bg-clip-text text-transparent">
                Terms of Service
              </h1>
              <p className="text-lg text-muted-foreground">
                Last updated: {lastUpdated}
              </p>
            </div>

            <Separator className="bg-orange-100" />
            
            {/* Introduction */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">1. Introduction and Acceptance</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Welcome to BeepBite, a WhatsApp notification service for restaurants ("Service") provided by BeepBite Pty Ltd ("Company," "we," "our," or "us"). These Terms of Service ("Terms") govern your access to and use of our platform.
              </p>
              <p className="text-muted-foreground leading-relaxed mb-4">
                By accessing or using our Service, you agree to be bound by these Terms and our Privacy Policy. If you do not agree to these Terms, you may not access or use our Service.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                We may modify these Terms at any time. Your continued use of the Service constitutes acceptance of any changes to these Terms.
              </p>
            </section>

            <Separator className="bg-orange-100" />

            {/* Service Description */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">2. Service Description</h2>
              
              <h3 className="text-xl font-medium mb-3">2.1 BeepBite Platform</h3>
              <p className="text-muted-foreground leading-relaxed mb-4">
                BeepBite provides a WhatsApp notification service that helps restaurants:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>Send instant WhatsApp notifications when orders are ready</li>
                <li>Manage customer feedback and reviews via WhatsApp</li>
                <li>Track notification delivery and customer responses</li>
                <li>Reduce food waste and improve customer satisfaction</li>
              </ul>

              <h3 className="text-xl font-medium mb-3 mt-6">2.2 Service Availability</h3>
              <p className="text-muted-foreground leading-relaxed mb-4">
                We strive to maintain high service availability but do not guarantee uninterrupted access. The Service depends on WhatsApp Business API availability and your internet connection.
              </p>

              <h3 className="text-xl font-medium mb-3">2.3 Service Modifications</h3>
              <p className="text-muted-foreground leading-relaxed">
                We reserve the right to modify, suspend, or discontinue any part of the Service at any time with reasonable notice.
              </p>
            </section>

            <Separator className="bg-orange-100" />

            {/* Account Registration */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">3. Account Registration and Requirements</h2>
              
              <h3 className="text-xl font-medium mb-3">3.1 Eligibility</h3>
              <p className="text-muted-foreground leading-relaxed mb-4">
                You must be at least 18 years old and represent a legitimate restaurant business. You must have a valid WhatsApp Business account to use our Service.
              </p>

              <h3 className="text-xl font-medium mb-3">3.2 Account Information</h3>
              <p className="text-muted-foreground leading-relaxed mb-4">
                You agree to:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>Provide accurate restaurant and contact information</li>
                <li>Maintain a valid WhatsApp Business phone number</li>
                <li>Keep your account credentials secure</li>
                <li>Notify us immediately of any unauthorized access</li>
                <li>Accept responsibility for all activities under your account</li>
              </ul>

              <h3 className="text-xl font-medium mb-3 mt-6">3.3 WhatsApp Requirements</h3>
              <p className="text-muted-foreground leading-relaxed">
                You must comply with WhatsApp's Business Terms of Service and maintain an active WhatsApp Business account in good standing.
              </p>
            </section>

            <Separator className="bg-orange-100" />

            {/* Acceptable Use */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">4. Acceptable Use Policy</h2>
              
              <h3 className="text-xl font-medium mb-3">4.1 Permitted Uses</h3>
              <p className="text-muted-foreground leading-relaxed mb-4">
                You may use BeepBite only for:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>Notifying customers when their orders are ready</li>
                <li>Collecting customer feedback and reviews</li>
                <li>Managing your restaurant's notification preferences</li>
                <li>Tracking notification delivery and responses</li>
              </ul>

              <h3 className="text-xl font-medium mb-3 mt-6">4.2 Prohibited Activities</h3>
              <p className="text-muted-foreground leading-relaxed mb-4">
                You agree not to:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>Send spam or unsolicited marketing messages</li>
                <li>Use the Service for any illegal or fraudulent purposes</li>
                <li>Share customer phone numbers with third parties</li>
                <li>Attempt to bypass WhatsApp's terms or policies</li>
                <li>Reverse engineer or attempt to access our systems</li>
                <li>Use the Service to compete with BeepBite</li>
              </ul>
            </section>

            <Separator className="bg-orange-100" />

            {/* Payment Terms */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">5. Payment Terms</h2>
              
              <h3 className="text-xl font-medium mb-3">5.1 Subscription Plans</h3>
              <p className="text-muted-foreground leading-relaxed mb-4">
                BeepBite offers various subscription plans based on notification volume. Current pricing is available on our website and may be updated with 30 days notice.
              </p>

              <h3 className="text-xl font-medium mb-3">5.2 Payment Processing</h3>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>Payments are processed securely through third-party providers</li>
                <li>Subscription fees are billed monthly in advance</li>
                <li>Failed payments may result in service suspension</li>
                <li>You are responsible for applicable taxes</li>
              </ul>

              <h3 className="text-xl font-medium mb-3 mt-6">5.3 Refunds and Cancellations</h3>
              <p className="text-muted-foreground leading-relaxed">
                You may cancel your subscription at any time. Cancellations take effect at the end of the current billing period. No refunds for partial months, except as required by law.
              </p>
            </section>

            <Separator className="bg-orange-100" />

            {/* Intellectual Property */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">6. Intellectual Property</h2>
              
              <h3 className="text-xl font-medium mb-3">6.1 Our Property</h3>
              <p className="text-muted-foreground leading-relaxed mb-4">
                The Service, including all software, designs, and trademarks, is owned by BeepBite. We grant you a limited license to use the Service for your restaurant's notification needs.
              </p>

              <h3 className="text-xl font-medium mb-3">6.2 Your Content</h3>
              <p className="text-muted-foreground leading-relaxed">
                You retain ownership of your restaurant data. By using the Service, you grant us permission to process this data solely to provide WhatsApp notifications.
              </p>
            </section>

            <Separator className="bg-orange-100" />

            {/* WhatsApp Compliance */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">7. WhatsApp Business API Compliance</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Our Service relies on WhatsApp Business API. You acknowledge that:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>WhatsApp's terms and policies also apply to your use</li>
                <li>Message delivery depends on WhatsApp's infrastructure</li>
                <li>Customer opt-outs must be respected immediately</li>
                <li>Only business-related notifications are permitted</li>
                <li>We may suspend service for WhatsApp policy violations</li>
              </ul>
            </section>

            <Separator className="bg-orange-100" />

            {/* Limitation of Liability */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">8. Limitation of Liability</h2>
              
              <h3 className="text-xl font-medium mb-3">8.1 Service Disclaimer</h3>
              <p className="text-muted-foreground leading-relaxed mb-4">
                THE SERVICE IS PROVIDED "AS IS" WITHOUT WARRANTIES. WE DO NOT GUARANTEE UNINTERRUPTED MESSAGE DELIVERY OR WHATSAPP AVAILABILITY.
              </p>

              <h3 className="text-xl font-medium mb-3">8.2 Limitation of Liability</h3>
              <p className="text-muted-foreground leading-relaxed">
                OUR LIABILITY IS LIMITED TO THE AMOUNT YOU PAID IN THE 12 MONTHS PRECEDING ANY CLAIM. WE ARE NOT LIABLE FOR INDIRECT DAMAGES, LOST PROFITS, OR WHATSAPP SERVICE INTERRUPTIONS.
              </p>
            </section>

            <Separator className="bg-orange-100" />

            {/* Termination */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">9. Termination</h2>
              
              <h3 className="text-xl font-medium mb-3">9.1 Termination by You</h3>
              <p className="text-muted-foreground leading-relaxed mb-4">
                You may terminate your account at any time through your account settings or by contacting support.
              </p>

              <h3 className="text-xl font-medium mb-3">9.2 Termination by Us</h3>
              <p className="text-muted-foreground leading-relaxed mb-4">
                We may suspend or terminate your account for:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>Violation of these Terms or WhatsApp policies</li>
                <li>Non-payment of fees</li>
                <li>Suspected fraudulent activity</li>
                <li>Misuse of the notification service</li>
              </ul>

              <h3 className="text-xl font-medium mb-3 mt-6">9.3 Effect of Termination</h3>
              <p className="text-muted-foreground leading-relaxed">
                Upon termination, your access ceases immediately. We may delete your data according to our retention policies but are not obligated to return or transfer data.
              </p>
            </section>

            <Separator className="bg-orange-100" />

            {/* Governing Law */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">10. Governing Law</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                These Terms are governed by the laws of South Africa. Any disputes will be resolved in the courts of Cape Town, South Africa.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                We encourage informal resolution of disputes by contacting legal@beepbite.io before pursuing legal action.
              </p>
            </section>

            <Separator className="bg-orange-100" />

            {/* Contact Information */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">11. Contact Information</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                For questions about these Terms of Service:
              </p>
              <div className="bg-orange-50 p-4 rounded-lg space-y-2">
                <p><strong>Email:</strong> legal@beepbite.io</p>
                <p><strong>Mailing Address:</strong></p>
                <p>BeepBite Pty Ltd<br />
                   Legal Department<br />
                   123 Innovation Drive<br />
                   Cape Town, 8001<br />
                   South Africa</p>
                <p><strong>Response Time:</strong> We will respond within 15 business days</p>
              </div>
            </section>

          </CardContent>
        </Card>
      </div>
    </DocsLayout>
  );
};

export default DocsTermsOfService; 