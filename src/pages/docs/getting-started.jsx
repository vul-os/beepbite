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
} from '@/components/docs/docs-primitives';

const GettingStarted = () => {
  const { pathname } = useLocation();
  const { prev, next } = usePrevNext(pathname);

  return (
    <DocsLayout title="Quick start guide" description="From sign-up to first order in 10 minutes.">
      <PageHeader
        eyebrow="Getting Started"
        title="Quick start guide"
        description="Set up your BeepBite account, import your menu, connect WhatsApp and take your first order — all in about 10 minutes."
        readTime="6 min"
        lastUpdated="2026-04-22"
      />

      <KeyValueList
        items={[
          { label: 'Audience', value: 'New restaurant owners and managers' },
          { label: 'Time required', value: '~10 minutes' },
          { label: 'You will need', value: 'Your menu (PDF or photo) and your WhatsApp Business number' },
        ]}
      />

      <Callout tone="info" title="Before you start">
        Make sure you have your business name, address and WhatsApp Business number handy. If you don't have a WhatsApp
        Business number yet, see <a className="underline" href="/docs/whatsapp-setup">WhatsApp setup</a>.
      </Callout>

      <Section id="create-account" kicker="Step 1" title="Create your BeepBite account">
        <p>
          Head to the sign-up page and enter your email. We'll send a verification link — open it on the same device to
          continue.
        </p>
        <Screenshot
          variant="browser"
          url="app.beepbite.io/signup"
          alt="The BeepBite sign-up screen with the 'Create account' button highlighted."
          caption="Sign-up screen — drop the real screenshot in /public/docs/signup.png"
        />
      </Section>

      <Section id="business-info" kicker="Step 2" title="Add your business details">
        <p>
          Tell us about your restaurant: name, address, operating hours and the WhatsApp number customers will message.
          You can edit any of this later in <strong>Settings → Organization</strong>.
        </p>
        <Steps>
          <Step title="Restaurant name and address">
            This appears on receipts and customer notifications, so use the exact name your customers know.
          </Step>
          <Step title="Operating hours">
            We use these to auto-reply to WhatsApp messages received outside open hours.
          </Step>
          <Step title="WhatsApp Business number">
            The number on your WhatsApp Business app. Don't have one? Skip this step and{' '}
            <a className="underline text-orange-600" href="/docs/whatsapp-setup">
              set it up later
            </a>
            .
          </Step>
        </Steps>
      </Section>

      <Section id="import-menu" kicker="Step 3" title="Add your menu">
        <p>
          Go to <strong>Menu</strong> and add your items. Give each one a name, a price and a category — that is the
          minimum needed to start selling. Modifiers, schedules and courses can be layered on afterwards.
        </p>
        <Callout tone="tip" title="Start small">
          You do not need your whole menu on day one. Add your ten best sellers, take a few real orders, then fill in
          the rest. Items can be edited or hidden at any time without re-publishing.
        </Callout>
      </Section>

      <Section id="connect-whatsapp" kicker="Step 4" title="Connect WhatsApp">
        <p>
          Link your WhatsApp Business number so customers can message your restaurant directly from their phone — no app
          install required.
        </p>
        <p>
          Full instructions are on the{' '}
          <a className="underline text-orange-600" href="/docs/whatsapp-setup">
            WhatsApp setup
          </a>{' '}
          page.
        </p>
      </Section>

      <Section id="take-first-order" kicker="Step 5" title="Take your first order">
        <p>
          Open the POS, choose items, take payment and tap <strong>Mark ready</strong>. If the order came in via
          WhatsApp, the customer is automatically notified for pickup — no buzzer needed.
        </p>
        <Screenshot
          variant="browser"
          url="app.beepbite.io/pos"
          alt="The POS view with a sample order in the cart and the 'Mark ready' button highlighted."
          caption="POS — drop the real screenshot in /public/docs/pos-order.png"
        />
        <Callout tone="success" title="That's it!">
          You're live. Customers can now order at the counter or via WhatsApp, and you'll see every order in one queue.
        </Callout>
      </Section>

      <Section id="next-steps" title="Next steps">
        <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
          <li>
            <a className="underline text-orange-600" href="/docs/menu-management">
              Refine your menu
            </a>{' '}
            with modifiers and categories.
          </li>
          <li>
            <a className="underline text-orange-600" href="/docs/whatsapp-setup">
              Customise WhatsApp messages
            </a>{' '}
            with your brand voice.
          </li>
          <li>
            Invite your team in <strong>Settings → Team</strong>.
          </li>
        </ul>
      </Section>

      <PrevNext prev={prev} next={next} />
    </DocsLayout>
  );
};

export default GettingStarted;
