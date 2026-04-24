import React from 'react';
import { useLocation } from 'react-router-dom';
import DocsLayout, { usePrevNext } from '@/components/layout/docs-layout';
import {
  PageHeader,
  Section,
  Steps,
  Step,
  Screenshot,
  Callout,
  PrevNext,
  KeyValueList,
  Code,
} from '@/components/docs/docs-primitives';

const WhatsAppSetup = () => {
  const { pathname } = useLocation();
  const { prev, next } = usePrevNext(pathname);

  return (
    <DocsLayout title="WhatsApp setup" description="Connect WhatsApp Business and start taking remote orders.">
      <PageHeader
        eyebrow="Restaurant Operations"
        title="WhatsApp setup"
        description="Link your WhatsApp Business number so customers can order, pay and get pickup notifications without installing anything."
        readTime="9 min"
        lastUpdated="2026-04-22"
      />

      <KeyValueList
        items={[
          { label: 'You will need', value: 'A WhatsApp Business account and the phone number it uses' },
          { label: 'Cost', value: 'Free — included in your BeepBite plan' },
          { label: 'Time', value: '~5 minutes to connect, ~10 to customise' },
        ]}
      />

      <Callout tone="info" title="No WhatsApp Business yet?">
        Download the WhatsApp Business app from the App Store or Play Store and verify your restaurant's number first.
        It's free.
      </Callout>

      <Section id="connect" kicker="Step 1" title="Connect your number">
        <p>
          In BeepBite, go to <strong>Settings → Channels → WhatsApp</strong> and tap <strong>Connect</strong>. You'll
          be redirected to the WhatsApp Business consent flow to authorise BeepBite to send and receive messages on
          your behalf.
        </p>
        <Screenshot
          variant="browser"
          url="app.beepbite.io/settings/channels/whatsapp"
          alt="The WhatsApp connection screen with the 'Connect' button highlighted."
          caption="WhatsApp settings — drop the real screenshot in /public/docs/whatsapp-connect.png"
        />
      </Section>

      <Section id="customer-flow" kicker="Step 2" title="The customer ordering flow">
        <p>
          Customers message your number and BeepBite replies with an interactive menu. They tap through, pay via a
          secure WhatsApp link and get a confirmation back — all inside the chat.
        </p>
        <Screenshot
          variant="mobile"
          alt="A WhatsApp chat with the BeepBite bot showing the menu, the cart and a payment link."
          caption="Customer view on the phone"
          ratio="9/16"
        />
        <Steps>
          <Step title="Customer says hi">
            They send any message to your WhatsApp number. BeepBite greets them with your restaurant name and a menu
            link.
          </Step>
          <Step title="They build their order">
            Each item is selectable in WhatsApp itself. Modifiers are honoured exactly like at the counter.
          </Step>
          <Step title="They pay">
            BeepBite sends a payment link. Once paid, the order drops into your POS queue.
          </Step>
          <Step title="They get notified when ready">
            When you tap <strong>Mark ready</strong> in the POS, the customer receives a branded pickup notification.
          </Step>
        </Steps>
      </Section>

      <Section id="messages" kicker="Step 3" title="Customise your messages">
        <p>
          Open <strong>Settings → Channels → WhatsApp → Messages</strong> to edit the templates customers receive. Use
          the variables shown in the editor — they're replaced at send time.
        </p>
        <Code language="message-template">
{`Hi {{customer_name}} 👋

Your order #{{order_number}} ({{order_total}}) is ready for pickup at {{restaurant_name}}.
Just show this message at the counter — see you soon!`}
        </Code>
        <Callout tone="tip" title="Keep it short">
          The first message should fit in one notification preview. Use line breaks sparingly so the alert is readable
          at a glance.
        </Callout>
      </Section>

      <Section id="hours" kicker="Step 4" title="Out-of-hours auto reply">
        <p>
          Set business hours in <strong>Settings → Organization</strong>. Outside those hours BeepBite replies with
          your custom message and lets the customer know when you reopen.
        </p>
      </Section>

      <Section id="troubleshoot" title="Troubleshooting">
        <KeyValueList
          items={[
            {
              label: 'Notifications not sending',
              value:
                'Check the customer phone has a country code (+27...) and that your WhatsApp Business connection is still authorised.',
            },
            {
              label: 'Customer cannot see the menu',
              value:
                'Re-publish the menu from Menu → Publish, then ask the customer to send any message to retrigger the welcome flow.',
            },
            {
              label: 'Payment link expired',
              value: 'Links expire after 30 minutes. Resend from the order detail in the POS.',
            },
          ]}
        />
      </Section>

      <PrevNext prev={prev} next={next} />
    </DocsLayout>
  );
};

export default WhatsAppSetup;
